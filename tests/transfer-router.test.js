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
  account.sendTransaction = jest.fn(async () => ({ txid: 'btctxid' }))
  account.sendRgbAsset = jest.fn(async () => ({ txid: 'rgbtxid' }))
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
      address: BTC_ADDR,
      amount: 50000,
      fee_rate: 2,
      skip_sync: false
    })
    // fee = round(feeRate * APPROX_BTC_TX_VBYTES) = round(2 * 141) = 282
    expect(res).toEqual({ hash: 'btctxid', fee: 282n })
  })

  it('requires an amount for the on-chain path', async () => {
    const account = makeAccount()
    await expect(account.transfer({ recipient: BTC_ADDR })).rejects.toThrow('transfer(on-chain): amount (sats) is required')
    expect(account.sendTransaction).not.toHaveBeenCalled()
  })

  it('routes an RGB invoice to sendRgbAsset and reports a zero fee', async () => {
    const account = makeAccount()
    const res = await account.transfer({ recipient: RGB_INVOICE, amount: 5, token: 'asset123' })
    expect(account.sendRgbAsset).toHaveBeenCalledWith({ recipient_id: RGB_INVOICE, amount: 5, asset_id: 'asset123' })
    expect(res).toEqual({ hash: 'rgbtxid', fee: 0n })
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
