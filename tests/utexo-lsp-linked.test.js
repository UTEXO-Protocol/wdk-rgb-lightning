// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.

import { jest } from '@jest/globals'
import { UtexoLsp } from '../src/utexo-lsp.js'

const LSP_KEY = `02${'11'.repeat(32)}`
const PAYEE_KEY = `03${'22'.repeat(32)}`
const WALLET_KEY = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
const HASH = 'aa'.repeat(32)
const ADDRESS_SIGNATURE = 'ryruxhc6cz76qgpfe1ap13o96q17w3exop3whe8b4teztybygxcqcxsj3of9urdzimb3iggsfs4mpmdd83oafshub3suaxisy1iu88at'
const METADATA_HASH = '11485f632276b0dfe74536e7a1330e0f62e0b8608e2d3a36a14550145cf57731'
const NOW = Math.floor(Date.now() / 1000)
const PAYOUT = Object.freeze({
  assetId: 'rgb:lnusdt', schema: 'Ifa', ticker: 'LNUSDT', name: 'Lightning USDT', precision: 6
})
const CANONICAL = Object.freeze({
  assetId: 'rgb:usdt', schema: 'Ifa', ticker: 'USDT', name: 'USDT', precision: 6
})
const PEER = Object.freeze({
  baseUrl: 'https://lsp.example',
  peerPubkey: LSP_KEY,
  peerHost: 'lsp.example',
  peerPort: 9735,
  network: 'signet'
})

function decodedInvoice (overrides = {}) {
  return {
    payment_hash: HASH,
    amt_msat: 3_000_000,
    asset_id: CANONICAL.assetId,
    asset_amount: 500_000,
    payee_pubkey: PAYEE_KEY,
    description_hash: METADATA_HASH,
    min_final_cltv_expiry_delta: 42,
    timestamp: NOW - 10,
    expiry_sec: 3_600,
    network: 'Signet',
    ...overrides
  }
}

function account (overrides = {}) {
  return {
    connectPeer: jest.fn(async () => ({ ok: true })),
    sync: jest.fn(async () => {}),
    listChannels: jest.fn(async () => []),
    createLightningInvoice: jest.fn(async () => ({ invoice: 'ln-wallet' })),
    decodeInvoice: jest.fn(async (invoice) => {
      if (invoice === 'ln-target') return decodedInvoice()
      return decodedInvoice({
        amt_msat: invoice === 'ln-hodl' ? 3_001_000 : 3_000_000,
        asset_id: PAYOUT.assetId,
        payee_pubkey: LSP_KEY
      })
    }),
    decodeRgbInvoice: jest.fn(async () => ({
      asset_id: CANONICAL.assetId,
      assignment: { type: 'Fungible', value: 500_000 },
      network: 'Signet',
      expiration_timestamp: NOW + 3_590
    })),
    sendPayment: jest.fn(async () => ({ payment_hash: HASH, status: 'Pending' })),
    getNodeInfo: jest.fn(async () => ({ pubkey: WALLET_KEY })),
    apayNewWithAddress: jest.fn(async () => ({
      unused_hashes: 90,
      next_index_expected: 10,
      refill_batch_size: 100
    })),
    apayNew: jest.fn(async () => ({})),
    listPayments: jest.fn(async () => []),
    claimHodlInvoice: jest.fn(async () => ({})),
    ...overrides
  }
}

function paymentChannel (assetId, assetAmount, outboundBalanceMsat = 10_000_000) {
  return {
    assetId,
    assetLocalAmount: assetAmount,
    outboundBalanceMsat,
    isUsable: true,
    peerPubkey: LSP_KEY
  }
}

function proof () {
  return {
    version: 1,
    recipientPubkey: WALLET_KEY,
    hostPubkey: LSP_KEY,
    batchId: '000102030405060708090a0b0c0d0e0f',
    hashIndex: 7,
    paymentHash: HASH,
    batchRoot: '05fdecd8e614a198f844c7d71f341c1b6ba43175ca56eaea944daa1000aa36aa',
    batchSize: 1,
    merkleProof: [],
    batchSig: 'rd641qjrgyjw5t8km5oa99xk8aygpou7ar3ihhro4uyf77wjgy364mbu7rtse3y7cmwm96d4zrmrnjhhgru6q8xjwae5azrzr31dwe89',
    createdAt: 1_700_000_000,
    expiresAt: 2_000_000_000
  }
}

function wireProof () {
  const value = proof()
  return {
    version: value.version,
    recipient_pubkey: value.recipientPubkey,
    host_pubkey: value.hostPubkey,
    batch_id: value.batchId,
    hash_index: value.hashIndex,
    payment_hash: value.paymentHash,
    batch_root: value.batchRoot,
    batch_size: value.batchSize,
    merkle_proof: value.merkleProof,
    batch_sig: value.batchSig,
    created_at: value.createdAt,
    expires_at: value.expiresAt
  }
}

function jsonResponse (body) {
  return {
    ok: true,
    status: 200,
    redirected: false,
    headers: { get: () => null },
    text: async () => JSON.stringify(body)
  }
}

