// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.

import {
  LspAmbiguousPayableAssetError,
  LspInsufficientAssetLiquidityError,
  LspNoPayableAssetError,
  LspQuoteMismatchError,
  LspUnknownPayableAssetError,
  assertAddressQuote,
  assertAddressRequest,
  assertRelayQuote,
  decodedInvoice,
  lnurlMetadataHash,
  payableAssets,
  pickPayableAsset,
  resolveRelayFundingAsset,
  selectLiquidPaymentAsset,
  verifyApayAddressAttestation,
  verifyApayInvoiceProof,
  verifyLightningMessageSignature
} from '../src/lsp-linked-assets.js'

const PAYOUT = Object.freeze({
  assetId: 'rgb:lnusdt',
  schema: 'Ifa',
  ticker: 'LNUSDT',
  name: 'Lightning USDT',
  precision: 6
})
const CANONICAL = Object.freeze({
  assetId: 'rgb:usdt',
  schema: 'Ifa',
  ticker: 'USDT',
  name: 'USDT',
  precision: 6
})
const LSP_KEY = `02${'11'.repeat(32)}`
const PAYEE_KEY = `03${'22'.repeat(32)}`
const HASH = 'aa'.repeat(32)
const NOW = 1_800_000_000
const RECIPIENT_KEY = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
const APAY_ROOT = '05fdecd8e614a198f844c7d71f341c1b6ba43175ca56eaea944daa1000aa36aa'
const APAY_SIGNATURE = 'rd641qjrgyjw5t8km5oa99xk8aygpou7ar3ihhro4uyf77wjgy364mbu7rtse3y7cmwm96d4zrmrnjhhgru6q8xjwae5azrzr31dwe89'
const ADDRESS_SIGNATURE = 'ryruxhc6cz76qgpfe1ap13o96q17w3exop3whe8b4teztybygxcqcxsj3of9urdzimb3iggsfs4mpmdd83oafshub3suaxisy1iu88at'

function discovery (overrides = {}) {
  return { payoutAsset: PAYOUT, acceptedAssets: [PAYOUT, CANONICAL], ...overrides }
}

function channel (assetId, amount, overrides = {}) {
  return {
    assetId,
    assetLocalAmount: amount,
    isUsable: true,
    peerPubkey: LSP_KEY,
    ...overrides
  }
}

function decoded (overrides = {}) {
  return decodedInvoice({
    payment_hash: HASH,
    amt_msat: 3_000_000,
    asset_id: CANONICAL.assetId,
    asset_amount: 500_000,
    payee_pubkey: PAYEE_KEY,
    timestamp: NOW - 10,
    expiry_sec: 3_600,
    network: 'Signet',
    ...overrides
  }, 'test invoice')
}

function relayQuote (overrides = {}) {
  return {
    paymentHash: HASH,
    inbound: {
      assetId: PAYOUT.assetId,
      assetAmount: 500_000,
      amtMsat: 3_001_000
    },
    outbound: {
      assetId: CANONICAL.assetId,
      assetAmount: 500_000,
      amtMsat: 3_000_000,
      payeePubkey: PAYEE_KEY
    },
    converted: true,
    feeMsat: 1_000,
    expiresAt: NOW + 1_000,
    ...overrides
  }
}

