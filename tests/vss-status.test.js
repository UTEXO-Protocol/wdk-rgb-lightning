// Copyright 2026 UTEXO. Licensed under the Apache License, Version 2.0.
import { jest } from '@jest/globals'
import WalletAccount from '../src/wallet-account-rgb-lightning.js'
import WalletManager from '../src/wallet-manager-rgb-lightning.js'
import { BareRgbLightningBinding } from '../src/bare-binding.js'
import { NodeRgbLightningBinding } from '../src/node-binding.js'
import { VssError, VssNotConfiguredError, AccountLockedError } from '../src/errors.js'
import { VSS_SAFETY_POLICY, localVssStatus } from '../src/vss-policy.js'
import bare from '@utexo/rgb-lightning-node-bare'
import node from '@utexo/rgb-lightning-node-nodejs'

const config = { network: 'regtest', dataDir: '/unused' }
const configured = { ...config, vssUrl: 'https://vss-server.utexo.com/vss' }
const cases = [[BareRgbLightningBinding, bare], [NodeRgbLightningBinding, node]]
const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const deferred = () => {
  let resolveDeferred, rejectDeferred
  const promise = new Promise((resolve, reject) => { resolveDeferred = resolve; rejectDeferred = reject })
  return { promise, resolve: resolveDeferred, reject: rejectDeferred }
}
const accountWith = (overrides = {}) => {
  const nativeNode = { sendBtc: jest.fn(() => ({ txid: 'sent' })) }
  const binding = {
    _config: configured,
    ensureNode: jest.fn(() => nativeNode),
    vssStatus: jest.fn(() => localVssStatus(configured)),
    vssBackup: jest.fn(() => ({ version: 7 })),
    clearVssFence: jest.fn(() => ({ ok: true })),
    getVssBackupInfo: jest.fn(() => ({ backup_exists: true, version: 7, backup_required: false, last_auto_backup_failed: false })),
    shutdown: jest.fn(),
    ...overrides
  }
  return { account: new WalletAccount({ binding }), binding, nativeNode }
}

afterEach(() => jest.restoreAllMocks())

describe('VSS explicit configuration', () => {
  it.each([null, '', ' ', false, 0, {}, 'http://localhost/vss', 'https://u:secret@host.invalid/vss', 'https://host/vss?token=secret', 'https://host/vss#fragment', 'file:///tmp/vss'])(
    'rejects invalid configuration before a manager creates native state: %p', (vssUrl) => {
      class Manager extends WalletManager {
        static get Binding () { throw new Error('Binding must not be accessed') }
      }
      expect(() => new Manager(mnemonic, { ...config, vssUrl })).toThrow(TypeError)
    }
  )

  it.each(cases)('forwards HTTPS and explicit restore policy in %p without creating handles', (Binding, native) => {
    const create = jest.spyOn(native.SdkNode, 'create')
    const signer = jest.spyOn(native.NativeExternalSigner, 'createWithStorage')
    const binding = new Binding({ ...configured, vssAllowEmptyRestore: true })
    expect(binding._initRequest).toMatchObject({ vss_url: configured.vssUrl, vss_allow_http: false, vss_allow_empty_restore: true })
    expect(binding.vssStatus()).toEqual(localVssStatus(configured))
    expect(create).not.toHaveBeenCalled()
    expect(signer).not.toHaveBeenCalled()
    expect(new Binding({ ...config, vssUrl: 'http://127.0.0.1/vss', vssAllowHttp: true })._initRequest.vss_allow_http).toBe(true)
  })

  it.each(cases)('does not infer an endpoint or forward orphan flags in %p', (Binding) => {
    const binding = new Binding({ ...config, vssAllowHttp: true, vssAllowEmptyRestore: true })
    expect(binding._initRequest).not.toHaveProperty('vss_url')
    expect(binding._initRequest).not.toHaveProperty('vss_allow_http')
    expect(binding._initRequest).not.toHaveProperty('vss_allow_empty_restore')
    expect(binding.vssStatus()).toEqual(localVssStatus(config))
    expect(() => binding.vssBackup()).toThrow(VssNotConfiguredError)
    expect(() => binding.clearVssFence('')).toThrow(VssNotConfiguredError)
  })

  it.each(['vssAllowHttp', 'vssAllowEmptyRestore'])('requires booleans for %s', (key) => {
    expect(() => new NodeRgbLightningBinding({ ...configured, [key]: 'true' })).toThrow(TypeError)
  })
})