function makeLsp (wallet = account()) {
  const lsp = new UtexoLsp(wallet, PEER)
  lsp.http = {
    baseUrl: PEER.baseUrl,
    getInfo: jest.fn(async () => ({
      pubkey: LSP_KEY,
      network: 'signet',
      supported_assets: [
        { asset_id: PAYOUT.assetId, schema: 'Ifa', ticker: 'LNUSDT', name: PAYOUT.name, precision: 6 },
        { asset_id: CANONICAL.assetId, schema: 'Ifa', ticker: 'USDT', name: CANONICAL.name, precision: 6 }
      ]
    })),
    discoverAddress: jest.fn(async () => ({
      callback: 'https://lsp.example/pay/callback/alice',
      minSendable: 1,
      maxSendable: 100_000_000,
      metadata: '[["text/plain","pay"]]',
      tag: 'payRequest',
      recipientPubkey: WALLET_KEY,
      addressSig: ADDRESS_SIGNATURE,
      payoutAsset: PAYOUT,
      acceptedAssets: [PAYOUT, CANONICAL]
    })),
    resolveAddressVerified: jest.fn(async (_username, _amount, opts) => ({
      pr: 'ln-address',
      routes: [],
      proof: proof(),
      echoedOptions: opts
    })),
    lightningReceiveVerified: jest.fn(async ({ lnInvoice }) => ({
      lnInvoice,
      rgbInvoice: 'rgb-invoice',
      mappingId: '7',
      rgbAssetId: CANONICAL.assetId,
      converted: true
    })),
    onchainSendVerified: jest.fn(async ({ rgbInvoice }) => ({
      lnInvoice: 'ln-bridge',
      rgbInvoice,
      mappingId: '9'
    })),
    lightningSend: jest.fn(async () => ({
      lnInvoice: 'ln-hodl',
      paymentHash: HASH,
      inbound: { assetId: PAYOUT.assetId, assetAmount: 500_000, amtMsat: 3_001_000 },
      outbound: { assetId: CANONICAL.assetId, assetAmount: 500_000, amtMsat: 3_000_000, payeePubkey: PAYEE_KEY },
      converted: true,
      feeMsat: 1_000,
      expiresAt: NOW + 1_000
    })),
    lightningSendStatus: jest.fn(async (paymentHash) => ({ paymentHash, status: 'settled' })),
    getLightningAddressByPubkeyVerified: jest.fn(async () => ({ username: 'alice', domain: 'lsp.example' }))
  }
  return { lsp, wallet }
}

describe('linked receive flows', () => {
  it('requests the canonical on-chain representation and verifies both signed invoices', async () => {
    const { lsp, wallet } = makeLsp()
    const result = await lsp.receiveAsset({
      assetId: PAYOUT.assetId,
      amountSats: 3_000,
      amountRgb: 500_000
    })

    const request = lsp.http.lightningReceiveVerified.mock.calls[0][0]
    expect(request.lnInvoice).toBe('ln-wallet')
    expect(request.rgb.durationSeconds).toBeGreaterThanOrEqual(3_599)
    expect(request.rgb.durationSeconds).toBeLessThanOrEqual(3_600)
    expect(wallet.decodeRgbInvoice).toHaveBeenCalledWith('rgb-invoice')
    expect(wallet.decodeInvoice).toHaveBeenCalledWith('ln-wallet')
    expect(result).toEqual({
      lnInvoice: 'ln-wallet',
      rgbInvoice: 'rgb-invoice',
      mappingId: '7',
      onchainAssetId: CANONICAL.assetId,
      converted: true
    })
  })

  it('pins the payout contract when conversion is explicitly disabled', async () => {
    const { lsp } = makeLsp(account({
      decodeRgbInvoice: jest.fn(async () => ({
        asset_id: PAYOUT.assetId,
        assignment: { type: 'Fungible', value: 500_000 },
        network: 'Signet',
        expiration_timestamp: NOW + 3_590
      }))
    }))
    lsp.http.lightningReceiveVerified.mockResolvedValue({
      lnInvoice: 'ln-wallet',
      rgbInvoice: 'rgb-invoice',
      mappingId: '8',
      rgbAssetId: PAYOUT.assetId,
      converted: false
    })

    await lsp.receiveAsset({
      assetId: PAYOUT.assetId,
      amountSats: 3_000,
      amountRgb: 500_000,
      onchainAsset: 'payout'
    })
    const request = lsp.http.lightningReceiveVerified.mock.calls[0][0]
    expect(request.rgb.assetId).toBe(PAYOUT.assetId)
    expect(request.rgb.durationSeconds).toBeGreaterThanOrEqual(3_599)
    expect(request.rgb.durationSeconds).toBeLessThanOrEqual(3_600)
  })

  it('rejects an unsupported payout contract before creating a local invoice', async () => {
    const { lsp, wallet } = makeLsp()
    lsp.http.getInfo.mockResolvedValue({
      pubkey: LSP_KEY,
      network: 'signet',
      supported_assets: []
    })

    await expect(lsp.receiveAsset({
      assetId: PAYOUT.assetId,
      amountSats: 3_000,
      amountRgb: 500_000
    })).rejects.toThrow(/not advertised by this LSP/)
    expect(wallet.createLightningInvoice).not.toHaveBeenCalled()
    expect(lsp.http.lightningReceiveVerified).not.toHaveBeenCalled()
  })

  it('rejects a local receive invoice whose network or expiry changed before registration', async () => {
    const wrongNetwork = makeLsp(account({
      decodeInvoice: jest.fn(async () => decodedInvoice({
        asset_id: PAYOUT.assetId,
        payee_pubkey: LSP_KEY,
        network: 'Regtest'
      }))
    }))
    await expect(wrongNetwork.lsp.receiveAsset({
      assetId: PAYOUT.assetId,
      amountSats: 3_000,
      amountRgb: 500_000
    })).rejects.toThrow(/different LSP network/)
    expect(wrongNetwork.lsp.http.lightningReceiveVerified).not.toHaveBeenCalled()

    const wrongExpiry = makeLsp(account({
      decodeInvoice: jest.fn(async () => decodedInvoice({
        asset_id: PAYOUT.assetId,
        payee_pubkey: LSP_KEY,
        expiry_sec: 3_599
      }))
    }))
    await expect(wrongExpiry.lsp.receiveAsset({
      assetId: PAYOUT.assetId,
      amountSats: 3_000,
      amountRgb: 500_000
    })).rejects.toThrow(/changed the requested expiry/)
    expect(wrongExpiry.lsp.http.lightningReceiveVerified).not.toHaveBeenCalled()
  })

  it('rejects a same-asset RGB invoice with a substituted assignment amount', async () => {
    const { lsp } = makeLsp(account({
      decodeRgbInvoice: jest.fn(async () => ({
        asset_id: PAYOUT.assetId,
        assignment: { type: 'Fungible', value: 499_999 },
        network: 'Signet',
        expiration_timestamp: NOW + 3_590
      }))
    }))
    lsp.http.lightningReceiveVerified.mockResolvedValue({
      lnInvoice: 'ln-wallet',
      rgbInvoice: 'rgb-invoice',
      mappingId: '8',
      rgbAssetId: PAYOUT.assetId,
      converted: false
    })

    await expect(lsp.receiveAsset({
      assetId: PAYOUT.assetId,
      amountSats: 3_000,
      amountRgb: 500_000,
      onchainAsset: 'payout'
    })).rejects.toThrow(/requested fungible amount/)
  })

  it('rejects an expired receive invoice before returning the bridge request', async () => {
    const { lsp } = makeLsp(account({
      decodeInvoice: jest.fn(async () => decodedInvoice({
        asset_id: PAYOUT.assetId,
        payee_pubkey: LSP_KEY,
        timestamp: NOW - 3_601,
        expiry_sec: 3_600
      }))
    }))

    await expect(lsp.receiveAsset({
      assetId: PAYOUT.assetId,
      amountSats: 3_000,
      amountRgb: 500_000
    })).rejects.toThrow(/already expired/)
    expect(lsp.http.lightningReceiveVerified).not.toHaveBeenCalled()
  })

  it('rejects a receive RGB leg that outlives its Lightning payout', async () => {
    const { lsp } = makeLsp(account({
      decodeRgbInvoice: jest.fn(async () => ({
        asset_id: CANONICAL.assetId,
        assignment: { type: 'Fungible', value: 500_000 },
        network: 'Signet',
        expiration_timestamp: NOW + 3_591
      }))
    }))

    await expect(lsp.receiveAsset({
      assetId: PAYOUT.assetId,
      amountSats: 3_000,
      amountRgb: 500_000
    })).rejects.toThrow(/outlives its Lightning payout/)
  })

  it('rejects a conversion flag that contradicts the two signed asset legs', async () => {
    const { lsp } = makeLsp()
    lsp.http.lightningReceiveVerified.mockResolvedValue({
      lnInvoice: 'ln-wallet',
      rgbInvoice: 'rgb-invoice',
      mappingId: '7',
      rgbAssetId: CANONICAL.assetId,
      converted: false
    })

    await expect(lsp.receiveAsset({
      assetId: PAYOUT.assetId,
      amountSats: 3_000,
      amountRgb: 500_000
    })).rejects.toThrow(/conversion flag/)
  })
})

