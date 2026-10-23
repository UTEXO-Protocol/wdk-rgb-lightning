// Copyright 2026 UTEXO. Licensed under the Apache License, Version 2.0.
import { jest } from '@jest/globals'
import WalletAccount from '../src/wallet-account-rgb-lightning.js'
import { BareRgbLightningBinding } from '../src/bare-binding.js'
import { NodeRgbLightningBinding } from '../src/node-binding.js'

const config = { network: 'regtest', dataDir: '/wallet', vssUrl: 'https://vss.invalid/vss' }
const nodeId = '02' + '11'.repeat(32)
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
const deferred = () => {
  let resolveDeferred
  const promise = new Promise(resolve => { resolveDeferred = resolve })
  return { promise, resolve: resolveDeferred }
}
const fixture = async Binding => {
  const state = { version: 8, dirty: false, failed: false, enabled: true }
  const completion = () => ({
    version: state.version,
    completed_at_ms: 1792508400000 + state.version,
    network: config.network,
    vss_url: config.vssUrl,
    node_id: nodeId
  })
  const info = () => ({
    backup_exists: true,
    version: state.version,
    backup_required: state.dirty,
    last_auto_backup_failed: state.failed
  })
  const metadata = () => ({ schema_version: 1, automatic_backup_enabled: state.enabled, last_backup: completion() })
  const native = {
    sendBtc: jest.fn(() => { state.version++; return { txid: 'once' } }),
    refreshTransfers: jest.fn(() => ({ transfers: {} })),
    vssBackupInfo: jest.fn(info),
    vssBackupMetadata: jest.fn(metadata),
    vssBackup: jest.fn(() => { state.version++; state.dirty = false; state.failed = false; return { version: state.version } }),
    setVssAutomaticBackupEnabled: jest.fn(enabled => { state.enabled = enabled; return { automatic_backup_enabled: enabled } }),
    shutdown: jest.fn()
  }
  const binding = new Binding(config)
  binding._node = native
  binding._signer = { bootstrap: () => ({ node_id: nodeId }), shutdown: jest.fn(), destroy: jest.fn() }
  const account = new WalletAccount({ binding })
  await account.getVssBackupMetadata() // Establish the confirmed automatic policy before adversarial status reads.
  return { account, binding, native, state, completion, metadata, info }
}

