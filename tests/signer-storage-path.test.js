// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.

import { signerStoragePath } from '../src/signer-storage-path.js'

describe('signerStoragePath', () => {
  it('uses stable identity-specific stores below the account data directory', () => {
    expect(signerStoragePath('/wallet/account-0/')).toBe('/wallet/account-0/vls-signer')
    expect(signerStoragePath('/wallet/account-0', 'legacy'))
      .toBe('/wallet/account-0/vls-signer-legacy')
  })

  it('normalizes trailing separators and rejects invalid input', () => {
    expect(signerStoragePath('C:\\wallet\\')).toBe('C:\\wallet/vls-signer')
    expect(() => signerStoragePath('')).toThrow('persistent dataDir')
    expect(() => signerStoragePath('/wallet', 'unknown')).toThrow('identity')
  })
})