describe('on-chain delivery bridge', () => {
  function bridgeAccount (overrides = {}) {
    return account({
      listChannels: jest.fn(async () => [paymentChannel(CANONICAL.assetId, 500_000)]),
      decodeInvoice: jest.fn(async () => decodedInvoice({
        asset_id: CANONICAL.assetId,
        payee_pubkey: LSP_KEY,
        expiry_sec: 900
      })),
      ...overrides
    })
  }

  it('verifies both signed legs before paying the LSP invoice', async () => {
    const { lsp, wallet } = makeLsp(bridgeAccount())
    const result = await lsp.sendAsset({
      rgbInvoice: 'rgb-invoice',
      ln: {
        amtMsat: 3_000_000,
        expirySec: 900,
        assetId: CANONICAL.assetId,
        assetAmount: 500_000,
        paymentHash: HASH,
        descriptionHash: METADATA_HASH,
        minFinalCltvExpiryDelta: 42
      },
      requireInvoiceVerification: true
    })

    expect(lsp.http.onchainSendVerified).toHaveBeenCalledWith({
      rgbInvoice: 'rgb-invoice',
      ln: {
        amtMsat: 3_000_000,
        expirySec: 900,
        assetId: CANONICAL.assetId,
        assetAmount: 500_000,
        paymentHash: HASH,
        descriptionHash: METADATA_HASH,
        minFinalCltvExpiryDelta: 42
      }
    })
    expect(wallet.decodeRgbInvoice).toHaveBeenCalledWith('rgb-invoice')
    expect(wallet.decodeInvoice).toHaveBeenCalledWith('ln-bridge')
    expect(wallet.sendPayment).toHaveBeenCalledWith({
      invoice: 'ln-bridge',
      max_total_routing_fee_msat: 0
    })
    expect(result).toMatchObject({
      rgbInvoice: 'rgb-invoice',
      lnInvoice: 'ln-bridge',
      mappingId: '9'
    })
  })

  it.each([
    [
      'description hash',
      { descriptionHash: 'bb'.repeat(32) },
      /different requested description hash/
    ],
    [
      'minimum final CLTV delta',
      { minFinalCltvExpiryDelta: 144 },
      /different requested minimum final CLTV delta/
    ]
  ])('does not pay when the signed LSP invoice changes the requested %s', async (_field, ln, error) => {
    const { lsp, wallet } = makeLsp(bridgeAccount())

    await expect(lsp.sendAsset({
      rgbInvoice: 'rgb-invoice',
      ln: { amtMsat: 3_000_000, ...ln },
      requireInvoiceVerification: true
    })).rejects.toThrow(error)
    expect(wallet.sendPayment).not.toHaveBeenCalled()
  })

  it('does not pay when the LSP substitutes the recipient RGB invoice', async () => {
    const { lsp, wallet } = makeLsp(bridgeAccount())
    lsp.http.onchainSendVerified.mockResolvedValue({
      lnInvoice: 'ln-bridge',
      rgbInvoice: 'rgb-other',
      mappingId: '9'
    })

    await expect(lsp.sendAsset({
      rgbInvoice: 'rgb-invoice',
      ln: { amtMsat: 3_000_000 }
    })).rejects.toThrow(/different RGB invoice/)
    expect(wallet.sendPayment).not.toHaveBeenCalled()
  })

  it('does not pay when the signed LSP invoice changes the asset', async () => {
    const { lsp, wallet } = makeLsp(bridgeAccount({
      decodeInvoice: jest.fn(async () => decodedInvoice({
        asset_id: PAYOUT.assetId,
        payee_pubkey: LSP_KEY,
        expiry_sec: 900
      }))
    }))

    await expect(lsp.sendAsset({
      rgbInvoice: 'rgb-invoice',
      ln: { amtMsat: 3_000_000 },
      requireInvoiceVerification: true
    })).rejects.toThrow(/asset and amount/)
    expect(wallet.sendPayment).not.toHaveBeenCalled()
  })

  it('does not pay an expired bridge invoice', async () => {
    const { lsp, wallet } = makeLsp(bridgeAccount({
      decodeInvoice: jest.fn(async () => decodedInvoice({
        asset_id: CANONICAL.assetId,
        payee_pubkey: LSP_KEY,
        timestamp: NOW - 901,
        expiry_sec: 900
      }))
    }))

    await expect(lsp.sendAsset({
      rgbInvoice: 'rgb-invoice',
      ln: { amtMsat: 3_000_000 }
    })).rejects.toThrow(/already expired/)
    expect(wallet.sendPayment).not.toHaveBeenCalled()
  })

  it('requires the recipient RGB invoice to identify its network', async () => {
    const { lsp, wallet } = makeLsp(bridgeAccount({
      decodeRgbInvoice: jest.fn(async () => ({
        asset_id: CANONICAL.assetId,
        assignment: { type: 'Fungible', value: 500_000 },
        expiration_timestamp: NOW + 3_590
      }))
    }))

    await expect(lsp.sendAsset({
      rgbInvoice: 'rgb-invoice',
      ln: { amtMsat: 3_000_000 }
    })).rejects.toThrow(/does not identify its Bitcoin network/)
    expect(wallet.sendPayment).not.toHaveBeenCalled()
    expect(lsp.http.onchainSendVerified).not.toHaveBeenCalled()
  })

  it('rejects an expired recipient RGB invoice before creating LSP state', async () => {
    const { lsp, wallet } = makeLsp(bridgeAccount({
      decodeRgbInvoice: jest.fn(async () => ({
        asset_id: CANONICAL.assetId,
        assignment: { type: 'Fungible', value: 500_000 },
        network: 'Signet',
        expiration_timestamp: NOW
      }))
    }))

    await expect(lsp.sendAsset({
      rgbInvoice: 'rgb-invoice',
      ln: { amtMsat: 3_000_000 }
    })).rejects.toThrow(/no valid future expiry/)
    expect(lsp.http.onchainSendVerified).not.toHaveBeenCalled()
    expect(wallet.sendPayment).not.toHaveBeenCalled()
  })

  it('rejects a bridge Lightning leg that outlives its RGB recipient', async () => {
    const { lsp, wallet } = makeLsp(bridgeAccount({
      decodeInvoice: jest.fn(async () => decodedInvoice({
        asset_id: CANONICAL.assetId,
        payee_pubkey: LSP_KEY,
        expiry_sec: 4_000
      }))
    }))

    await expect(lsp.sendAsset({
      rgbInvoice: 'rgb-invoice',
      ln: { amtMsat: 3_000_000 }
    })).rejects.toThrow(/outlives the recipient RGB invoice/)
    expect(wallet.sendPayment).not.toHaveBeenCalled()
  })

  it('enforces the caller routing-fee ceiling at the native payment boundary', async () => {
    const { lsp, wallet } = makeLsp(bridgeAccount())

    await lsp.sendAsset({
      rgbInvoice: 'rgb-invoice',
      ln: { amtMsat: 3_000_000 },
      maxTotalRoutingFeeMsat: 2_500
    })

    expect(wallet.sendPayment).toHaveBeenCalledWith({
      invoice: 'ln-bridge',
      max_total_routing_fee_msat: 2_500
    })
  })

  it('does not pay when RGB and carrier liquidity are split across channels', async () => {
    const { lsp, wallet } = makeLsp(bridgeAccount({
      listChannels: jest.fn(async () => [
        paymentChannel(CANONICAL.assetId, 500_000, 1),
        paymentChannel(CANONICAL.assetId, 1, 3_000_000)
      ])
    }))

    await expect(lsp.sendAsset({
      rgbInvoice: 'rgb-invoice',
      ln: { amtMsat: 3_000_000 }
    })).rejects.toThrow(/same usable channel/)
    expect(wallet.sendPayment).not.toHaveBeenCalled()
  })

  it('rejects a bridge invoice in an asset the LSP does not advertise', async () => {
    const { lsp, wallet } = makeLsp(bridgeAccount())
    lsp.http.getInfo.mockResolvedValue({
      pubkey: LSP_KEY,
      network: 'signet',
      supported_assets: [{
        asset_id: PAYOUT.assetId,
        schema: 'Ifa',
        ticker: 'LNUSDT',
        name: PAYOUT.name,
        precision: 6
      }]
    })

    await expect(lsp.sendAsset({
      rgbInvoice: 'rgb-invoice',
      ln: { amtMsat: 3_000_000 }
    })).rejects.toThrow(/not advertised by this LSP/)
    expect(wallet.sendPayment).not.toHaveBeenCalled()
  })

  it('rejects an LSP network mismatch before creating bridge state', async () => {
    const { lsp, wallet } = makeLsp(bridgeAccount())
    lsp.http.getInfo.mockResolvedValue({
      pubkey: LSP_KEY,
      network: 'regtest',
      supported_assets: []
    })

    await expect(lsp.sendAsset({
      rgbInvoice: 'rgb-invoice',
      ln: { amtMsat: 3_000_000 }
    })).rejects.toThrow(/network differs from the configured peer/)
    expect(lsp.http.onchainSendVerified).not.toHaveBeenCalled()
    expect(wallet.sendPayment).not.toHaveBeenCalled()
  })

  it('rejects an invalid routing-fee policy before creating LSP state', async () => {
    const { lsp, wallet } = makeLsp(bridgeAccount())

    await expect(lsp.sendAsset({
      rgbInvoice: 'rgb-invoice',
      maxTotalRoutingFeeMsat: -1
    })).rejects.toThrow(/non-negative safe integer/)
    expect(lsp.http.onchainSendVerified).not.toHaveBeenCalled()
    expect(wallet.sendPayment).not.toHaveBeenCalled()
  })

  it('rejects non-canonical invoices and malformed Lightning options before creating LSP state', async () => {
    const { lsp, wallet } = makeLsp(bridgeAccount())

    await expect(lsp.sendAsset({ rgbInvoice: ' rgb-invoice' }))
      .rejects.toThrow(/rgbInvoice required/)
    await expect(lsp.sendAsset({ rgbInvoice: 'rgb-invoice', ln: [] }))
      .rejects.toThrow(/ln must be an object/)
    await expect(lsp.sendAsset({
      rgbInvoice: 'rgb-invoice',
      ln: { assetId: ' rgb:asset' }
    })).rejects.toThrow(/whitespace-free/)
    expect(lsp.http.onchainSendVerified).not.toHaveBeenCalled()
    expect(wallet.decodeRgbInvoice).not.toHaveBeenCalled()
    expect(wallet.sendPayment).not.toHaveBeenCalled()
  })

  it('fails closed when strict verification is required but decoding is unavailable', async () => {
    const { lsp, wallet } = makeLsp(account({
      decodeInvoice: undefined,
      decodeRgbInvoice: undefined
    }))

    await expect(lsp.sendAsset({
      rgbInvoice: 'rgb-invoice',
      ln: { amtMsat: 3_000_000 },
      requireInvoiceVerification: true
    })).rejects.toThrow(/cannot decode both bridge invoices/)
    expect(wallet.sendPayment).not.toHaveBeenCalled()
  })

  it('honors cancellation immediately before the native payment boundary', async () => {
    const controller = new AbortController()
    const { lsp, wallet } = makeLsp(bridgeAccount())
    lsp.http.onchainSendVerified.mockImplementation(async ({ rgbInvoice }) => {
      controller.abort()
      return { lnInvoice: 'ln-bridge', rgbInvoice, mappingId: '9' }
    })

    await expect(lsp.sendAsset({
      rgbInvoice: 'rgb-invoice',
      ln: { amtMsat: 3_000_000 },
      signal: controller.signal
    })).rejects.toThrow(/operation aborted/)
    expect(wallet.sendPayment).not.toHaveBeenCalled()
  })
})