describe('linked-asset menus', () => {
  it('separates payout and convertible representations without label inference', () => {
    const menu = payableAssets(discovery())
    expect(menu.payoutAsset).toBe(PAYOUT)
    expect(menu.accepted).toEqual([PAYOUT, CANONICAL])
    expect(menu.convertible).toEqual([CANONICAL])
    expect(Object.isFrozen(menu)).toBe(true)
  })

  it('keeps old discovery documents usable only when a payout is explicit', () => {
    expect(payableAssets({ payoutAsset: PAYOUT })).toEqual({
      payoutAsset: PAYOUT,
      accepted: [PAYOUT],
      convertible: []
    })
    expect(() => pickPayableAsset('a@example.com', payableAssets({}), undefined, 'payout'))
      .toThrow(LspNoPayableAssetError)
  })

  it('selects exact contract IDs and case-insensitive tickers', () => {
    const menu = payableAssets(discovery())
    expect(pickPayableAsset('a@example.com', menu, CANONICAL.assetId, 'payout'))
      .toMatchObject({ asset: CANONICAL, converted: true })
    expect(pickPayableAsset('a@example.com', menu, 'lnusdt', 'convertible'))
      .toMatchObject({ asset: PAYOUT, converted: false })
  })

  it('treats contract IDs as case-sensitive authorization values', () => {
    const mixedCase = { ...CANONICAL, assetId: 'rgb:AbCd' }
    const menu = payableAssets(discovery({ acceptedAssets: [PAYOUT, mixedCase] }))

    expect(pickPayableAsset('a@example.com', menu, mixedCase.assetId, 'payout'))
      .toMatchObject({ asset: mixedCase, converted: true })
    expect(() => pickPayableAsset('a@example.com', menu, 'rgb:aBcD', 'payout'))
      .toThrow(LspUnknownPayableAssetError)
  })

  it('refuses unknown and ambiguous implicit choices', () => {
    const menu = payableAssets(discovery({
      acceptedAssets: [PAYOUT, CANONICAL, { ...CANONICAL, assetId: 'rgb:usdt-2' }]
    }))
    expect(() => pickPayableAsset('a@example.com', menu, 'EUR', 'convertible'))
      .toThrow(LspUnknownPayableAssetError)
    expect(() => pickPayableAsset('a@example.com', menu, undefined, 'convertible'))
      .toThrow(LspAmbiguousPayableAssetError)
  })

  it('refuses an ambiguous explicit ticker instead of taking array order', () => {
    const duplicate = { ...CANONICAL, assetId: 'rgb:usdt-2' }
    const menu = payableAssets(discovery({ acceptedAssets: [PAYOUT, CANONICAL, duplicate] }))
    expect(() => pickPayableAsset('a@example.com', menu, 'USDT', 'payout'))
      .toThrow(LspAmbiguousPayableAssetError)
  })

  it('rejects non-canonical selectors and unknown selection policies', () => {
    const menu = payableAssets(discovery())
    expect(() => pickPayableAsset('a@example.com', menu, ' USDT', 'payout'))
      .toThrow(/canonical string/)
    expect(() => pickPayableAsset('a@example.com', menu, 42, 'payout'))
      .toThrow(/canonical string/)
    expect(() => pickPayableAsset('a@example.com', menu, undefined, 'first'))
      .toThrow(/preference/)
  })
})

describe('linked-asset liquidity selection', () => {
  it('prefers the no-conversion payout rail when it can cover the whole payment', () => {
    expect(selectLiquidPaymentAsset(
      discovery(),
      [channel(CANONICAL.assetId, 2_000_000), channel(PAYOUT.assetId, 1_000_000)],
      500_000
    )).toMatchObject({ assetId: PAYOUT.assetId, converted: false, localAssetAmount: 1_000_000 })
  })

  it('uses the convertible representation when payout liquidity is insufficient', () => {
    expect(selectLiquidPaymentAsset(
      discovery(),
      [channel(PAYOUT.assetId, 1), channel(CANONICAL.assetId, 500_000)],
      500_000
    )).toMatchObject({ assetId: CANONICAL.assetId, converted: true })
  })

  it('never sums channels or counts unusable liquidity', () => {
    expect(() => selectLiquidPaymentAsset(
      discovery(),
      [
        channel(CANONICAL.assetId, 300_000),
        channel(CANONICAL.assetId, 300_000),
        channel(PAYOUT.assetId, 9_000_000, { isUsable: false })
      ],
      500_000
    )).toThrow(LspInsufficientAssetLiquidityError)
  })
})

