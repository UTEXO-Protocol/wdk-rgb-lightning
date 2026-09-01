// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.

// Unit tests for the static recipient classifier that drives the
// generic `transfer()` / `quoteTransfer()` router. Pure logic — no node,
// no binding, no network.

import WalletAccountRgbLightning from '../src/wallet-account-rgb-lightning.js'

const classify = WalletAccountRgbLightning._classifyRecipient

describe('WalletAccountRgbLightning._classifyRecipient', () => {
  it('classifies BOLT11 invoices across all network prefixes', () => {
    expect(classify('lnbc10u1pcoffee')).toBe('bolt11') // mainnet
    expect(classify('lntb10u1pcoffee')).toBe('bolt11') // testnet
    expect(classify('lnbcrt10u1pcoffee')).toBe('bolt11') // regtest
    expect(classify('lnsb10u1pcoffee')).toBe('bolt11') // signet
  })

  it('is case-insensitive for BOLT11 prefixes', () => {
    expect(classify('LNBC10U1PCOFFEE')).toBe('bolt11')
    expect(classify('LnTb10u1pcoffee')).toBe('bolt11')
  })

  it('classifies RGB invoices (rgb: and utxob: schemes)', () => {
    expect(classify('rgb:2WBcas9-usxg9Hm9d-N6q2Lpf3Z-...')).toBe('rgb-invoice')
    expect(classify('utxob:abcdef-123456')).toBe('rgb-invoice')
    expect(classify('RGB:UPPER-case-scheme')).toBe('rgb-invoice')
  })

  it('classifies a 66-hex-char string as an LN node pubkey', () => {
    const pubkey = '02' + 'a'.repeat(64)
    expect(pubkey).toHaveLength(66)
    expect(classify(pubkey)).toBe('ln-pubkey')
    expect(classify(pubkey.toUpperCase())).toBe('ln-pubkey')
  })

  it('falls back to btc-address for anything else', () => {
    expect(classify('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')).toBe('btc-address')
    expect(classify('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx')).toBe('btc-address')
    expect(classify('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toBe('btc-address')
    // A compressed pubkey requires 66 hexadecimal characters.
    expect(classify('a'.repeat(64))).toBe('btc-address')
  })

  it('trims surrounding whitespace before classifying', () => {
    expect(classify('  lnbc10u1pcoffee  ')).toBe('bolt11')
    const pubkey = '03' + 'b'.repeat(64)
    expect(classify(`\t${pubkey}\n`)).toBe('ln-pubkey')
  })

  it('throws on empty or non-string recipients', () => {
    expect(() => classify('')).toThrow('recipient must be a non-empty string')
    expect(() => classify(null)).toThrow('recipient must be a non-empty string')
    expect(() => classify(undefined)).toThrow('recipient must be a non-empty string')
    expect(() => classify(42)).toThrow('recipient must be a non-empty string')
  })
})