describe('Lightning Address linked flows', () => {
  it('selects automatic RGB liquidity against the same channel carrier amount', async () => {
    const { lsp } = makeLsp(account({
      listChannels: jest.fn(async () => [{
        assetId: PAYOUT.assetId,
        assetLocalAmount: 500_000,
        outboundBalanceMsat: 3_000_000,
        isUsable: true
      }]),
      decodeInvoice: jest.fn(async () => decodedInvoice({
        asset_id: PAYOUT.assetId,
        payee_pubkey: LSP_KEY
      }))
    }))

    await expect(lsp.quoteAddress({
      address: 'alice@lsp.example',
      amtMsat: 3_000_000,
      asset: { assetAmount: 500_000 }
    })).resolves.toMatchObject({
      assetId: PAYOUT.assetId,
      assetSelection: { assetId: PAYOUT.assetId, converted: false }
    })

    lsp.account.listChannels.mockResolvedValueOnce([{
      assetId: PAYOUT.assetId,
      assetLocalAmount: 500_000,
      outboundBalanceMsat: 2_999_999,
      isUsable: true
    }])
    await expect(lsp.quoteAddress({
      address: 'alice@lsp.example',
      amtMsat: 3_000_000,
      asset: { assetAmount: 500_000 }
    })).rejects.toThrow(/No accepted asset has 500000 spendable base units/)
  })

  it('rechecks explicit Lightning Address liquidity before native payment', async () => {
    const { lsp, wallet } = makeLsp(account({
      listChannels: jest.fn(async () => [
        paymentChannel(PAYOUT.assetId, 500_000, 1),
        paymentChannel(PAYOUT.assetId, 1, 3_000_000)
      ]),
      decodeInvoice: jest.fn(async () => decodedInvoice({
        asset_id: PAYOUT.assetId,
        payee_pubkey: LSP_KEY
      }))
    }))

    await expect(lsp.payAddress({
      address: 'alice@lsp.example',
      amtMsat: 3_000_000,
      asset: { assetId: PAYOUT.assetId, assetAmount: 500_000 }
    })).rejects.toThrow(/same usable channel/)
    expect(wallet.sendPayment).not.toHaveBeenCalled()
  })

  it('rejects malformed selection input before discovery or callback state', async () => {
    const { lsp } = makeLsp()

    await expect(lsp.requestExternalInvoice({
      address: ' alice@lsp.example',
      amtMsat: 3_000_000,
      assetAmount: 500_000
    })).rejects.toThrow(/address must be a non-empty canonical string/)
    await expect(lsp.requestExternalInvoice({
      address: 'alice@lsp.example',
      amtMsat: 3_000_000,
      assetAmount: 500_000,
      asset: 42
    })).rejects.toThrow(/asset must be a non-empty canonical string/)
    await expect(lsp.requestExternalInvoice({
      address: 'alice@lsp.example',
      amtMsat: 3_000_000,
      assetAmount: 500_000,
      prefer: 'first'
    })).rejects.toThrow(/prefer must be/)
    expect(lsp.http.discoverAddress).not.toHaveBeenCalled()
    expect(lsp.http.resolveAddressVerified).not.toHaveBeenCalled()
  })

  it('quotes canonical USDT for an external payer and preserves the payout representation', async () => {
    const { lsp } = makeLsp(account({
      decodeInvoice: jest.fn(async () => decodedInvoice({
        payee_pubkey: LSP_KEY,
        asset_id: CANONICAL.assetId
      }))
    }))
    const result = await lsp.requestExternalInvoice({
      address: 'alice@lsp.example',
      amtMsat: 3_000_000,
      assetAmount: 500_000
    })

    expect(result.asset).toBe(CANONICAL)
    expect(result.converted).toBe(true)
    expect(result.paymentHash).toBe(HASH)
    expect(lsp.http.resolveAddressVerified.mock.calls[0][2]).toMatchObject({
      assetId: CANONICAL.assetId,
      assetAmount: 500_000
    })
  })

  it('rejects a hosted address whose node attestation belongs to another address', async () => {
    const { lsp } = makeLsp()
    lsp.http.discoverAddress.mockResolvedValue({
      callback: 'https://lsp.example/pay/callback/mallory',
      minSendable: 1,
      maxSendable: 100_000_000,
      metadata: '[["text/plain","pay"]]',
      tag: 'payRequest',
      recipientPubkey: WALLET_KEY,
      addressSig: ADDRESS_SIGNATURE,
      payoutAsset: PAYOUT,
      acceptedAssets: [PAYOUT, CANONICAL]
    })

    await expect(lsp.requestExternalInvoice({
      address: 'mallory@lsp.example',
      amtMsat: 3_000_000,
      assetAmount: 500_000
    })).rejects.toThrow(/attestation signature/)
  })

  it('rejects an invoice that does not commit to the exact discovery metadata', async () => {
    const { lsp } = makeLsp(account({
      decodeInvoice: jest.fn(async () => decodedInvoice({
        payee_pubkey: LSP_KEY,
        asset_id: CANONICAL.assetId,
        description_hash: 'bb'.repeat(32)
      }))
    }))

    await expect(lsp.requestExternalInvoice({
      address: 'alice@lsp.example',
      amtMsat: 3_000_000,
      assetAmount: 500_000
    })).rejects.toThrow(/discovery metadata/)
  })

  it('rejects a hosted quote when current LSP discovery is on another network', async () => {
    const { lsp, wallet } = makeLsp()
    lsp.http.getInfo.mockResolvedValue({
      pubkey: LSP_KEY,
      network: 'regtest',
      supported_assets: []
    })

    await expect(lsp.quoteAddress({
      address: 'alice@lsp.example',
      amtMsat: 3_000_000,
      asset: { assetId: CANONICAL.assetId, assetAmount: 500_000 }
    })).rejects.toThrow(/network differs from the configured peer/)
    expect(lsp.http.resolveAddressVerified).not.toHaveBeenCalled()
    expect(wallet.sendPayment).not.toHaveBeenCalled()
  })

  it('binds an external APay proof host to the signed invoice payee', async () => {
    const previousFetch = globalThis.fetch
    globalThis.fetch = jest.fn()
      .mockResolvedValueOnce(jsonResponse({
        tag: 'payRequest',
        callback: 'https://merchant.example/callback',
        minSendable: 1,
        maxSendable: 100_000_000,
        metadata: '[["text/plain","pay"]]',
        recipient_pubkey: WALLET_KEY,
        payout_asset: {
          asset_id: CANONICAL.assetId,
          schema: CANONICAL.schema,
          ticker: CANONICAL.ticker,
          name: CANONICAL.name,
          precision: CANONICAL.precision
        },
        accepted_assets: [{
          asset_id: CANONICAL.assetId,
          schema: CANONICAL.schema,
          ticker: CANONICAL.ticker,
          name: CANONICAL.name,
          precision: CANONICAL.precision
        }]
      }))
      .mockResolvedValueOnce(jsonResponse({
        pr: 'ln-address',
        routes: [],
        proof: wireProof()
      }))

    try {
      const { lsp, wallet } = makeLsp(account({
        decodeInvoice: jest.fn(async () => decodedInvoice({
          asset_id: CANONICAL.assetId,
          payee_pubkey: PAYEE_KEY
        }))
      }))
      await expect(lsp.quoteAddress({
        address: 'alice@merchant.example',
        amtMsat: 3_000_000,
        asset: { assetId: CANONICAL.assetId, assetAmount: 500_000 },
        requireAddressProof: true
      })).rejects.toThrow(/different LSP/)
      expect(wallet.sendPayment).not.toHaveBeenCalled()
    } finally {
      globalThis.fetch = previousFetch
    }
  })

  it('registers and reports address-attested APay pool state', async () => {
    const { lsp, wallet } = makeLsp()
    await expect(lsp.enableLightningAddress()).resolves.toEqual({
      username: 'alice',
      domain: 'lsp.example',
      address: 'alice@lsp.example',
      unusedHashes: 90,
      nextIndexExpected: 10,
      refillBatchSize: 100
    })
    expect(wallet.apayNewWithAddress).toHaveBeenCalledWith(LSP_KEY, 'alice', 'lsp.example')
  })
})

