// Copyright 2026 UTEXO. Licensed under the Apache License, Version 2.0.
import { jest } from '@jest/globals'
import WalletAccount from '../src/wallet-account-rgb-lightning.js'
import { BareRgbLightningBinding } from '../src/bare-binding.js'
import { NodeRgbLightningBinding } from '../src/node-binding.js'
import { localVssStatus, validateVssBackupMetadata } from '../src/vss-policy.js'
import { AccountLockedError, VssError } from '../src/errors.js'

const config = { network: 'signet', dataDir: '/wallet', vssUrl: 'https://vss-server.utexo.com/vss' }
const nodeId = '02' + '11'.repeat(32)
const receipt = { version: 8, completed_at_ms: 1792400000000, network: 'signet', vss_url: config.vssUrl, node_id: nodeId }
const metadata = (enabled = true, last = null) => ({ schema_version: 1, automatic_backup_enabled: enabled, last_backup: last })
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const deferred = () => {
  let resolveDeferred, rejectDeferred
  const promise = new Promise((resolve, reject) => { resolveDeferred = resolve; rejectDeferred = reject })
  return { promise, resolve: resolveDeferred, reject: rejectDeferred }
}
const fixture = (initial = true, autoUnlockRequest) => {
  let enabled = initial
  const native = { sendBtc: jest.fn(() => ({ txid: 'once' })), address: jest.fn(() => ({ address: 'tb1qaddress' })) }
  const binding = {
    _config: config,
    ensureNode: () => native,
    vssStatus: () => localVssStatus(config),
    getVssBackupMetadata: jest.fn(() => metadata(enabled)),
    setVssAutomaticBackupEnabled: jest.fn(value => { enabled = value; return { automatic_backup_enabled: value } }),
    vssBackup: jest.fn(() => ({ version: 8 })),
    getVssBackupInfo: jest.fn(() => ({ backup_exists: true, version: 8, backup_required: false, last_auto_backup_failed: false })),
    unlock: jest.fn(),
    shutdown: jest.fn()
  }
  return { account: new WalletAccount({ binding, autoUnlockRequest }), binding, native }
}

describe.each([BareRgbLightningBinding, NodeRgbLightningBinding])('automatic VSS native contract %p', Binding => {
  it('omits absent initial policy and forwards explicit booleans before any handle is created', () => {
    expect(new Binding(config)._initRequest).not.toHaveProperty('vss_automatic_backup_enabled')
    for (const enabled of [false, true]) {
      const binding = new Binding({ ...config, vssAutomaticBackupEnabled: enabled })
      expect(binding._initRequest.vss_automatic_backup_enabled).toBe(enabled)
      expect(binding.vssStatus().enabled).toBe(true)
      expect(binding._node).toBeNull()
    }
    for (const value of [null, 0, 1, 'false', {}]) expect(() => new Binding({ ...config, vssAutomaticBackupEnabled: value })).toThrow(TypeError)
  })

  it('validates policy confirmation without changing the configured VSS status', () => {
    const binding = new Binding(config)
    binding._node = { setVssAutomaticBackupEnabled: jest.fn(() => ({ automatic_backup_enabled: false })) }
    expect(binding.setVssAutomaticBackupEnabled(false)).toEqual({ automatic_backup_enabled: false })
    expect(binding.vssStatus()).toEqual(localVssStatus(config))
    expect(binding._node.setVssAutomaticBackupEnabled).toHaveBeenCalledWith(false)
    expect(() => binding.setVssAutomaticBackupEnabled('false')).toThrow(TypeError)
    for (const invalid of [null, {}, { automatic_backup_enabled: true }, { automatic_backup_enabled: false, extra: 1 }]) {
      binding._node.setVssAutomaticBackupEnabled.mockReturnValue(invalid)
      expect(() => binding.setVssAutomaticBackupEnabled(false)).toThrow('invalid automatic backup policy')
    }
  })

  it('never creates native state merely to read metadata or change a locked policy', () => {
    const binding = new Binding(config)
    expect(() => binding.getVssBackupMetadata()).toThrow(AccountLockedError)
    expect(() => binding.setVssAutomaticBackupEnabled(false)).toThrow(AccountLockedError)
    expect(binding._node).toBeNull()
  })

  it('returns only versioned identity-bound native completion receipts, preserving unknown times', () => {
    const binding = new Binding(config)
    binding._signer = { bootstrap: () => ({ node_id: nodeId }) }
    binding._node = { vssBackupMetadata: jest.fn(() => metadata(false)) }
    expect(binding.getVssBackupMetadata()).toEqual(metadata(false))
    binding._node.vssBackupMetadata.mockReturnValue(metadata(true, { ...receipt, version: '8' }))
    expect(binding.getVssBackupMetadata()).toEqual(metadata(true, receipt))
  })
})