describe.each([BareRgbLightningBinding, NodeRgbLightningBinding])('automatic native checkpoint reconciliation %p', Binding => {
  it('does not upload again after native already acknowledged a completed payment', async () => {
    const { account, native, state } = await fixture(Binding)
    await expect(account.sendBtc({ amount: 1 })).resolves.toEqual({ txid: 'once' })
    await account.shutdown()
    expect(native.sendBtc).toHaveBeenCalledTimes(1)
    expect(native.vssBackupInfo).toHaveBeenCalled()
    expect(native.vssBackupMetadata).toHaveBeenCalled()
    expect(native.vssBackup).not.toHaveBeenCalled()
    expect(state.version).toBe(9)
    expect(account._vssDirty).toBe(false)
  })

  it('keeps the same version and completion time through five unchanged native refreshes', async () => {
    const { account, native, state, completion } = await fixture(Binding)
    const before = completion()
    for (let i = 0; i < 5; i++) {
      await expect(account.refreshTransfers({ skip_sync: false })).resolves.toEqual({ transfers: {} })
      await account._vssTail
    }
    await account.shutdown()
    expect(native.refreshTransfers).toHaveBeenCalledTimes(5)
    expect(native.vssBackup).not.toHaveBeenCalled()
    expect(state.version).toBe(8)
    expect(completion()).toEqual(before)
  })

  it('retains explicit manual uploads for a clean current native checkpoint', async () => {
    const { account, native, state } = await fixture(Binding)
    await expect(account.vssBackup()).resolves.toEqual({ version: 9 })
    await account.shutdown()
    expect(native.vssBackup).toHaveBeenCalledTimes(1)
    expect(state.version).toBe(9)
  })

  it('does not invalidate an existing clean acknowledgement when native automatic policy is off', async () => {
    const { account, native, state } = await fixture(Binding)
    // Policy transitions normally update both layers. A native observer's saved
    // off choice does not turn an already acknowledged snapshot into dirty work.
    state.enabled = false
    await account.refreshTransfers({ skip_sync: false })
    await account.shutdown()
    expect(native.vssBackup).not.toHaveBeenCalled()
    expect(state.version).toBe(8)
  })

  it.each(['dirty', 'failed', 'wdk-failed'])('does not erase an earlier %s checkpoint obligation', async failure => {
    const { account, native, binding, state } = await fixture(Binding)
    if (failure === 'wdk-failed') binding._vssCheckpointFailed = true
    else state[failure] = true
    await account.refreshTransfers({ skip_sync: true })
    await account.shutdown()
    expect(native.vssBackup).toHaveBeenCalledTimes(1)
    expect(state.version).toBe(9)
    expect(binding._vssCheckpointFailed).toBe(false)
  })

  it('checks native private-state dirtiness even when refresh reports no public transfer changes', async () => {
    const { account, native, state } = await fixture(Binding)
    native.refreshTransfers.mockImplementation(() => { state.dirty = true; return { transfers: {} } })
    await account.refreshTransfers({ skip_sync: false })
    await account.shutdown()
    expect(native.vssBackup).toHaveBeenCalledTimes(1)
    expect(state.dirty).toBe(false)
  })

  it.each([
    ['missing backup', f => f.native.vssBackupInfo.mockReturnValue({ backup_exists: false, version: null, backup_required: false, last_auto_backup_failed: false })],
    ['malformed backup', f => f.native.vssBackupInfo.mockReturnValue({ backup_exists: true, version: 8 })],
    ['null receipt', f => f.native.vssBackupMetadata.mockReturnValue({ ...f.metadata(), last_backup: null })],
    ['stale receipt', f => f.native.vssBackupMetadata.mockReturnValue({ ...f.metadata(), last_backup: { ...f.completion(), version: 7 } })],
    ['unknown envelope', f => f.native.vssBackupMetadata.mockReturnValue({ ...f.metadata(), extra: true })],
    ['invalid time', f => f.native.vssBackupMetadata.mockReturnValue({ ...f.metadata(), last_backup: { ...f.completion(), completed_at_ms: 0 } })],
    ['wrong network', f => f.native.vssBackupMetadata.mockReturnValue({ ...f.metadata(), last_backup: { ...f.completion(), network: 'signet' } })],
    ['wrong endpoint', f => f.native.vssBackupMetadata.mockReturnValue({ ...f.metadata(), last_backup: { ...f.completion(), vss_url: 'https://other.invalid/vss' } })],
    ['wrong wallet', f => f.native.vssBackupMetadata.mockReturnValue({ ...f.metadata(), last_backup: { ...f.completion(), node_id: '03' + '22'.repeat(32) } })],
    ['unknown policy', f => f.native.vssBackupMetadata.mockReturnValue({ ...f.metadata(), automatic_backup_enabled: 'unknown' })],
    ['info read error', f => f.native.vssBackupInfo.mockImplementationOnce(() => { throw new Error('offline') })],
    ['metadata read error', f => f.native.vssBackupMetadata.mockImplementationOnce(() => { throw new Error('unavailable') })],
    ['bootstrap read error', f => { f.binding.bootstrap = () => { throw new Error('identity unavailable') } }],
    ['missing metadata method', f => { f.binding.getVssBackupMetadata = undefined }],
    ['missing info method', f => { f.binding.getVssBackupInfo = undefined }],
    ['missing bootstrap method', f => { f.binding.bootstrap = undefined }],
    ['missing binding scope', f => { f.binding._config = { dataDir: config.dataDir, vssUrl: config.vssUrl } }]
  ])('retains the explicit fallback for %s instead of treating uncertainty as acknowledged', async (_label, alter) => {
    const f = await fixture(Binding)
    alter(f)
    await f.account.refreshTransfers({ skip_sync: false })
    await f.account.shutdown()
    expect(f.native.refreshTransfers).toHaveBeenCalledTimes(1)
    expect(f.native.vssBackup).toHaveBeenCalledTimes(1)
  })

  it('never retries a completed payment if its uncertain checkpoint fallback fails', async () => {
    const { account, native, state, binding } = await fixture(Binding)
    state.dirty = true
    native.vssBackup.mockImplementation(() => { throw new Error('backup transport unavailable') })
    await expect(account.sendBtc({ amount: 1 })).resolves.toEqual({ txid: 'once' })
    await account.shutdown()
    expect(native.sendBtc).toHaveBeenCalledTimes(1)
    expect(native.vssBackup).toHaveBeenCalledTimes(1)
    expect(binding._vssCheckpointFailed).toBe(true)
    expect(account._vssDirty).toBe(true)
  })

  it('coalesces concurrent acknowledgements while retaining a later dirty pass', async () => {
    const { account, native, binding, info } = await fixture(Binding)
    const read = deferred()
    binding.getVssBackupInfo = jest.fn().mockReturnValueOnce(read.promise).mockImplementation(info)
    await account.sendBtc({ amount: 1 })
    await flush()
    await account.sendBtc({ amount: 2 })
    read.resolve(info())
    await account.shutdown()
    expect(native.sendBtc).toHaveBeenCalledTimes(2)
    expect(binding.getVssBackupInfo.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(native.vssBackup).not.toHaveBeenCalled()
    expect(account._vssDirty).toBe(false)
  })

  it('joins an admitted acknowledgement read before disabling automatic backup and shutting down', async () => {
    const { account, native, binding, info } = await fixture(Binding)
    const read = deferred()
    binding.getVssBackupInfo = jest.fn().mockReturnValueOnce(read.promise).mockImplementation(info)
    await account.sendBtc({ amount: 1 })
    await flush()
    const off = account.setVssAutomaticBackupEnabled(false)
    const shutdown = account.shutdown()
    await flush()
    expect(native.setVssAutomaticBackupEnabled).not.toHaveBeenCalled()
    expect(native.shutdown).not.toHaveBeenCalled()
    read.resolve(info())
    await off
    await shutdown
    expect(native.setVssAutomaticBackupEnabled).toHaveBeenCalledWith(false)
    expect(native.vssBackup).not.toHaveBeenCalled()
    expect(native.shutdown).toHaveBeenCalledTimes(1)
  })
})
