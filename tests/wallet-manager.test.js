// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.

import { jest } from '@jest/globals'

import WalletManagerRgbLightning, {
  legacyWdkSeedToNodeSeedHex,
  wdkSeedToNodeSeedHex
} from '../src/wallet-manager-rgb-lightning.js'

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const WDK_SEED_HEX = '5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc19a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4'
const NODE_SEED_V2 = WDK_SEED_HEX.slice(0, 64)
const NODE_SEED_V1 = 'd6560f02547828d8d76fc84ea68e74dcccea5599e735cee1fa5f2742289cda58'

class FakeBinding {
  static instances = []

  constructor (config) {
    this._config = config
    this.attachExternalSigner = jest.fn()
    this.shutdown = jest.fn()
    this.bootstrap = jest.fn(() => ({ node_id: '02' + '11'.repeat(32) }))
    this.vssStatus = jest.fn(() => ({ configured: false, url: null, allowHttp: false, lastBackupVersion: null }))
    this.ensureNode = jest.fn(() => ({}))
    FakeBinding.instances.push(this)
  }
}

class TestManager extends WalletManagerRgbLightning {
  static get Binding () { return FakeBinding }
}

beforeEach(() => {
  FakeBinding.instances = []
})

describe('node seed derivation', () => {
  it('uses the first 32 bytes of the WDK-normalized BIP-39 seed', () => {
    const seed = Uint8Array.from(Buffer.from(WDK_SEED_HEX, 'hex'))
    expect(wdkSeedToNodeSeedHex(seed)).toBe(NODE_SEED_V2)
  })

  it('preserves the legacy beta derivation for existing node identities', () => {
    const seed = Uint8Array.from(Buffer.from(WDK_SEED_HEX, 'hex'))
    expect(legacyWdkSeedToNodeSeedHex(seed)).toBe(NODE_SEED_V1)
  })

  it('rejects seed material shorter than 32 bytes', () => {
    expect(() => wdkSeedToNodeSeedHex(new Uint8Array(31))).toThrow('at least 32 bytes')
  })
})

