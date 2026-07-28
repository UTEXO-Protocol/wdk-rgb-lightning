// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.

import * as bareEntry from '../index-bare.js'
import * as nodeEntry from '../index-node.js'

describe.each([
  ['Node', nodeEntry],
  ['Bare', bareEntry]
])('%s entry LNURL exports', (runtime, entry) => {
  it('exposes UMA normalization consistently', () => {
    expect(entry.default.Binding).toBe(entry[`${runtime}RgbLightningBinding`])
    expect(entry.UMA_PREFIX).toBe('$')
    expect(entry.UMA_MAX_USERNAME_LENGTH).toBe(64)
    expect(entry.isUmaAddress('$alice@example.com')).toBe(true)
    expect(entry.normalizeLightningAddress('$alice@example.com')).toBe('alice@example.com')
    expect(entry.parseLightningAddress('$alice@example.com')).toMatchObject({
      address: 'alice@example.com',
      isUma: true
    })
  })
})
