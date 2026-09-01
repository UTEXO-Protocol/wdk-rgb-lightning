// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.

// Unit tests for the local-view VSS surface: `vssStatus` passes the
// binding's view through untouched, and the mutating ops gate on
// "VSS configured" before touching the binding.

import { jest } from '@jest/globals'
import WalletAccountRgbLightning from '../src/wallet-account-rgb-lightning.js'
import { VssNotConfiguredError, VssError } from '../src/errors.js'

function makeAccount (binding) {
  return new WalletAccountRgbLightning({ binding })
}

describe('vssStatus', () => {
  it('returns the binding local-view status verbatim', async () => {
    const status = { configured: true, url: 'https://vss.example', allowHttp: false, lastBackupVersion: 4 }
    const account = makeAccount({ vssStatus: () => status })
    await expect(account.vssStatus()).resolves.toBe(status)
  })
})

describe('clearVssFence', () => {
  it('throws VssNotConfiguredError when VSS was never configured', async () => {
    const clearVssFence = jest.fn()
    const account = makeAccount({ vssStatus: () => ({ configured: false }), clearVssFence })
    await expect(account.clearVssFence('pw')).rejects.toBeInstanceOf(VssNotConfiguredError)
    expect(clearVssFence).not.toHaveBeenCalled()
  })

  it('forwards to the binding when VSS is configured', async () => {
    const clearVssFence = jest.fn()
    const account = makeAccount({ vssStatus: () => ({ configured: true }), clearVssFence })
    await expect(account.clearVssFence('pw')).resolves.toEqual({ ok: true })
    expect(clearVssFence).toHaveBeenCalledWith('pw')
  })

  it('wraps a binding failure as a VssError preserving the message', async () => {
    const account = makeAccount({
      vssStatus: () => ({ configured: true }),
      clearVssFence: () => { throw new Error('fence takeover rejected') }
    })
    const err = await account.clearVssFence('pw').catch((e) => e)
    expect(err).toBeInstanceOf(VssError)
    expect(err.message).toBe('fence takeover rejected')
  })
})

describe('vssBackup', () => {
  it('throws VssNotConfiguredError when VSS was never configured', async () => {
    const vssBackup = jest.fn()
    const account = makeAccount({ vssStatus: () => ({ configured: false }), vssBackup })
    await expect(account.vssBackup()).rejects.toBeInstanceOf(VssNotConfiguredError)
    expect(vssBackup).not.toHaveBeenCalled()
  })

  it('returns the binding snapshot version when configured', async () => {
    const account = makeAccount({
      vssStatus: () => ({ configured: true }),
      vssBackup: () => ({ version: 9 })
    })
    await expect(account.vssBackup()).resolves.toEqual({ version: 9 })
  })
})