describe('strict VSS completion metadata', () => {
  const validate = value => validateVssBackupMetadata(value, config, { node_id: nodeId })
  it.each([null, {}, [], { ...metadata(), extra: 1 }, { ...metadata(), schema_version: 2 }, { ...metadata(), automatic_backup_enabled: 'true' }, { ...metadata(), last_backup: undefined }])('rejects malformed envelopes %p', value => {
    expect(() => validate(value)).toThrow('invalid backup')
  })
  it.each([
    { version: 0 }, { version: '08' }, { version: '9007199254740992' }, { version: 1.1 },
    { completed_at_ms: null }, { completed_at_ms: -1 }, { completed_at_ms: 1.5 }, { completed_at_ms: Infinity },
    { completed_at_ms: 8640000000000001 }, { network: 'regtest' }, { vss_url: 'https://different.invalid/vss' },
    { node_id: '03' + '22'.repeat(32) }, { extra: 'leak' }
  ])('rejects malformed or differently scoped completion receipts %p', patch => {
    expect(() => validate(metadata(true, { ...receipt, ...patch }))).toThrow('invalid backup completion receipt')
  })
})

describe('automatic snapshot policy and account admission', () => {
  it('defaults to enabled and honors a saved native off choice immediately after cold unlock', async () => {
    const enabled = fixture()
    await enabled.account.sendBtc({ amount: 1 })
    await enabled.account.shutdown()
    expect(enabled.binding.vssBackup).toHaveBeenCalledTimes(1)
    const off = fixture(false)
    await off.account.unlock({ indexer_url: 'https://indexer.invalid', proxy_endpoint: 'rpcs://proxy.invalid/json-rpc', announce_addresses: [], announce_alias: 'test' })
    await off.account.sendBtc({ amount: 1 })
    await off.account.shutdown()
    expect(off.binding.vssBackup).not.toHaveBeenCalled()
    expect(off.account._vssDirty).toBe(true)
  })

  it('drains an admitted upload before off and starts a later send only after confirmed off', async () => {
    const { account, binding, native } = fixture()
    const upload = deferred()
    binding.vssBackup.mockReturnValueOnce(upload.promise)
    await account.sendBtc({ amount: 1 })
    await flush()
    const off = account.setVssAutomaticBackupEnabled(false)
    const later = account.sendBtc({ amount: 2 })
    await flush()
    expect(binding.setVssAutomaticBackupEnabled).not.toHaveBeenCalled()
    expect(native.sendBtc).toHaveBeenCalledTimes(1)
    upload.resolve({ version: 8 })
    await expect(off).resolves.toEqual({ automatic_backup_enabled: false })
    await later
    await account.shutdown()
    expect(native.sendBtc).toHaveBeenCalledTimes(2)
    expect(binding.vssBackup).toHaveBeenCalledTimes(1)
    expect(await account.vssStatus()).toEqual(localVssStatus(config))
  })

  it('joins a financial call admitted before off, without retrying it or losing its checkpoint', async () => {
    const { account, binding, native } = fixture()
    const send = deferred()
    native.sendBtc.mockReturnValueOnce(send.promise)
    const first = account.sendBtc({ amount: 1 })
    const off = account.setVssAutomaticBackupEnabled(false)
    await flush()
    expect(binding.setVssAutomaticBackupEnabled).not.toHaveBeenCalled()
    send.resolve({ txid: 'once' })
    await first
    await off
    expect(native.sendBtc).toHaveBeenCalledTimes(1)
    expect(binding.vssBackup).toHaveBeenCalledTimes(1)
    await account.shutdown()
  })

  it('keeps manual backup and read-only metadata available while automatic backup is off', async () => {
    const { account, binding } = fixture(false)
    await expect(account.vssBackup()).resolves.toEqual({ version: 8 })
    const readOnly = await account.toReadOnlyAccount()
    expect(await readOnly.getVssBackupMetadata()).toEqual(metadata(false))
    expect(readOnly.setVssAutomaticBackupEnabled).toBeUndefined()
    expect(binding.getVssBackupInfo).not.toHaveBeenCalled()
    await account.shutdown()
    expect(binding.vssBackup).toHaveBeenCalledTimes(1)
  })

  it('uses native atomic catch-up when re-enabled and resumes subsequent automatic snapshots', async () => {
    const { account, binding } = fixture(false)
    await account.sendBtc({ amount: 1 })
    expect(binding.vssBackup).not.toHaveBeenCalled()
    expect(account._vssDirty).toBe(true)
    await expect(account.setVssAutomaticBackupEnabled(true)).resolves.toEqual({ automatic_backup_enabled: true })
    expect(binding.setVssAutomaticBackupEnabled).toHaveBeenCalledWith(true)
    expect(account._vssDirty).toBe(false)
    await account.sendBtc({ amount: 2 })
    await account.shutdown()
    expect(binding.vssBackup).toHaveBeenCalledTimes(1)
  })

  it.each([false, true])('retains confirmed prior policy when transition to %p fails and releases queued work', async enabled => {
    const { account, binding, native } = fixture(!enabled)
    await account.getVssBackupMetadata()
    binding.setVssAutomaticBackupEnabled.mockImplementationOnce(() => { throw new Error('durable write failed') })
    const change = account.setVssAutomaticBackupEnabled(enabled)
    const send = account.sendBtc({ amount: 1 })
    await expect(change).rejects.toBeInstanceOf(VssError)
    await expect(send).resolves.toEqual({ txid: 'once' })
    expect(native.sendBtc).toHaveBeenCalledTimes(1)
    expect((await account.getVssBackupMetadata()).automatic_backup_enabled).toBe(!enabled)
    await account.shutdown()
    expect(binding.vssBackup).toHaveBeenCalledTimes(enabled ? 0 : 1)
  })

  it('rereads native policy after an indeterminate setter error instead of assuming the cached choice', async () => {
    const { account, binding } = fixture()
    await account.getVssBackupMetadata()
    const original = binding.setVssAutomaticBackupEnabled.getMockImplementation()
    binding.setVssAutomaticBackupEnabled.mockImplementationOnce(enabled => {
      original(enabled) // Models an upload/commit whose acknowledgement was lost.
      throw new Error('policy outcome not confirmed')
    })
    await expect(account.setVssAutomaticBackupEnabled(false)).rejects.toBeInstanceOf(VssError)
    await account.sendBtc({ amount: 1 })
    expect((await account.getVssBackupMetadata()).automatic_backup_enabled).toBe(false)
    await account.shutdown()
    expect(binding.vssBackup).not.toHaveBeenCalled()
  })

  it('pauses automatic hooks while failed native policy is unknown, keeps manual backup and recovers after a confirmed read', async () => {
    const { account, binding, native } = fixture()
    await account.getVssBackupMetadata()
    binding.setVssAutomaticBackupEnabled.mockImplementationOnce(() => { throw new Error('policy storage unavailable') })
    await expect(account.setVssAutomaticBackupEnabled(false)).rejects.toBeInstanceOf(VssError)
    binding.getVssBackupMetadata.mockImplementation(() => { throw new Error('policy is unknown') })
    await expect(account.sendBtc({ amount: 1 })).resolves.toEqual({ txid: 'once' })
    expect(binding.vssBackup).not.toHaveBeenCalled()
    expect(account._vssDirty).toBe(true)
    await expect(account.vssBackup()).resolves.toEqual({ version: 8 })
    expect(binding.vssBackup).toHaveBeenCalledTimes(1)
    binding.getVssBackupMetadata.mockReturnValue(metadata(true))
    await account.sendBtc({ amount: 2 })
    await account.shutdown()
    expect(native.sendBtc).toHaveBeenCalledTimes(2)
    expect(binding.vssBackup).toHaveBeenCalledTimes(2)
  })

  it('serializes rapid opposing transitions with admitted sends and drains all before shutdown', async () => {
    const { account, binding, native } = fixture()
    const setter = deferred()
    const original = binding.setVssAutomaticBackupEnabled.getMockImplementation()
    binding.setVssAutomaticBackupEnabled.mockImplementationOnce(async enabled => { await setter.promise; return original(enabled) })
    const off = account.setVssAutomaticBackupEnabled(false)
    const send = account.sendBtc({ amount: 1 })
    const on = account.setVssAutomaticBackupEnabled(true)
    const shutdown = account.shutdown()
    await flush()
    expect(native.sendBtc).not.toHaveBeenCalled()
    expect(binding.shutdown).not.toHaveBeenCalled()
    setter.resolve()
    await off
    await expect(send).resolves.toEqual({ txid: 'once' })
    await on
    await shutdown
    expect(binding.setVssAutomaticBackupEnabled.mock.calls).toEqual([[false], [true]])
    expect(native.sendBtc).toHaveBeenCalledTimes(1)
    expect(binding.vssBackup).not.toHaveBeenCalled()
    expect(binding.shutdown).toHaveBeenCalledTimes(1)
    await expect(account.setVssAutomaticBackupEnabled(false)).rejects.toBeInstanceOf(AccountLockedError)
  })

  it.each([false, true])('drains an admitted locked address and its auto-unlock before off (explicit unlock=%p)', async explicit => {
    const request = { indexer_url: 'https://indexer.invalid', proxy_endpoint: 'rpcs://proxy.invalid/json-rpc', announce_addresses: [], announce_alias: 'test' }
    const { account, binding, native } = fixture(true, request)
    let unlocked = false
    native.address.mockImplementation(() => {
      if (!unlocked) throw new Error('LockedNode')
      return { address: 'tb1qaddress' }
    })
    binding.unlock.mockImplementation(() => { unlocked = true })
    const address = account.getAddress()
    const off = account.setVssAutomaticBackupEnabled(false)
    const unlock = explicit ? account.unlock(request) : Promise.resolve()
    await expect(address).resolves.toBe('tb1qaddress')
    await unlock
    await expect(off).resolves.toEqual({ automatic_backup_enabled: false })
    await account.shutdown()
    expect(binding.unlock).toHaveBeenCalledTimes(1)
    expect(binding.setVssAutomaticBackupEnabled).toHaveBeenCalledTimes(1)
  })

  it('orders two policy transitions around a locked address and manual backup without an unlock cycle', async () => {
    const request = { indexer_url: 'https://indexer.invalid', proxy_endpoint: 'rpcs://proxy.invalid/json-rpc', announce_addresses: [], announce_alias: 'test' }
    const { account, binding, native } = fixture(true, request)
    let unlocked = false
    native.address.mockImplementation(() => {
      if (!unlocked) throw new Error('LockedNode')
      return { address: 'tb1qaddress' }
    })
    binding.unlock.mockImplementation(() => { unlocked = true })
    const off = account.setVssAutomaticBackupEnabled(false)
    const address = account.getAddress()
    const on = account.setVssAutomaticBackupEnabled(true)
    const unlock = account.unlock(request)
    const manual = account.vssBackup()
    await off
    await expect(address).resolves.toBe('tb1qaddress')
    await on
    await unlock
    await expect(manual).resolves.toEqual({ version: 8 })
    await account.shutdown()
    expect(binding.unlock).toHaveBeenCalledTimes(1)
    expect(binding.setVssAutomaticBackupEnabled.mock.calls).toEqual([[false], [true]])
  })

  it('joins a manual backup admitted after an off transition and later unlock before teardown', async () => {
    const { account, binding } = fixture()
    const request = { indexer_url: 'https://indexer.invalid', proxy_endpoint: 'rpcs://proxy.invalid/json-rpc', announce_addresses: [], announce_alias: 'test' }
    const off = account.setVssAutomaticBackupEnabled(false)
    const unlock = account.unlock(request)
    const manual = account.vssBackup()
    const shutdown = account.shutdown()
    await off
    await unlock
    await expect(manual).resolves.toEqual({ version: 8 })
    await shutdown
    expect(binding.vssBackup).toHaveBeenCalledTimes(1)
    expect(binding.shutdown).toHaveBeenCalledTimes(1)
  })

  it('finishes an already admitted locked address when shutdown starts before native unlock', async () => {
    const request = { indexer_url: 'https://indexer.invalid', proxy_endpoint: 'rpcs://proxy.invalid/json-rpc', announce_addresses: [], announce_alias: 'test' }
    const { account, binding, native } = fixture(false, request)
    let unlocked = false
    native.address.mockImplementation(() => {
      if (!unlocked) throw new Error('LockedNode')
      return { address: 'tb1qaddress' }
    })
    binding.unlock.mockImplementation(() => { unlocked = true })
    const address = account.getAddress()
    const stop = account.shutdown()
    await expect(address).resolves.toBe('tb1qaddress')
    await stop
    expect(binding.unlock).toHaveBeenCalledTimes(1)
    expect(binding.vssBackup).not.toHaveBeenCalled()
  })

  it('settles all 720 orderings of policy, locked address, unlock, manual backup and shutdown', async () => {
    const permutations = values => values.length === 0
      ? [[]]
      : values.flatMap((value, index) =>
        permutations(values.filter((_, candidate) => candidate !== index)).map(rest => [value, ...rest]))
    const request = { indexer_url: 'https://indexer.invalid', proxy_endpoint: 'rpcs://proxy.invalid/json-rpc', announce_addresses: [], announce_alias: 'test' }
    const orders = permutations(['off', 'on', 'address', 'unlock', 'manual', 'shutdown'])
    expect(orders).toHaveLength(720)
    for (const order of orders) {
      const { account, binding, native } = fixture(true, request)
      let unlocked = false
      native.address.mockImplementation(() => {
        if (!unlocked) throw new Error('LockedNode')
        return { address: 'tb1qaddress' }
      })
      binding.unlock.mockImplementation(() => { unlocked = true })
      const actions = {
        off: () => account.setVssAutomaticBackupEnabled(false),
        on: () => account.setVssAutomaticBackupEnabled(true),
        address: () => account.getAddress(),
        unlock: () => account.unlock(request),
        manual: () => account.vssBackup(),
        shutdown: () => account.shutdown()
      }
      // Calls after shutdown may reject. Every admitted call must settle without
      // forming a cycle; catch immediately so rejected late calls are observed.
      const operations = order.map(action => actions[action]().catch(() => {}))
      let settled = false
      const completion = Promise.all(operations).then(() => { settled = true })
      for (let tick = 0; tick < 150; tick++) {
        if (settled) break
        await Promise.resolve()
      }
      expect({ order, settled }).toEqual({ order, settled: true })
      await completion
    }
  })

  it('rejects nonboolean choices before native dispatch', async () => {
    const { account, binding } = fixture()
    await expect(account.setVssAutomaticBackupEnabled('true')).rejects.toBeInstanceOf(TypeError)
    expect(binding.setVssAutomaticBackupEnabled).not.toHaveBeenCalled()
  })
})
