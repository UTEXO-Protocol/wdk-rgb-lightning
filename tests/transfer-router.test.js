// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.

// Unit tests for the generic `transfer()` / `quoteTransfer()` routers.
// They classify the recipient and dispatch to the right backing method;
// here we stub those backing methods on the instance so no node, binding
// or network is touched.

import { jest } from '@jest/globals'
import WalletAccountRgbLightning from '../src/wallet-account-rgb-lightning.js'

// A 66-hex-char compressed pubkey for the keysend (ln-pubkey) path.
const LN_PUBKEY = '02' + 'f'.repeat(64)
const BOLT11 = 'lnbcrt10u1pcoffee'
const BTC_ADDR = 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080'
const RGB_INVOICE = 'rgb:2WBcas9-usxg9Hm9d-N6q2Lpf3Z'

function makeAccount () {
  // The constructor only needs a truthy `binding`; the routed methods are
  // stubbed below so `_node` is never dereferenced.
  const account = new WalletAccountRgbLightning({ binding: { node: {} } })
  account.sendPayment = jest.fn(async () => ({ payment_hash: 'ph', fee_msat: 7 }))
  account.keysend = jest.fn(async () => ({ payment_hash: 'kh', fee_msat: 11 }))
  account.sendTransaction = jest.fn(async () => ({ hash: 'btctxid', fee: 282n }))
  account.sendRgbAsset = jest.fn(async () => ({ txid: 'rgbtxid' }))
  // The RGB path decodes the invoice to source recipient_id / asset_id /
  // transport_endpoints before building the native sendRgb request.
  account.decodeRgbInvoice = jest.fn(async () => ({
    recipient_id: 'recip123',
    asset_id: 'assetFromInvoice',
    transport_endpoints: ['rpc://proxy.example/json-rpc']
  }))
  return account
}