describe.each(cases)('VSS binding operations %p', (Binding) => {
  it('dispatches exactly once, retains only successful versions, and allows explicit fence requests', () => {
    const binding = new Binding(configured)
    const nativeNode = { vssBackup: jest.fn(() => ({ version: 7 })), vssClearFence: jest.fn(), vssBackupInfo: jest.fn(() => ({ backup_exists: true, version: 7, backup_required: false, last_auto_backup_failed: false })) }
    binding._node = nativeNode
    expect(binding.vssBackup()).toEqual({ version: 7 })
    expect(binding.vssStatus().lastBackupVersion).toBe(7)
    nativeNode.vssBackup.mockImplementation(() => { throw new Error('server offline') })
    expect(() => binding.vssBackup()).toThrow('server offline')
    expect(binding.vssStatus().lastBackupVersion).toBe(7)
    expect(binding.clearVssFence('')).toEqual({ ok: true })
    expect(nativeNode.vssClearFence).toHaveBeenCalledWith({ password: '' })
    expect(nativeNode.vssBackup).toHaveBeenCalledTimes(2)
    expect(() => binding.clearVssFence(null)).toThrow(TypeError)
  })

  it('acknowledges the canonical remote manifest across upload format counters', () => {
    const binding = new Binding(configured)
    binding._node = {
      vssBackup: jest.fn(() => ({ version: 1 })),
      vssBackupInfo: jest.fn(() => ({ backup_exists: true, version: 100, backup_required: false, last_auto_backup_failed: false }))
    }
    expect(binding.vssBackup()).toEqual({ version: 100 })
    expect(binding.vssStatus().lastBackupVersion).toBe(100)
    expect(binding._node.vssBackup).toHaveBeenCalledTimes(1)
    binding._node.vssBackupInfo.mockImplementation(() => { throw new Error('offline') })
    expect(() => binding.vssBackup()).toThrow(VssError)
    expect(binding.vssStatus().lastBackupVersion).toBe(100)
    expect(binding._node.vssBackup).toHaveBeenCalledTimes(2)
  })

  it.each([
    { backup_exists: false, version: null, backup_required: false, last_auto_backup_failed: false },
    { backup_exists: true, version: 100, backup_required: true, last_auto_backup_failed: false }
  ])('never acknowledges an unconfirmed or dirty post-upload state %p', (info) => {
    const binding = new Binding(configured)
    binding._node = { vssBackup: jest.fn(() => ({ version: 1 })), vssBackupInfo: () => info }
    expect(() => binding.vssBackup()).toThrow(VssError)
    expect(binding.vssStatus().lastBackupVersion).toBeNull()
    expect(binding._node.vssBackup).toHaveBeenCalledTimes(1)
  })

  it('acknowledges a successful manual upload despite an historical native auto-backup error', () => {
    const binding = new Binding(configured)
    binding._node = {
      vssBackup: () => ({ version: 1 }),
      vssBackupInfo: () => ({ backup_exists: true, version: 100, backup_required: false, last_auto_backup_failed: true })
    }
    expect(binding.vssBackup()).toEqual({ version: 100 })
    expect(binding.getVssBackupInfo().last_auto_backup_failed).toBe(true)
  })

  it('binds takeover to the exact account, network and endpoint before native dispatch', () => {
    const binding = new Binding(configured)
    binding._node = { vssClearFence: jest.fn() }
    binding._signer = { bootstrap: () => ({ node_id: '02' + '11'.repeat(32) }) }
    const scope = { network: configured.network, dataDir: configured.dataDir, vssUrl: configured.vssUrl, nodeId: '02' + '11'.repeat(32) }
    for (const changed of [null, {}, { ...scope, network: 'signet' }, { ...scope, dataDir: '/another-wallet' }, { ...scope, vssUrl: 'https://another.invalid/vss' }, { ...scope, nodeId: '03' + '22'.repeat(32) }, { ...scope, extra: true }]) {
      expect(() => binding.clearVssFence('', changed)).toThrow(expect.objectContaining({ code: 'ERR_VSS_RECOVERY_SCOPE_MISMATCH' }))
    }
    expect(binding._node.vssClearFence).not.toHaveBeenCalled()
    expect(binding.clearVssFence('', scope)).toEqual({ ok: true })
    expect(binding._node.vssClearFence).toHaveBeenCalledTimes(1)
  })

  it('reads real backup information without upload or takeover and caches the observed version', () => {
    const binding = new Binding(configured)
    const info = { backup_exists: true, version: 11, backup_required: false, last_auto_backup_failed: false }
    binding._node = { vssBackupInfo: jest.fn(() => info), vssBackup: jest.fn(), vssClearFence: jest.fn() }
    expect(binding.getVssBackupInfo()).toEqual(info)
    expect(binding.vssStatus().lastBackupVersion).toBe(11)
    expect(binding._node.vssBackup).not.toHaveBeenCalled()
    expect(binding._node.vssClearFence).not.toHaveBeenCalled()
    binding._node.vssBackupInfo.mockReturnValue({ backup_exists: false, version: null, backup_required: true, last_auto_backup_failed: true })
    expect(binding.getVssBackupInfo().last_auto_backup_failed).toBe(true)
    expect(binding.vssStatus().lastBackupVersion).toBeNull()
  })

  it.each([
    { backup_exists: false, version: 7, backup_required: false, last_auto_backup_failed: false },
    { backup_exists: true, version: null, backup_required: false, last_auto_backup_failed: false },
    { backup_exists: true, version: 0, backup_required: false, last_auto_backup_failed: false },
    { backup_exists: true, version: 7, backup_required: false, last_auto_backup_failed: false, secret: 'extra' }
  ])('rejects inconsistent backup observations %p', (info) => {
    const binding = new Binding(configured)
    binding._node = { vssBackupInfo: () => info }
    expect(() => binding.getVssBackupInfo()).toThrow('invalid backup information')
    expect(binding.vssStatus().lastBackupVersion).toBeNull()
  })

  it('surfaces wrapper checkpoint failures without overwriting native evidence, and clears on success', () => {
    const binding = new Binding(configured)
    binding._node = {
      vssBackupInfo: () => ({ backup_exists: true, version: 11, backup_required: false, last_auto_backup_failed: false }),
      vssBackup: () => ({ version: 12 })
    }
    binding._vssCheckpointFailed = true
    expect(binding.getVssBackupInfo()).toEqual({ backup_exists: true, version: 11, backup_required: true, last_auto_backup_failed: true })
    expect(binding.vssStatus().lastBackupVersion).toBe(11)
    binding.vssBackup()
    expect(binding._vssCheckpointFailed).toBe(false)
    expect(binding.getVssBackupInfo().last_auto_backup_failed).toBe(false)
  })

  it('never creates a node to read backup information while locked', () => {
    const binding = new Binding(configured)
    const ensure = jest.spyOn(binding, 'ensureNode')
    expect(() => binding.getVssBackupInfo()).toThrow(AccountLockedError)
    expect(ensure).not.toHaveBeenCalled()
  })

  it.each([null, {}, { version: -1 }, { version: 0 }, { version: 1.5 }, { version: Number.MAX_SAFE_INTEGER + 1 }, { version: '7' }])('rejects malformed backup version %p', (result) => {
    const binding = new Binding(configured)
    binding._node = { vssBackup: () => result }
    expect(() => binding.vssBackup()).toThrow('invalid RGB backup version')
    expect(binding.vssStatus().lastBackupVersion).toBeNull()
  })
})

