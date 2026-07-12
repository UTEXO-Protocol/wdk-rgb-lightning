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
    this.node = {}
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

  it('pins the exact legacy beta derivation for existing node identities', () => {
    const seed = Uint8Array.from(Buffer.from(WDK_SEED_HEX, 'hex'))
    expect(legacyWdkSeedToNodeSeedHex(seed)).toBe(NODE_SEED_V1)
  })

  it('rejects seed material shorter than 32 bytes', () => {
    expect(() => wdkSeedToNodeSeedHex(new Uint8Array(31))).toThrow('at least 32 bytes')
  })
})

describe('WalletManagerRgbLightning', () => {
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
})