describe('WalletManagerRgbLightning', () => {
  it('keeps the base manager abstract and requires a persistent dataDir', () => {
    expect(() => WalletManagerRgbLightning.Binding).toThrow('abstract')
    expect(() => new TestManager(MNEMONIC)).toThrow('network configuration is required')
    expect(() => new TestManager(MNEMONIC, { network: 'regtest' })).toThrow('dataDir is required')
  })

  it('uses v2 for fresh nodes and supplies v1 only as an automatic fallback', async () => {
    const manager = new TestManager(MNEMONIC, { network: 'regtest', dataDir: '/wallet' })
    const account = await manager.getAccount()
    const binding = FakeBinding.instances[0]
    expect(binding.attachExternalSigner).toHaveBeenCalledWith(NODE_SEED_V2, NODE_SEED_V1)
    expect(await manager.getAccount()).toBe(account)
    expect(await manager.getAccountByPath('m')).toBe(account)
    expect(FakeBinding.instances).toHaveLength(1)
  })

  it('supports explicit v2-only and legacy-only modes', async () => {
    const v2 = new TestManager(MNEMONIC, {
      network: 'regtest',
      dataDir: '/v2',
      nodeSeedDerivation: 'wdk-seed-v2'
    })
    await v2.getAccount()
    expect(FakeBinding.instances[0].attachExternalSigner).toHaveBeenCalledWith(NODE_SEED_V2, undefined)

    const legacy = new TestManager(MNEMONIC, {
      network: 'regtest',
      dataDir: '/v1',
      nodeSeedDerivation: 'legacy-v1'
    })
    await legacy.getAccount()
    expect(FakeBinding.instances[1].attachExternalSigner).toHaveBeenCalledWith(NODE_SEED_V1)
  })

  it('rejects an unknown derivation mode and nonzero account indexes', async () => {
    const invalid = new TestManager(MNEMONIC, {
      network: 'regtest',
      dataDir: '/bad',
      nodeSeedDerivation: 'future-v3'
    })
    await expect(invalid.getAccount()).rejects.toThrow('nodeSeedDerivation')

    const manager = new TestManager(MNEMONIC, { network: 'regtest', dataDir: '/wallet' })
    await expect(manager.getAccount(1)).rejects.toThrow('only support account index 0')
    await expect(manager.getAccountByPath("m/84'/1'/0'")).rejects.toThrow("only support the VLS root path 'm'")
    await expect(manager.getAccount('named')).rejects.toThrow('registered WDK signers are not supported')
    await expect(manager.getAccount(0, { signerName: 'named' })).rejects.toThrow('registered WDK signers are not supported')
    await expect(manager.getAccountByPath('m', { signerName: 'named' })).rejects.toThrow('registered WDK signers are not supported')
  })

  it('shuts down the binding during dispose without exposing a private key', async () => {
    const manager = new TestManager(MNEMONIC, { network: 'regtest', dataDir: '/wallet' })
    const account = await manager.getAccount()
    const binding = FakeBinding.instances[0]
    expect(account.keyPair.privateKey).toBeNull()
    manager.dispose()
    expect(binding.shutdown).toHaveBeenCalledTimes(1)
  })

  it('rejects synchronous disposal while a VSS upload owns the native handle', async () => {
    const manager = new TestManager(MNEMONIC, { network: 'regtest', dataDir: '/wallet' })
    const account = await manager.getAccount()
    const binding = FakeBinding.instances[0]
    let release
    binding.vssBackup = jest.fn(() => new Promise(resolve => { release = resolve }))
    const backup = account.vssBackup()
    await Promise.resolve()
    expect(() => manager.dispose()).toThrow('Await account activation and shutdown')
    expect(binding.shutdown).not.toHaveBeenCalled()
    release({ version: 7 })
    await backup
    await account.shutdown()
    expect(() => manager.dispose()).not.toThrow()
  })

  it('rejects synchronous disposal from the moment a policy transition is admitted', async () => {
    const manager = new TestManager(MNEMONIC, { network: 'regtest', dataDir: '/wallet' })
    const account = await manager.getAccount()
    const binding = FakeBinding.instances[0]
    let release
    binding.setVssAutomaticBackupEnabled = jest.fn(() => new Promise(resolve => { release = resolve }))
    const policy = account.setVssAutomaticBackupEnabled(false)
    expect(account._vssPending).toBe(0) // The transition has not reached the upload queue yet.
    expect(() => manager.dispose()).toThrow('Await account activation and shutdown')
    expect(binding.shutdown).not.toHaveBeenCalled()
    for (let tick = 0; tick < 10; tick++) await Promise.resolve()
    release({ automatic_backup_enabled: false })
    await policy
    await account.shutdown()
    expect(() => manager.dispose()).not.toThrow()
  })

  it('dispose is a no-op before an account has created a binding', () => {
    const manager = new TestManager(MNEMONIC, { network: 'regtest', dataDir: '/wallet' })
    expect(() => manager.dispose()).not.toThrow()
    expect(FakeBinding.instances).toHaveLength(0)
  })

  it('preserves a failed creation handle until cleanup succeeds', async () => {
    class FailingBinding extends FakeBinding {
      constructor (config) {
        super(config)
        this.attachExternalSigner.mockImplementation(() => { throw new Error('attach failed') })
        this.shutdown.mockImplementation(() => { throw new Error('cleanup failed') })
      }
    }
    class FailingManager extends TestManager {
      static get Binding () { return FailingBinding }
    }
    const manager = new FailingManager(MNEMONIC, { network: 'regtest', dataDir: '/wallet' })
    await expect(manager.getAccount()).rejects.toBeInstanceOf(AggregateError)
    const binding = FakeBinding.instances[0]
    expect(manager._binding).toBe(binding)
    await expect(manager.getAccount()).rejects.toThrow('cleanup failed')
    expect(FakeBinding.instances).toHaveLength(1)
    binding.shutdown.mockImplementation(() => {})
    manager.dispose()
    expect(manager._binding).toBeNull()
  })

  it('reports every disposal failure and allows native shutdown retry', async () => {
    const manager = new TestManager(MNEMONIC, { network: 'regtest', dataDir: '/wallet' })
    const account = await manager.getAccount()
    const binding = FakeBinding.instances[0]
    const disposeAccount = jest.spyOn(account, 'dispose').mockImplementationOnce(() => { throw new Error('account cleanup') })
    binding.shutdown.mockImplementationOnce(() => { throw new Error('native cleanup') })
    try {
      manager.dispose()
      throw new Error('Expected aggregate failure')
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError)
      expect(error.errors.map(e => e.message)).toEqual(['account cleanup', 'native cleanup'])
    }
    expect(manager._accounts[0]).toBe(account)
    expect(manager._binding).toBe(binding)
    manager.dispose()
    expect(disposeAccount).toHaveBeenCalledTimes(2)
    expect(manager._accounts).toEqual({})
    expect(manager._binding).toBeNull()
    await expect(manager.getAccount()).rejects.toThrow('disposed')
  })

  it('retains a registered signer after failed disposal and retries only unfinished cleanup', async () => {
    const manager = new TestManager(MNEMONIC, { network: 'regtest', dataDir: '/wallet' })
    const failure = new Error('signer cleanup failed')
    const retained = { dispose: jest.fn().mockImplementationOnce(() => { throw failure }) }
    const completed = { dispose: jest.fn() }
    expect(manager.addSigner('retained', retained)).toBe(manager)
    manager.addSigner('completed', completed)
    expect(manager.getSigner('retained')).toBe(retained)

    expect(() => manager.dispose()).toThrow(failure)
    expect(manager.getSigners()).toEqual({ retained })
    expect(manager.getSigner('retained')).toBe(retained)
    expect(retained.dispose).toHaveBeenCalledTimes(1)
    expect(completed.dispose).toHaveBeenCalledTimes(1)
    await expect(manager.getAccount()).rejects.toThrow('disposed')

    expect(manager.dispose()).toBeUndefined()
    expect(retained.dispose).toHaveBeenCalledTimes(2)
    expect(completed.dispose).toHaveBeenCalledTimes(1)
    expect(manager.getSigners()).toEqual({})
    expect(() => manager.getSigner('retained')).toThrow('No signer registered')
    manager.dispose()
    expect(retained.dispose).toHaveBeenCalledTimes(2)
    expect(completed.dispose).toHaveBeenCalledTimes(1)
    expect(FakeBinding.instances).toHaveLength(0)
  })

  it('retains a failed default signer without repeating successful registered-signer cleanup', () => {
    const failure = new Error('default signer cleanup failed')
    const defaultSigner = { dispose: jest.fn().mockImplementationOnce(() => { throw failure }) }
    const completed = { dispose: jest.fn() }
    const manager = new TestManager(defaultSigner, { network: 'regtest', dataDir: '/wallet' })
    manager.addSigner('completed', completed)
    expect(manager.getSigner()).toBe(defaultSigner)

    expect(() => manager.dispose()).toThrow(failure)
    expect(manager.getSigner()).toBe(defaultSigner)
    expect(manager.getSigners()).toEqual({})
    expect(manager.dispose()).toBeUndefined()
    expect(defaultSigner.dispose).toHaveBeenCalledTimes(2)
    expect(completed.dispose).toHaveBeenCalledTimes(1)
    expect(() => manager.getSigner()).toThrow('No default signer registered')
    manager.dispose()
    expect(defaultSigner.dispose).toHaveBeenCalledTimes(2)
    expect(FakeBinding.instances).toHaveLength(0)
  })

  it('settles partial cleanup across accounts, signers and native handles before retrying failures', async () => {
    const manager = new TestManager(MNEMONIC, { network: 'regtest', dataDir: '/wallet' })
    const account = await manager.getAccount()
    const disposeAccount = jest.spyOn(account, 'dispose')
    const binding = FakeBinding.instances[0]
    const retained = { dispose: jest.fn().mockImplementationOnce(() => { throw new Error('registered cleanup') }) }
    const completed = { dispose: jest.fn() }
    manager.addSigner('retained', retained)
    manager.addSigner('completed', completed)
    binding.shutdown.mockImplementationOnce(() => { throw new Error('native cleanup') })

    let failure
    try { manager.dispose() } catch (error) { failure = error }
    expect(failure).toBeInstanceOf(AggregateError)
    expect(failure.errors.map(error => error.message)).toEqual(['registered cleanup', 'native cleanup'])
    expect(manager._accounts).toEqual({})
    expect(manager._binding).toBe(binding)
    expect(manager.getSigners()).toEqual({ retained })

    expect(manager.dispose()).toBeUndefined()
    expect(disposeAccount).toHaveBeenCalledTimes(1)
    expect(completed.dispose).toHaveBeenCalledTimes(1)
    expect(retained.dispose).toHaveBeenCalledTimes(2)
    expect(binding.shutdown).toHaveBeenCalledTimes(2)
    expect(manager._binding).toBeNull()
    expect(manager.getSigners()).toEqual({})
    await expect(manager.getAccount()).rejects.toThrow('disposed')
    manager.dispose()
    expect(binding.shutdown).toHaveBeenCalledTimes(2)
  })

  it('maps mempool fee recommendations to WDK bigint fee rates', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = jest.fn(async () => ({
      json: async () => ({ fastestFee: 22, hourFee: 7 })
    }))
    try {
      const manager = new TestManager(MNEMONIC, { network: 'regtest', dataDir: '/wallet' })
      await expect(manager.getFeeRates()).resolves.toEqual({ normal: 7n, fast: 22n })
      expect(globalThis.fetch).toHaveBeenCalledWith('https://mempool.space/api/v1/fees/recommended')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
