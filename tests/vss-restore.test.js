// Copyright 2026 UTEXO. Licensed under the Apache License, Version 2.0.
import { jest } from '@jest/globals'
import { BareRgbLightningBinding } from '../src/bare-binding.js'
import { NodeRgbLightningBinding } from '../src/node-binding.js'
import WalletAccount from '../src/wallet-account-rgb-lightning.js'
import { AccountLockedError, VssError } from '../src/errors.js'

const config = { network: 'signet', dataDir: '/wallet', vssUrl: 'https://vss-server.utexo.com/vss' }
const identity = { node_id: '02' + '11'.repeat(32), master_fingerprint: 'a1b2c3d4' }
const receipt = { restored: true, status: 'restored', network: 'signet', ...identity, version: 7 }
const expected = { network: config.network, dataDir: config.dataDir, vssUrl: config.vssUrl, nodeId: identity.node_id }
const unlockRequest = { indexer_url: 'https://esplora.invalid', proxy_endpoint: 'rpcs://proxy.invalid/json-rpc' }

for (const Binding of [BareRgbLightningBinding, NodeRgbLightningBinding]) {
  describe(`actual VSS restore: ${Binding.name}`, () => {
    function binding () {
      const value = new Binding(config)
      value._signer = { bootstrap: jest.fn(() => identity) }
      value._node = {
        initWithNativeExternalSigner: jest.fn(),
        unlockWithNativeExternalSigner: jest.fn(),
        prepareVssRestore: jest.fn(() => receipt),
        vssRestoreInfo: jest.fn(() => ({ ...receipt, unlocked: true }))
      }
      return value
    }

    it('initializes only public signer identity and prepares actual restore before ordinary unlock', () => {
      const value = binding()
      expect(value.prepareVssRestore(expected)).toBe(receipt)
      expect(value._node.initWithNativeExternalSigner).toHaveBeenCalledTimes(1)
      expect(value._node.prepareVssRestore).toHaveBeenCalledTimes(1)
      expect(value._node.unlockWithNativeExternalSigner).not.toHaveBeenCalled()
      value.unlock(unlockRequest)
      expect(value._node.initWithNativeExternalSigner).toHaveBeenCalledTimes(1)
      expect(value._node.unlockWithNativeExternalSigner).toHaveBeenCalledTimes(1)
      expect(value.getVssRestoreInfo()).toEqual({ ...receipt, unlocked: true })
    })

    it('preserves missing backup as missing, without inventing restore or unlocking a fresh wallet', () => {
      const value = binding()
      const missing = { ...receipt, restored: false, status: 'not_found', version: null }
      value._node.prepareVssRestore.mockReturnValue(missing)
      expect(value.prepareVssRestore(expected)).toBe(missing)
      expect(value._node.unlockWithNativeExternalSigner).not.toHaveBeenCalled()
      value._node.vssRestoreInfo.mockReturnValue(null)
      expect(value.getVssRestoreInfo()).toBeNull()
    })

    it('rejects a changed wallet identity before preparing local restore state', () => {
      const value = binding()
      expect(() => value.prepareVssRestore({ ...expected, nodeId: '03' + '22'.repeat(32) }))
        .toThrow(expect.objectContaining({ code: 'ERR_VSS_RECOVERY_SCOPE_MISMATCH' }))
      expect(value._node.initWithNativeExternalSigner).not.toHaveBeenCalled()
      expect(value._node.prepareVssRestore).not.toHaveBeenCalled()
    })

    it.each([
      null, {}, { ...receipt, version: null }, { ...receipt, version: 0 },
      { ...receipt, network: 'regtest' }, { ...receipt, node_id: '03' + '22'.repeat(32) },
      { ...receipt, master_fingerprint: 'ffffffff' }, { ...receipt, extra: true },
      { ...receipt, restored: false, status: 'restored' }
    ])('rejects invalid prepare provenance %p', (invalid) => {
      const value = binding()
      value._node.prepareVssRestore.mockReturnValue(invalid)
      expect(() => value.prepareVssRestore(expected)).toThrow('invalid restore provenance')
    })

    it('does not construct a native node to report missing restore provenance', () => {
      const value = new Binding(config)
      const ensure = jest.spyOn(value, 'ensureNode')
      expect(value.getVssRestoreInfo()).toBeNull()
      expect(ensure).not.toHaveBeenCalled()
    })

    it('distinguishes preparation from an actual unlocked native wallet', () => {
      const value = binding()
      value._node.vssRestoreInfo.mockReturnValue({ ...receipt, unlocked: false })
      expect(value.getVssRestoreInfo().unlocked).toBe(false)
    })
  })
}

it('allows read-only provenance inspection without granting preparation writes', async () => {
  const source = { ensureNode: jest.fn(), getVssRestoreInfo: jest.fn(() => ({ ...receipt, unlocked: true })) }
  const account = new WalletAccount({ binding: source })
  const readOnly = await account.toReadOnlyAccount()
  await expect(readOnly.getVssRestoreInfo()).resolves.toEqual({ ...receipt, unlocked: true })
  expect(readOnly.prepareVssRestore).toBeUndefined()
  expect(source.ensureNode).not.toHaveBeenCalled()
})

it('joins preparation with shutdown and refuses it during an existing unlock', async () => {
  let finish
  const pending = new Promise(resolve => { finish = resolve })
  const binding = { ensureNode: jest.fn(), prepareVssRestore: jest.fn(() => pending), shutdown: jest.fn(), unlock: jest.fn() }
  const account = new WalletAccount({ binding })
  const preparation = account.prepareVssRestore(expected)
  await Promise.resolve()
  const shutdown = account.shutdown()
  expect(binding.shutdown).not.toHaveBeenCalled()
  finish(receipt)
  await expect(preparation).resolves.toBe(receipt)
  await shutdown
  expect(binding.shutdown).toHaveBeenCalledTimes(1)
  await expect(account.prepareVssRestore(expected)).rejects.toBeInstanceOf(AccountLockedError)

  const other = new WalletAccount({ binding })
  other._unlockInFlight = { promise: Promise.resolve(), request: {} }
  await expect(other.prepareVssRestore(expected)).rejects.toBeInstanceOf(AccountLockedError)
})

it('returns a typed VSS failure without silently attempting ordinary unlock', async () => {
  const binding = { ensureNode: jest.fn(), prepareVssRestore: jest.fn(() => { throw new Error('download failed') }), unlock: jest.fn() }
  const account = new WalletAccount({ binding })
  await expect(account.prepareVssRestore(expected)).rejects.toBeInstanceOf(VssError)
  expect(binding.prepareVssRestore).toHaveBeenCalledTimes(1)
  expect(binding.unlock).not.toHaveBeenCalled()
})