describe('relay funding selection', () => {
  const target = decoded()

  it('passes an exact contract through and resolves a ticker from get_info metadata', () => {
    expect(resolveRelayFundingAsset(target, [], CANONICAL.assetId, [CANONICAL])).toBe(CANONICAL.assetId)
    expect(resolveRelayFundingAsset(target, [], 'LNUSDT', [PAYOUT])).toBe(PAYOUT.assetId)
  })

  it('does not case-fold explicit funding contract IDs', () => {
    const mixedCase = { ...PAYOUT, assetId: 'rgb:AbCd' }

    expect(resolveRelayFundingAsset(target, [], mixedCase.assetId, [mixedCase]))
      .toBe(mixedCase.assetId)
    expect(() => resolveRelayFundingAsset(target, [], 'rgb:aBcD', [mixedCase]))
      .toThrow(LspUnknownPayableAssetError)
  })

  it('refuses unadvertised contracts and ambiguous advertised tickers', () => {
    expect(() => resolveRelayFundingAsset(target, [], CANONICAL.assetId, [PAYOUT]))
      .toThrow(LspUnknownPayableAssetError)
    expect(() => resolveRelayFundingAsset(target, [], 'USDT', [
      CANONICAL,
      { ...CANONICAL, assetId: 'rgb:usdt-2' }
    ])).toThrow(LspAmbiguousPayableAssetError)
  })

  it('rejects non-canonical explicit funding selectors', () => {
    expect(() => resolveRelayFundingAsset(target, [], ' LNUSDT', [PAYOUT]))
      .toThrow(/canonical string/)
    expect(() => resolveRelayFundingAsset(target, [], 1, [PAYOUT]))
      .toThrow(/canonical string/)
  })

  it('prefers the target representation before a convertible channel', () => {
    expect(resolveRelayFundingAsset(
      target,
      [channel(PAYOUT.assetId, 1_000_000), channel(CANONICAL.assetId, 500_000)],
      undefined,
      [CANONICAL]
    )).toBe(CANONICAL.assetId)
  })

  it('does not select a locally liquid target the LSP does not advertise', () => {
    expect(resolveRelayFundingAsset(
      target,
      [channel(CANONICAL.assetId, 500_000)],
      undefined,
      [PAYOUT]
    )).toBeUndefined()
  })

  it('returns no implicit choice when no single channel can cover the payment', () => {
    expect(resolveRelayFundingAsset(
      target,
      [channel(PAYOUT.assetId, 499_999)],
      undefined,
      []
    )).toBeUndefined()
  })

  it('never turns an unrelated liquid channel into an implicit conversion', () => {
    expect(resolveRelayFundingAsset(
      target,
      [channel(PAYOUT.assetId, 1_000_000)],
      undefined,
      [PAYOUT]
    )).toBeUndefined()
  })
})

describe('signed invoice verification', () => {
  const target = decoded()
  const hodl = decoded({
    amt_msat: 3_001_000,
    asset_id: PAYOUT.assetId,
    payee_pubkey: LSP_KEY
  })

  it('accepts one atomic, 1:1, fee-bounded cross-asset quote', () => {
    expect(() => assertRelayQuote(target, hodl, relayQuote(), {
      maxFeeMsat: 1_000,
      lspPubkey: LSP_KEY,
      nowSeconds: NOW
    })).not.toThrow()
  })

  it.each([
    ['a different signed hash', decoded({ payment_hash: 'bb'.repeat(32) }), relayQuote(), /payment hash/],
    ['a different inbound asset', hodl, relayQuote({ inbound: { ...relayQuote().inbound, assetId: 'rgb:other' } }), /funding asset/],
    ['a non-1:1 conversion', decoded({ amt_msat: 3_001_000, asset_id: PAYOUT.assetId, asset_amount: 500_001, payee_pubkey: LSP_KEY }), relayQuote({ inbound: { ...relayQuote().inbound, assetAmount: 500_001 } }), /not 1:1/],
    ['an unapproved fee', decoded({ amt_msat: 3_001_001, asset_id: PAYOUT.assetId, payee_pubkey: LSP_KEY }), relayQuote({ inbound: { ...relayQuote().inbound, amtMsat: 3_001_001 }, feeMsat: 1_001 }), /exceeds/],
    ['a wrong LSP payee', decoded({ amt_msat: 3_001_000, asset_id: PAYOUT.assetId, payee_pubkey: PAYEE_KEY }), relayQuote(), /configured LSP/],
    ['a network mismatch', decoded({ amt_msat: 3_001_000, asset_id: PAYOUT.assetId, payee_pubkey: LSP_KEY, network: 'Regtest' }), relayQuote(), /different Bitcoin networks/],
    ['an expired quote', hodl, relayQuote({ expiresAt: NOW }), /expired/]
  ])('refuses %s', (_name, funding, quote, message) => {
    expect(() => assertRelayQuote(target, funding, quote, {
      maxFeeMsat: 1_000,
      lspPubkey: LSP_KEY,
      nowSeconds: NOW
    })).toThrow(message)
  })

  it('checks Lightning Address amount, asset, payee, hash, network, and expiry', () => {
    expect(() => assertAddressQuote(target, {
      amtMsat: 3_000_000,
      assetId: CANONICAL.assetId,
      assetAmount: 500_000,
      lspPubkey: PAYEE_KEY,
      paymentHash: HASH,
      network: 'signet',
      nowSeconds: NOW
    })).not.toThrow()
    expect(() => assertAddressQuote(target, {
      amtMsat: 3_000_001,
      assetId: CANONICAL.assetId,
      assetAmount: 500_000,
      nowSeconds: NOW
    })).toThrow(LspQuoteMismatchError)
    expect(() => assertAddressQuote(target, {
      amtMsat: 3_000_000,
      assetId: CANONICAL.assetId,
      assetAmount: 500_000,
      network: 'regtest',
      nowSeconds: NOW
    })).toThrow(/different Bitcoin network/)
  })

  it('revalidates deserialized quote field types before comparing signed legs', () => {
    expect(() => assertRelayQuote(target, hodl, relayQuote({ feeMsat: '1000' }), {
      maxFeeMsat: 1_000,
      lspPubkey: LSP_KEY,
      nowSeconds: NOW
    })).toThrow(/quoted fee/)
    expect(() => assertRelayQuote(target, hodl, relayQuote({ inbound: null }), {
      maxFeeMsat: 1_000,
      lspPubkey: LSP_KEY,
      nowSeconds: NOW
    })).toThrow(/inbound leg/)
  })

  it('rejects decoded invoice expiry arithmetic that cannot stay exact', () => {
    expect(() => decoded({ timestamp: Number.MAX_SAFE_INTEGER, expiry_sec: 2 }))
      .toThrow(/expiry exceeds/)
  })
})

