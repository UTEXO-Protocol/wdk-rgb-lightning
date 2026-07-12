// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.

// Unit tests for the intentionally-unimplemented transaction-signing surface.
// `signTransaction` must throw a typed
// NotImplementedError (not a bare Error) so callers can branch on it.

import WalletAccountRgbLightning from '../src/wallet-account-rgb-lightning.js'
import { NotImplementedError } from '../src/errors.js'

function makeAccount () {
  return new WalletAccountRgbLightning({
    binding: {
      node: { verifyMessage: () => ({ valid: true }) }
    }
  })
}

describe('unimplemented surface', () => {
  it('signTransaction() rejects with NotImplementedError', async () => {
    const account = makeAccount()
    await expect(account.signTransaction({})).rejects.toBeInstanceOf(NotImplementedError)
    await expect(account.signTransaction({})).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' })
  })

  it('the message points at the supported alternative path', async () => {
    const account = makeAccount()
    await expect(account.signTransaction({})).rejects.toThrow(/sendTransaction/)
  })
})

describe('message verification', () => {
  it('is implemented through the native read surface', async () => {
    await expect(makeAccount().verify('msg', 'sig')).resolves.toBe(true)
  })
})

describe('constructor guard', () => {
  it('throws when no binding is supplied', () => {
    expect(() => new WalletAccountRgbLightning()).toThrow('requires a BareRgbLightningBinding')
    expect(() => new WalletAccountRgbLightning({})).toThrow('requires a BareRgbLightningBinding')
  })
})
