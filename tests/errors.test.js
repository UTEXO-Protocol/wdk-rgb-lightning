// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.

// Unit tests for the typed error hierarchy and the `wrapError` helper.
// Pure module — no node, binding or network.

import {
  RgbLightningError,
  UnlockError,
  AccountLockedError,
  VssError,
  VssNotConfiguredError,
  ApayError,
  WalletSyncError,
  WalletSnapshotError,
  NotImplementedError,
  wrapError
} from '../src/errors.js'

describe('error hierarchy', () => {
  it('assigns a stable name + code to each subclass', () => {
    expect(new RgbLightningError('m')).toMatchObject({ name: 'RgbLightningError', code: 'RGB_LIGHTNING_ERROR' })
    expect(new UnlockError('m')).toMatchObject({ name: 'UnlockError', code: 'UNLOCK_FAILED' })
    expect(new AccountLockedError()).toMatchObject({ name: 'AccountLockedError', code: 'ACCOUNT_LOCKED' })
    expect(new VssError('m')).toMatchObject({ name: 'VssError', code: 'VSS_ERROR' })
    expect(new VssNotConfiguredError()).toMatchObject({ name: 'VssNotConfiguredError', code: 'VSS_NOT_CONFIGURED' })
    expect(new ApayError('m')).toMatchObject({ name: 'ApayError', code: 'APAY_ERROR' })
    expect(new WalletSyncError('m')).toMatchObject({ name: 'WalletSyncError', code: 'WALLET_SYNC_FAILED' })
    expect(new WalletSnapshotError('m')).toMatchObject({ name: 'WalletSnapshotError', code: 'WALLET_SNAPSHOT_FAILED' })
    expect(new NotImplementedError('m')).toMatchObject({ name: 'NotImplementedError', code: 'NOT_IMPLEMENTED' })
  })

  it('keeps every subclass an instanceof the base (and Error)', () => {
    for (const E of [
      UnlockError,
      AccountLockedError,
      VssError,
      ApayError,
      WalletSyncError,
      WalletSnapshotError,
      NotImplementedError
    ]) {
      const e = new E('x')
      expect(e).toBeInstanceOf(Error)
      expect(e).toBeInstanceOf(RgbLightningError)
    }
    expect(new VssNotConfiguredError()).toBeInstanceOf(VssError)
  })

  it('VssNotConfiguredError carries a helpful default message', () => {
    expect(new VssNotConfiguredError().message).toMatch(/VSS is not configured/)
  })

  it('serializes to a structured object via toJSON', () => {
    const cause = new Error('root cause')
    const err = new UnlockError('bad creds', { cause })
    expect(err.toJSON()).toEqual({
      name: 'UnlockError',
      code: 'UNLOCK_FAILED',
      message: 'bad creds',
      details: null,
      cause: { name: 'Error', message: 'root cause' }
    })
  })

  it('toJSON reports a null cause when none was provided', () => {
    expect(new VssError('x').toJSON().cause).toBeNull()
  })

  it('serializes structured error details without dropping them', () => {
    const details = { vanilla: { status: 'failed' } }
    expect(new WalletSyncError('x', { details }).toJSON().details).toBe(details)
  })
})

describe('wrapError', () => {
  it('preserves the original message verbatim and attaches the cause', () => {
    const original = new Error('Rln(Conflict): already initialized')
    const wrapped = wrapError(original, UnlockError)
    expect(wrapped).toBeInstanceOf(UnlockError)
    expect(wrapped.message).toBe('Rln(Conflict): already initialized')
    expect(wrapped.cause).toBe(original)
    expect(wrapped.code).toBe('UNLOCK_FAILED')
  })

  it('is idempotent when the value is already the target class', () => {
    const already = new VssError('boom')
    expect(wrapError(already, VssError)).toBe(already)
  })

  it('re-wraps an error of a different typed class', () => {
    const unlock = new UnlockError('x')
    const wrapped = wrapError(unlock, VssError)
    expect(wrapped).toBeInstanceOf(VssError)
    expect(wrapped.cause).toBe(unlock)
  })

  it('stringifies non-Error throwables', () => {
    expect(wrapError('plain string', ApayError).message).toBe('plain string')
    expect(wrapError({ message: 'objmsg' }, ApayError).message).toBe('objmsg')
  })

  it('honours an explicit code override', () => {
    expect(wrapError(new Error('x'), ApayError, { code: 'APAY_PEER_NOT_VISIBLE' }).code).toBe('APAY_PEER_NOT_VISIBLE')
  })
})