describe('Lightning Address request authorization', () => {
  const menu = {
    minSendable: 1_000,
    maxSendable: 10_000,
    payoutAsset: PAYOUT,
    acceptedAssets: [PAYOUT, CANONICAL]
  }

  it('accepts only amounts and exact contracts advertised by discovery', () => {
    expect(() => assertAddressRequest(menu, {
      amtMsat: 5_000,
      assetId: CANONICAL.assetId,
      assetAmount: 25
    })).not.toThrow()
    expect(() => assertAddressRequest(menu, { amtMsat: 999 }))
      .toThrow(/outside the advertised range/)
    expect(() => assertAddressRequest(menu, {
      amtMsat: 5_000,
      assetId: 'rgb:unrelated',
      assetAmount: 25
    })).toThrow(LspUnknownPayableAssetError)
    expect(() => assertAddressRequest(menu, {
      amtMsat: 5_000,
      assetId: CANONICAL.assetId
    })).toThrow(/together/)
  })
})

describe('Lightning Address metadata commitment', () => {
  const metadata = '[["text/plain","pay"]]'

  it('hashes the exact UTF-8 discovery metadata bytes', () => {
    expect(lnurlMetadataHash(metadata))
      .toBe('11485f632276b0dfe74536e7a1330e0f62e0b8608e2d3a36a14550145cf57731')
  })

  it('requires the signed invoice to carry the matching BOLT11 h tag', () => {
    const invoice = decoded({ description_hash: lnurlMetadataHash(metadata) })
    expect(() => assertAddressQuote(invoice, {
      amtMsat: 3_000_000,
      assetId: CANONICAL.assetId,
      assetAmount: 500_000,
      metadata,
      nowSeconds: NOW
    })).not.toThrow()
    expect(() => assertAddressQuote(decoded(), {
      amtMsat: 3_000_000,
      assetId: CANONICAL.assetId,
      assetAmount: 500_000,
      metadata,
      nowSeconds: NOW
    })).toThrow(/discovery metadata/)
  })
})