describe('external BOLT11 relay', () => {
  it('quotes, independently re-verifies, pays, and exposes durable LSP status', async () => {
    const { lsp, wallet } = makeLsp(account({
      listChannels: jest.fn(async () => [paymentChannel(PAYOUT.assetId, 500_000)])
    }))
    const quote = await lsp.quoteExternalPayment({
      invoice: 'ln-target',
      payWith: PAYOUT.assetId,
      maxFeeMsat: 1_000,
      maxTotalRoutingFeeMsat: 2_000
    })
    expect(quote).toMatchObject({
      targetInvoice: 'ln-target',
      invoice: 'ln-hodl',
      paymentHash: HASH,
      converted: true,
      verified: true
    })

    const authorization = {
      invoice: 'ln-target',
      fundingAssetId: PAYOUT.assetId,
      maxFeeMsat: 1_000,
      maxTotalRoutingFeeMsat: 2_000
    }
    await expect(lsp.verifyExternalQuote(quote, authorization)).resolves.toStrictEqual(quote)
    const paid = await lsp.payExternalQuote(quote, authorization)
    expect(wallet.decodeInvoice).toHaveBeenCalledTimes(6)
    expect(wallet.sendPayment).toHaveBeenCalledWith({
      invoice: 'ln-hodl',
      max_total_routing_fee_msat: 2_000
    })
    expect(paid.quote).toStrictEqual(quote)
    expect(paid.quote).not.toBe(quote)
    await expect(lsp.externalPaymentStatus(HASH)).resolves.toEqual({
      paymentHash: HASH,
      status: 'settled'
    })
  })

  it('rejects a restored quote whose exact funding channel lost carrier liquidity', async () => {
    const { lsp, wallet } = makeLsp(account({
      listChannels: jest.fn(async () => [paymentChannel(PAYOUT.assetId, 500_000, 3_000_000)])
    }))
    const quote = await lsp.quoteExternalPayment({
      invoice: 'ln-target',
      payWith: PAYOUT.assetId,
      maxFeeMsat: 1_000,
      maxTotalRoutingFeeMsat: 2_000
    })

    await expect(lsp.payExternalQuote(quote, {
      invoice: 'ln-target',
      fundingAssetId: PAYOUT.assetId,
      maxFeeMsat: 1_000,
      maxTotalRoutingFeeMsat: 2_000
    })).rejects.toThrow(/same usable channel/)
    expect(wallet.sendPayment).not.toHaveBeenCalled()
  })

  it('does not submit a payment when the LSP changes the signed funding hash', async () => {
    const wallet = account({
      decodeInvoice: jest.fn(async (invoice) => invoice === 'ln-target'
        ? decodedInvoice()
        : decodedInvoice({
          payment_hash: 'bb'.repeat(32),
          amt_msat: 3_001_000,
          asset_id: PAYOUT.assetId,
          payee_pubkey: LSP_KEY
        }))
    })
    const { lsp } = makeLsp(wallet)
    await expect(lsp.payExternalInvoice({
      invoice: 'ln-target',
      payWith: PAYOUT.assetId,
      maxFeeMsat: 1_000
    })).rejects.toThrow(/payment hash/)
    expect(wallet.sendPayment).not.toHaveBeenCalled()
  })

  it('re-verifies a restored quote without crossing the payment boundary', async () => {
    const { lsp, wallet } = makeLsp()
    const quote = await lsp.quoteExternalPayment({
      invoice: 'ln-target',
      payWith: PAYOUT.assetId,
      maxFeeMsat: 1_000
    })

    const restored = JSON.parse(JSON.stringify(quote))
    await expect(lsp.verifyExternalQuote(restored, {
      invoice: 'ln-target',
      fundingAssetId: PAYOUT.assetId,
      maxFeeMsat: 1_000
    })).resolves.toStrictEqual(restored)
    expect(wallet.sendPayment).not.toHaveBeenCalled()
  })

  it('requires an automatically selected funding representation to be authorized exactly', async () => {
    const { lsp, wallet } = makeLsp()
    const quote = await lsp.quoteExternalPayment({
      invoice: 'ln-target',
      maxFeeMsat: 1_000
    })

    await expect(lsp.verifyExternalQuote(quote, {
      invoice: 'ln-target',
      fundingAssetId: PAYOUT.assetId,
      maxFeeMsat: 1_000
    })).resolves.toStrictEqual(quote)
    await expect(lsp.verifyExternalQuote(quote, {
      invoice: 'ln-target',
      fundingAssetId: CANONICAL.assetId,
      maxFeeMsat: 1_000
    })).rejects.toThrow(/funding asset differs/)
    await expect(lsp.verifyExternalQuote(quote, {
      invoice: 'ln-target',
      maxFeeMsat: 1_000
    })).rejects.toThrow(/fundingAssetId/)
    expect(wallet.sendPayment).not.toHaveBeenCalled()
  })

  it('rejects a restored quote when its funding asset is no longer advertised', async () => {
    const { lsp, wallet } = makeLsp()
    const quote = await lsp.quoteExternalPayment({
      invoice: 'ln-target',
      payWith: PAYOUT.assetId,
      maxFeeMsat: 1_000
    })
    lsp.http.getInfo.mockResolvedValue({
      pubkey: LSP_KEY,
      network: 'signet',
      supported_assets: []
    })

    await expect(lsp.payExternalQuote(quote, {
      invoice: 'ln-target',
      fundingAssetId: PAYOUT.assetId,
      maxFeeMsat: 1_000
    }))
      .rejects.toThrow(/no longer advertised/)
    expect(wallet.sendPayment).not.toHaveBeenCalled()
  })

  it('never selects an unrelated liquid RGB channel as an implicit bridge', async () => {
    const { lsp } = makeLsp(account({
      listChannels: jest.fn(async () => [{
        assetId: PAYOUT.assetId,
        assetLocalAmount: 1_000_000,
        isUsable: true
      }])
    }))

    await lsp.quoteExternalPayment({
      invoice: 'ln-target',
      maxFeeMsat: 1_000
    })
    expect(lsp.http.lightningSend).toHaveBeenCalledWith({
      invoice: 'ln-target',
      payWithAssetId: undefined,
      timeoutMs: undefined,
      signal: undefined
    })
  })

  it('rejects a funding representation not advertised by the configured LSP', async () => {
    const { lsp, wallet } = makeLsp()
    lsp.http.lightningSend.mockResolvedValue({
      lnInvoice: 'ln-hodl',
      paymentHash: HASH,
      inbound: {
        assetId: 'rgb:substituted',
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
      expiresAt: NOW + 1_000
    })

    await expect(lsp.quoteExternalPayment({
      invoice: 'ln-target',
      maxFeeMsat: 1_000
    })).rejects.toThrow(/not advertised by this LSP/)
    expect(wallet.sendPayment).not.toHaveBeenCalled()
  })

  it('rejects substitution of an explicitly selected funding representation', async () => {
    const { lsp, wallet } = makeLsp()
    lsp.http.getInfo.mockResolvedValue({
      pubkey: LSP_KEY,
      network: 'signet',
      supported_assets: [
        { asset_id: PAYOUT.assetId, schema: 'Ifa', ticker: 'LNUSDT', name: PAYOUT.name, precision: 6 },
        { asset_id: CANONICAL.assetId, schema: 'Ifa', ticker: 'USDT', name: CANONICAL.name, precision: 6 }
      ]
    })

    await expect(lsp.quoteExternalPayment({
      invoice: 'ln-target',
      payWith: CANONICAL.assetId,
      maxFeeMsat: 1_000
    })).rejects.toThrow(/changed the explicitly selected payment asset/)
    expect(wallet.sendPayment).not.toHaveBeenCalled()
  })

  it('binds the native routing ceiling to review and rejects a payment-time override', async () => {
    const { lsp, wallet } = makeLsp()
    const quote = await lsp.quoteExternalPayment({
      invoice: 'ln-target',
      payWith: PAYOUT.assetId,
      maxFeeMsat: 1_000,
      maxTotalRoutingFeeMsat: 2_000
    })

    await expect(lsp.payExternalQuote(quote, {
      invoice: 'ln-target',
      fundingAssetId: PAYOUT.assetId,
      maxFeeMsat: 1_000,
      maxTotalRoutingFeeMsat: 2_001
    })).rejects.toThrow(/differs from the authorized payment intent/)
    expect(wallet.sendPayment).not.toHaveBeenCalled()
  })

  it('requires restored quotes to match the original trusted payment intent', async () => {
    const { lsp, wallet } = makeLsp()
    const quote = await lsp.quoteExternalPayment({
      invoice: 'ln-target',
      payWith: PAYOUT.assetId,
      maxFeeMsat: 1_000,
      maxTotalRoutingFeeMsat: 2_000
    })

    await expect(lsp.verifyExternalQuote(quote, {}))
      .rejects.toThrow(/authorized invoice/)
    await expect(lsp.verifyExternalQuote(quote, {
      invoice: 'ln-other',
      fundingAssetId: PAYOUT.assetId,
      maxFeeMsat: 1_000,
      maxTotalRoutingFeeMsat: 2_000
    })).rejects.toThrow(/target invoice differs/)
    await expect(lsp.verifyExternalQuote(quote, {
      invoice: 'ln-target',
      fundingAssetId: PAYOUT.assetId,
      maxFeeMsat: 1_001,
      maxTotalRoutingFeeMsat: 2_000
    })).rejects.toThrow(/LSP fee ceiling differs/)
    await expect(lsp.verifyExternalQuote(quote, {
      invoice: 'ln-target',
      fundingAssetId: CANONICAL.assetId,
      maxFeeMsat: 1_000,
      maxTotalRoutingFeeMsat: 2_000
    })).rejects.toThrow(/funding asset differs/)
    expect(wallet.sendPayment).not.toHaveBeenCalled()
  })

  it('rejects fee-policy fields altered inside a restored quote', async () => {
    const { lsp, wallet } = makeLsp()
    const quote = await lsp.quoteExternalPayment({
      invoice: 'ln-target',
      payWith: PAYOUT.assetId,
      maxFeeMsat: 1_000,
      maxTotalRoutingFeeMsat: 2_000
    })
    const authorization = {
      invoice: 'ln-target',
      fundingAssetId: PAYOUT.assetId,
      maxFeeMsat: 1_000,
      maxTotalRoutingFeeMsat: 2_000
    }

    await expect(lsp.payExternalQuote({ ...quote, maxFeeMsat: 10_000 }, authorization))
      .rejects.toThrow(/LSP fee ceiling differs/)
    await expect(lsp.payExternalQuote({
      ...quote,
      maxTotalRoutingFeeMsat: 20_000
    }, authorization)).rejects.toThrow(/routing fee ceiling differs/)
    expect(wallet.sendPayment).not.toHaveBeenCalled()
  })

  it('honors cancellation immediately before the native relay payment', async () => {
    const { lsp, wallet } = makeLsp()
    const quote = await lsp.quoteExternalPayment({
      invoice: 'ln-target',
      payWith: PAYOUT.assetId,
      maxFeeMsat: 1_000
    })
    const controller = new AbortController()
    controller.abort()

    await expect(lsp.payExternalQuote(quote, { signal: controller.signal }))
      .rejects.toThrow(/operation aborted/)
    expect(wallet.sendPayment).not.toHaveBeenCalled()
  })

  it('rejects get_info from a node or network other than the configured LSP', async () => {
    const { lsp } = makeLsp()
    lsp.http.getInfo.mockResolvedValue({
      pubkey: PAYEE_KEY,
      network: 'signet',
      supported_assets: []
    })
    await expect(lsp.quoteExternalPayment({ invoice: 'ln-target' }))
      .rejects.toThrow(/identity differs/)

    lsp.http.getInfo.mockResolvedValue({
      pubkey: LSP_KEY,
      network: 'regtest',
      supported_assets: []
    })
    await expect(lsp.quoteExternalPayment({ invoice: 'ln-target' }))
      .rejects.toThrow(/network differs/)
  })
})