describe('WalletAccountRgbLightning.transfer', () => {
  it('rejects a non-object options argument', async () => {
    const account = makeAccount()
    await expect(account.transfer(null)).rejects.toThrow('options must be { recipient, amount, token? }')
    await expect(account.transfer('lnbc...')).rejects.toThrow('options must be { recipient, amount, token? }')
  })

  it('routes a BOLT11 recipient to sendPayment and returns {hash, fee:BigInt}', async () => {
    const account = makeAccount()
    const res = await account.transfer({ recipient: BOLT11, amount: 1000 })
    expect(account.sendPayment).toHaveBeenCalledWith({ invoice: BOLT11, amt_msat: 1000 })
    expect(res).toEqual({ hash: 'ph', fee: 7n })
  })

  it('forwards token as asset_id on the BOLT11 path', async () => {
    const account = makeAccount()
    await account.transfer({ recipient: BOLT11, amount: 1000, token: 'asset123' })
    expect(account.sendPayment).toHaveBeenCalledWith({ invoice: BOLT11, amt_msat: 1000, asset_id: 'asset123' })
  })

  it('routes an LN pubkey to keysend', async () => {
    const account = makeAccount()
    const res = await account.transfer({ recipient: LN_PUBKEY, amount: 2000 })
    expect(account.keysend).toHaveBeenCalledWith({ dest_pubkey: LN_PUBKEY, amt_msat: 2000 })
    expect(res).toEqual({ hash: 'kh', fee: 11n })
  })

  it('requires an amount for the keysend path', async () => {
    const account = makeAccount()
    await expect(account.transfer({ recipient: LN_PUBKEY })).rejects.toThrow('transfer(keysend): amount (msats) is required')
    expect(account.keysend).not.toHaveBeenCalled()
  })

  it('routes a BTC address to sendTransaction with the supplied fee rate', async () => {
    const account = makeAccount()
    const res = await account.transfer({ recipient: BTC_ADDR, amount: 50000, feeRate: 2 })
    expect(account.sendTransaction).toHaveBeenCalledWith({
      to: BTC_ADDR,
      value: 50000,
      feeRate: 2,
      confirmationTarget: 6
    })
    // fee = round(feeRate * APPROX_BTC_TX_VBYTES) = round(2 * 141) = 282
    expect(res).toEqual({ hash: 'btctxid', fee: 282n })
  })

  it('requires an amount for the on-chain path', async () => {
    const account = makeAccount()
    await expect(account.transfer({ recipient: BTC_ADDR })).rejects.toThrow('transfer(on-chain): amount (sats) is required')
    expect(account.sendTransaction).not.toHaveBeenCalled()
  })

  it('decodes the RGB invoice and sends the nested recipient_groups shape RLN requires', async () => {
    const account = makeAccount()
    const res = await account.transfer({ recipient: RGB_INVOICE, amount: 5, token: 'asset123', feeRate: 4 })
    expect(account.decodeRgbInvoice).toHaveBeenCalledWith(RGB_INVOICE)
    expect(account.sendRgbAsset).toHaveBeenCalledWith({
      donation: false,
      fee_rate: 4,
      min_confirmations: 1,
      recipient_groups: [{
        asset_id: 'asset123',
        recipients: [{
          recipient_id: 'recip123',
          assignment_kind: 'Fungible',
          assignment_amount: 5,
          transport_endpoints: ['rpc://proxy.example/json-rpc']
        }]
      }]
    })
    expect(res).toEqual({ hash: 'rgbtxid', fee: 0n })
  })

  it('falls back to the invoice-encoded asset_id when no token is supplied', async () => {
    const account = makeAccount()
    await account.transfer({ recipient: RGB_INVOICE, amount: 2, feeRate: 1 })
    const sent = account.sendRgbAsset.mock.calls[0][0]
    expect(sent.recipient_groups[0].asset_id).toBe('assetFromInvoice')
  })

  it('uses a live fee-rate estimate when feeRate is omitted', async () => {
    const account = makeAccount()
    account._defaultFeeRate = jest.fn(async () => 9)
    await account.transfer({ recipient: RGB_INVOICE, amount: 1, token: 'asset123' })
    expect(account._defaultFeeRate).toHaveBeenCalledWith(6)
    expect(account.sendRgbAsset.mock.calls[0][0].fee_rate).toBe(9)
  })

  it('requires an amount on the RGB path', async () => {
    const account = makeAccount()
    await expect(account.transfer({ recipient: RGB_INVOICE, token: 'asset123' }))
      .rejects.toThrow('transfer(rgb): amount (asset units) is required')
    expect(account.decodeRgbInvoice).not.toHaveBeenCalled()
    expect(account.sendRgbAsset).not.toHaveBeenCalled()
  })

  it('throws when the invoice yields no recipient_id', async () => {
    const account = makeAccount()
    account.decodeRgbInvoice = jest.fn(async () => ({ asset_id: 'a', transport_endpoints: ['rpc://x'] }))
    await expect(account.transfer({ recipient: RGB_INVOICE, amount: 5, feeRate: 1 }))
      .rejects.toThrow('could not decode a recipient_id')
    expect(account.sendRgbAsset).not.toHaveBeenCalled()
  })

  it('throws when there are no transport endpoints and no proxy is configured', async () => {
    const account = makeAccount()
    account.decodeRgbInvoice = jest.fn(async () => ({ recipient_id: 'r', asset_id: 'a', transport_endpoints: [] }))
    await expect(account.transfer({ recipient: RGB_INVOICE, amount: 5, feeRate: 1 }))
      .rejects.toThrow('no transport endpoints')
    expect(account.sendRgbAsset).not.toHaveBeenCalled()
  })

  it('falls back to the wallet proxyEndpoint when the invoice carries no transport endpoints', async () => {
    const account = makeAccount()
    account._binding._config = { proxyEndpoint: 'rpc://wallet-proxy/json-rpc' }
    account.decodeRgbInvoice = jest.fn(async () => ({ recipient_id: 'r', asset_id: 'a', transport_endpoints: [] }))
    await account.transfer({ recipient: RGB_INVOICE, amount: 5, feeRate: 1 })
    const sent = account.sendRgbAsset.mock.calls[0][0]
    expect(sent.recipient_groups[0].recipients[0].transport_endpoints).toEqual(['rpc://wallet-proxy/json-rpc'])
  })
})

describe('WalletAccountRgbLightning.quoteTransfer', () => {
  it('rejects a non-object options argument', async () => {
    const account = makeAccount()
    await expect(account.quoteTransfer(undefined)).rejects.toThrow('options must be { recipient, amount, token? }')
  })

  it('quotes LN transfers as a basis-point fraction of the amount', async () => {
    const account = makeAccount()
    // ceil(1_000_000 * 50 / 10000) = 5000
    await expect(account.quoteTransfer({ recipient: BOLT11, amount: 1_000_000 })).resolves.toEqual({ fee: 5000n })
    // floor at 1 for tiny/zero amounts
    await expect(account.quoteTransfer({ recipient: LN_PUBKEY, amount: 0 })).resolves.toEqual({ fee: 1n })
  })

  it('quotes on-chain transfers from the default fee rate and tx size', async () => {
    const account = makeAccount()
    account._defaultFeeRate = jest.fn(async () => 3)
    // round(3 * 141) = 423
    await expect(account.quoteTransfer({ recipient: BTC_ADDR, amount: 50000 })).resolves.toEqual({ fee: 423n })
    expect(account._defaultFeeRate).toHaveBeenCalledWith(6)
  })
})