describe('APay cryptographic evidence', () => {
  function proof (overrides = {}) {
    return {
      version: 1,
      recipientPubkey: RECIPIENT_KEY,
      hostPubkey: LSP_KEY,
      batchId: '000102030405060708090a0b0c0d0e0f',
      hashIndex: 7,
      paymentHash: HASH,
      batchRoot: APAY_ROOT,
      batchSize: 1,
      merkleProof: [],
      batchSig: APAY_SIGNATURE,
      createdAt: 1_700_000_000,
      expiresAt: 2_000_000_000,
      ...overrides
    }
  }

  it('matches the independent rust-lightning message-signing vector', () => {
    expect(verifyLightningMessageSignature(
      'test message',
      'd9tibmnic9t5y41hg7hkakdcra94akas9ku3rmmj4ag9mritc8ok4p5qzefs78c9pqfhpuftqqzhydbdwfg7u6w6wdxcqpqn4sj4e73e',
      RECIPIENT_KEY
    )).toBe(true)
  })

  it('verifies the native address-attestation byte layout', () => {
    expect(() => verifyApayAddressAttestation({
      recipientPubkey: RECIPIENT_KEY,
      username: 'alice',
      domain: 'lsp.example',
      addressSig: ADDRESS_SIGNATURE
    })).not.toThrow()
    expect(() => verifyApayAddressAttestation({
      recipientPubkey: RECIPIENT_KEY,
      username: 'mallory',
      domain: 'lsp.example',
      addressSig: ADDRESS_SIGNATURE
    })).toThrow(/attestation signature/)
  })

  it('fails closed with the public error contract for malformed attestations', () => {
    expect(() => verifyApayAddressAttestation()).toThrow(LspQuoteMismatchError)
    expect(() => verifyApayAddressAttestation([])).toThrow(LspQuoteMismatchError)
    expect(() => verifyApayAddressAttestation({
      recipientPubkey: 'invalid',
      username: 'alice',
      domain: 'lsp.example',
      addressSig: ADDRESS_SIGNATURE
    })).toThrow(LspQuoteMismatchError)
  })

  it('rejects non-canonical public verifier inputs', () => {
    expect(verifyLightningMessageSignature('test message', APAY_SIGNATURE.slice(1), RECIPIENT_KEY))
      .toBe(false)
    expect(verifyLightningMessageSignature('test message', APAY_SIGNATURE.toUpperCase(), RECIPIENT_KEY))
      .toBe(false)
    expect(verifyLightningMessageSignature('test message', APAY_SIGNATURE, '02ff'))
      .toBe(false)
  })

  it('verifies the signed batch commitment and invoice inclusion path', () => {
    expect(() => verifyApayInvoiceProof(proof(), {
      paymentHash: HASH,
      recipientPubkey: RECIPIENT_KEY,
      hostPubkey: LSP_KEY,
      nowSeconds: NOW
    })).not.toThrow()
  })

  it.each([
    ['missing proof', undefined],
    ['array proof', []],
    ['unsupported version', proof({ version: 2 })],
    ['fractional batch size', proof({ batchSize: 1.5 })],
    ['oversized batch', proof({ batchSize: 201 })],
    ['invalid batch id', proof({ batchId: '00' })],
    ['invalid hash index', proof({ hashIndex: -1 })],
    ['malformed path', proof({ merkleProof: [null], batchSize: 2 })],
    ['invalid path side', proof({
      batchSize: 2,
      merkleProof: [{ sibling: HASH, side: 'above' }]
    })],
    ['malformed signature', proof({ batchSig: 42 })]
  ])('rejects a malformed public verifier input: %s', (_name, candidate) => {
    expect(() => verifyApayInvoiceProof(candidate, { nowSeconds: NOW }))
      .toThrow(LspQuoteMismatchError)
  })

  it('validates expected proof identities before comparing them', () => {
    expect(() => verifyApayInvoiceProof(proof(), null))
      .toThrow(LspQuoteMismatchError)
    expect(() => verifyApayInvoiceProof(proof(), {
      paymentHash: 'not-a-hash',
      nowSeconds: NOW
    })).toThrow(LspQuoteMismatchError)
    expect(() => verifyApayInvoiceProof(proof(), {
      hostPubkey: 'not-a-key',
      nowSeconds: NOW
    })).toThrow(LspQuoteMismatchError)
    expect(() => verifyApayInvoiceProof(proof(), {
      nowSeconds: Number.MAX_SAFE_INTEGER,
      maxClockSkewSeconds: 1
    })).toThrow(/exact integer range/)
  })

  it.each([
    ['payment hash', { paymentHash: 'bb'.repeat(32) }, /Merkle path/],
    ['batch root', { batchRoot: 'bb'.repeat(32) }, /Merkle path/],
    ['recipient', { recipientPubkey: PAYEE_KEY }, /Merkle path/],
    ['signature', { batchSig: `y${APAY_SIGNATURE.slice(1)}` }, /signature/],
    ['expiry', { expiresAt: NOW }, /expired/],
    ['path depth', { batchSize: 2 }, /path depth/]
  ])('rejects a tampered %s', (_name, mutation, message) => {
    expect(() => verifyApayInvoiceProof(proof(mutation), { nowSeconds: NOW }))
      .toThrow(message)
  })
})