describe('VSS account ownership and lifecycle', () => {
  it('keeps local status readable without granting mutations to the read-only facade', async () => {
    const { account, binding } = accountWith()
    const readOnly = await account.toReadOnlyAccount()
    expect(await readOnly.vssStatus()).toEqual(localVssStatus(configured))
    await expect(readOnly.getVssBackupInfo()).resolves.toEqual({ backup_exists: true, version: 7, backup_required: false, last_auto_backup_failed: false })
    expect(readOnly.vssBackup).toBeUndefined()
    expect(readOnly.clearVssFence).toBeUndefined()
    expect(readOnly.getCapabilities().vss).toEqual({ ...VSS_SAFETY_POLICY, automaticBackup: false, manualBackup: false, restore: false, remoteErasure: false })
    expect(account.getCapabilities().vss).toEqual({ ...VSS_SAFETY_POLICY, automaticBackup: true, manualBackup: true, restore: true, remoteErasure: false })
    expect(binding.ensureNode).not.toHaveBeenCalled()
  })

  it('serializes backups and drains admitted work before shutdown', async () => {
    const gate = deferred()
    const { account, binding } = accountWith({ vssBackup: jest.fn().mockImplementationOnce(() => gate.promise).mockReturnValue({ version: 8 }) })
    const first = account.vssBackup()
    const second = account.vssBackup()
    await Promise.resolve()
    expect(binding.vssBackup).toHaveBeenCalledTimes(1)
    const shutdown = account.shutdown()
    await Promise.resolve()
    expect(binding.shutdown).not.toHaveBeenCalled()
    await expect(account.vssBackup()).rejects.toBeInstanceOf(AccountLockedError)
    gate.resolve({ version: 7 })
    await expect(first).resolves.toEqual({ version: 7 })
    await expect(second).resolves.toEqual({ version: 8 })
    await shutdown
    expect(binding.shutdown).toHaveBeenCalledTimes(1)
    expect(binding.clearVssFence).not.toHaveBeenCalled()
  })

  it('types native failures and preserves unconfigured/locked errors without replay', async () => {
    const { account, binding } = accountWith()
    binding.vssBackup.mockImplementationOnce(() => { throw new Error('LockedNode') })
    await expect(account.vssBackup()).rejects.toBeInstanceOf(AccountLockedError)
    binding.vssBackup.mockImplementationOnce(() => { throw new VssNotConfiguredError() })
    await expect(account.vssBackup()).rejects.toBeInstanceOf(VssNotConfiguredError)
    binding.vssBackup.mockImplementationOnce(() => { throw new Error('server offline') })
    await expect(account.vssBackup()).rejects.toBeInstanceOf(VssError)
    expect(binding.vssBackup).toHaveBeenCalledTimes(3)
    await expect(account.clearVssFence('')).resolves.toEqual({ ok: true })
  })

  it('does not convert a successful send into an error or replay it when checkpoint fails', async () => {
    const { account, binding, nativeNode } = accountWith({ vssBackup: jest.fn(() => { throw new Error('offline') }) })
    await expect(account.sendBtc({ address: 'test', amount: 1 })).resolves.toEqual({ txid: 'sent' })
    await account.shutdown()
    expect(nativeNode.sendBtc).toHaveBeenCalledTimes(1)
    expect(binding.vssBackup).toHaveBeenCalledTimes(1)
    expect(binding._vssCheckpointFailed).toBe(true)
    expect(binding.clearVssFence).not.toHaveBeenCalled()
  })

  it('does not checkpoint or replay a failed mutation', async () => {
    const { account, binding, nativeNode } = accountWith()
    nativeNode.sendBtc.mockImplementation(() => { throw new Error('send failed') })
    await expect(account.sendBtc({ amount: 1 })).rejects.toThrow('send failed')
    await account.shutdown()
    expect(nativeNode.sendBtc).toHaveBeenCalledTimes(1)
    expect(binding.vssBackup).not.toHaveBeenCalled()
  })

  it('waits for an admitted unlock before backup and never auto-clears fences', async () => {
    const gate = deferred()
    const { account, binding } = accountWith({ unlock: jest.fn(() => gate.promise) })
    // A normalized external unlock request, with no local password material.
    const unlock = account.unlock({ indexer_url: 'https://indexer.invalid', proxy_endpoint: 'rpcs://proxy.invalid/json-rpc', announce_addresses: [], announce_alias: 'test' })
    const backup = account.vssBackup()
    await Promise.resolve()
    expect(binding.vssBackup).not.toHaveBeenCalled()
    gate.resolve()
    await expect(unlock).resolves.toEqual({ ok: true })
    await expect(backup).resolves.toEqual({ version: 7 })
    await account.shutdown()
    expect(binding.clearVssFence).not.toHaveBeenCalled()
  })

  it.each([false, true])('drains an admitted send and its checkpoint when shutdown starts in the same turn (async=%p)', async (asynchronous) => {
    const calls = []
    const gate = deferred()
    const { account, binding, nativeNode } = accountWith({
      vssBackup: jest.fn(() => { calls.push('backup'); return { version: 7 } }),
      shutdown: jest.fn(() => { calls.push('shutdown') })
    })
    nativeNode.sendBtc.mockImplementation(() => { calls.push('send'); return asynchronous ? gate.promise : { txid: 'sent' } })
    const send = account.sendBtc({ amount: 1 })
    const stop = account.shutdown()
    await expect(account.sendBtc({ amount: 2 })).rejects.toBeInstanceOf(AccountLockedError)
    if (asynchronous) {
      await Promise.resolve()
      expect(binding.shutdown).not.toHaveBeenCalled()
      gate.resolve({ txid: 'sent' })
    }
    await expect(send).resolves.toEqual({ txid: 'sent' })
    await stop
    expect(calls).toEqual(['send', 'backup', 'shutdown'])
    expect(binding._vssCheckpointFailed).toBe(false)
    expect(account._vssDirty).toBe(false)
  })

  it('coalesces queued mutation checkpoints and records a later mutation during an upload', async () => {
    const gate = deferred()
    const { account, binding } = accountWith({ vssBackup: jest.fn().mockReturnValueOnce(gate.promise).mockReturnValue({ version: 8 }) })
    const first = account.sendBtc({ amount: 1 })
    const second = account.sendBtc({ amount: 2 })
    await Promise.all([first, second])
    await Promise.resolve()
    expect(binding.vssBackup).toHaveBeenCalledTimes(1)
    await account.sendBtc({ amount: 3 })
    gate.resolve({ version: 7 })
    await account.shutdown()
    expect(binding.vssBackup).toHaveBeenCalledTimes(2)
    expect(binding._vssCheckpointFailed).toBe(false)
  })
})

it.each(cases)('requires exact enabled compiled metadata for %p', (Binding, native) => {
  const runtime = native.getRuntimeInfo()
  const spy = jest.spyOn(native, 'getRuntimeInfo')
  const invalid = [undefined, null, [], {}, { ...VSS_SAFETY_POLICY, supported: false }, { ...VSS_SAFETY_POLICY, code: 'OTHER' }, { ...VSS_SAFETY_POLICY, reason: 'unknown' }, { ...VSS_SAFETY_POLICY, extra: true }]
  for (const vssPolicy of invalid) {
    spy.mockReturnValue({ ...runtime, vss_policy: vssPolicy })
    expect(() => new Binding(configured)).toThrow(expect.objectContaining({ code: 'ERR_RLN_RUNTIME_MISMATCH' }))
  }
  for (const capability of ['vss-backup-v1', 'vss-automatic-backup-v1', 'vss-backup-metadata-v1']) {
    spy.mockReturnValue({ ...runtime, capabilities: runtime.capabilities.filter(value => value !== capability) })
    expect(() => new Binding(configured)).toThrow(expect.objectContaining({ code: 'ERR_RLN_RUNTIME_MISMATCH' }))
  }
})
