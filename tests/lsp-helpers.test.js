// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.

// Unit tests for the higher-level LSP orchestration helpers. These
// compose an "account-like" object with LspClient + the generic LUD-06
// resolver. We never hit the network: `payLightningAddress` is driven
// through the real `resolveAddressToInvoice` with an injected fake
// `fetch`, and the LSP-mediated helpers are exercised both with a real
// `LspClient` (also fetch-injected) and a hand-rolled fake client.

import { jest } from '@jest/globals'
import {
  payLightningAddress,
  requestLspRgbDeposit,
  payRgbViaLsp
} from '../src/lsp-helpers.js'
import { LspClient } from '../src/lsp-client.js'

const BOLT11 = 'lnbcrt10u1pcoffee'

// A Response-like object for the injected fetch.
function jsonResponse (obj, { ok = true, status = 200 } = {}) {
  const text = JSON.stringify(obj)
  return { ok, status, text: async () => text, json: async () => obj }
}

// Build a fake fetch that resolves the LUD-06 two-step (discovery then
// callback) for `resolveAddressToInvoice`. The first call returns the
// payRequest metadata; the second returns the BOLT11 invoice.
function makeLnurlFetch ({ pr = BOLT11, callback = 'https://host.example/cb', routes, maxSendable = 1_000_000_000 } = {}) {
  const discovery = {
    tag: 'payRequest',
    callback,
    minSendable: 1,
    maxSendable,
    metadata: '[["text/plain","tip"]]'
  }
  return jest.fn(async (url) => {
    if (String(url).includes('/.well-known/lnurlp/')) return jsonResponse(discovery)
    return jsonResponse(routes ? { pr, routes } : { pr })
  })
}

// `asLspClient` only accepts a real LspClient instance or a base-URL
// string, so we build a genuine client wired to a fetch that returns
// `body` for the single POST the helper makes. Exposing the underlying
// fetch lets callers assert the URL/method/body.
function makeLspClient (body) {
  const fetch = jest.fn(async () => jsonResponse(body))
  const client = new LspClient({ baseUrl: 'https://lsp.example', fetch })
  return { client, fetch }
}

describe('payLightningAddress', () => {
  it('throws when account is null or lacks sendPayment', async () => {
    await expect(payLightningAddress(null, 'a@host', 1000)).rejects.toThrow(TypeError)
    await expect(payLightningAddress(null, 'a@host', 1000)).rejects.toThrow('account.sendPayment')
    await expect(payLightningAddress({}, 'a@host', 1000)).rejects.toThrow('account.sendPayment')
  })

  it('resolves the address and pays via sendPayment, returning the DTO', async () => {
    const fetch = makeLnurlFetch({ routes: [{ a: 1 }] })
    const account = { sendPayment: jest.fn(async () => ({ payment_hash: 'ph' })) }

    const out = await payLightningAddress(account, 'alice@host.example', 5000, { fetch, allowHttp: true })

    expect(account.sendPayment).toHaveBeenCalledWith({ invoice: BOLT11, amt_msat: 5000 })
    expect(out).toEqual({
      invoice: BOLT11,
      sendResult: { payment_hash: 'ph' },
      discovery: expect.objectContaining({ tag: 'payRequest' }),
      callbackUrl: expect.stringContaining('amount=5000')
    })
    // discovery + callback = two fetches.
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('omits amt_msat when opts.skipAmount is set', async () => {
    const fetch = makeLnurlFetch()
    const account = { sendPayment: jest.fn(async () => ({ ok: true })) }

    await payLightningAddress(account, 'bob@host.example', 5000, { fetch, skipAmount: true })

    expect(account.sendPayment).toHaveBeenCalledWith({ invoice: BOLT11 })
  })

  it('invokes the beforePay hook with (invoice, discovery) before paying', async () => {
    const fetch = makeLnurlFetch()
    const order = []
    const account = { sendPayment: jest.fn(async () => { order.push('pay'); return {} }) }
    const beforePay = jest.fn(async (pr, discovery) => {
      order.push('before')
      expect(pr).toBe(BOLT11)
      expect(discovery.tag).toBe('payRequest')
    })

    await payLightningAddress(account, 'carol@host.example', 2000, { fetch, beforePay })

    expect(beforePay).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['before', 'pay'])
  })

  it('coerces a small bigint amount to a Number for amt_msat', async () => {
    const fetch = makeLnurlFetch()
    const account = { sendPayment: jest.fn(async () => ({})) }
    await payLightningAddress(account, 'd@host.example', 1234n, { fetch })
    expect(account.sendPayment).toHaveBeenCalledWith({ invoice: BOLT11, amt_msat: 1234 })
  })

  it('keeps a huge bigint amount as a string for amt_msat', async () => {
    const huge = BigInt(Number.MAX_SAFE_INTEGER) + 10n
    const fetch = makeLnurlFetch({ maxSendable: (huge + 1n).toString() })
    const account = { sendPayment: jest.fn(async () => ({})) }
    await payLightningAddress(account, 'e@host.example', huge, { fetch })
    expect(account.sendPayment).toHaveBeenCalledWith({ invoice: BOLT11, amt_msat: huge.toString() })
  })

  it('passes through a numeric-string amount unchanged for amt_msat', async () => {
    const fetch = makeLnurlFetch()
    const account = { sendPayment: jest.fn(async () => ({})) }
    await payLightningAddress(account, 'f@host.example', '4096', { fetch })
    expect(account.sendPayment).toHaveBeenCalledWith({ invoice: BOLT11, amt_msat: '4096' })
  })

  it('rejects an amount that is not a non-negative integer', async () => {
    const fetch = makeLnurlFetch()
    const account = { sendPayment: jest.fn(async () => ({})) }
    // The bad amount only trips toUint64 after a successful resolve, so
    // sendPayment must never be reached.
    await expect(
      payLightningAddress(account, 'g@host.example', {}, { fetch })
    ).rejects.toThrow('amountMsat must be a non-negative integer')
    expect(account.sendPayment).not.toHaveBeenCalled()
  })
})

describe('requestLspRgbDeposit', () => {
  const rgb = { assetId: 'asset123', assignment: 'Any', witness: false }

  it('throws when account is null', async () => {
    await expect(requestLspRgbDeposit(null, { lsp: 'https://lsp.example', rgb }))
      .rejects.toThrow('account required')
  })

  it('throws when rgb params are missing or not an object', async () => {
    const account = { createInvoice: jest.fn() }
    await expect(requestLspRgbDeposit(account, { lsp: 'https://lsp.example' }))
      .rejects.toThrow('rgb params required')
    await expect(requestLspRgbDeposit(account, { lsp: 'https://lsp.example', rgb: 'nope' }))
      .rejects.toThrow('rgb params required')
  })

  it('uses a supplied lnInvoice and forwards it to lightningReceive (camelCase result)', async () => {
    const { client, fetch } = makeLspClient({ lnInvoice: BOLT11, rgbInvoice: 'rgb:zzz', mappingId: 42 })
    const account = {}
    const out = await requestLspRgbDeposit(account, { lsp: client, lnInvoice: BOLT11, rgb })

    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://lsp.example/lightning_receive')
    expect(JSON.parse(init.body)).toMatchObject({ ln_invoice: BOLT11, rgb_invoice: { asset_id: 'asset123' } })
    expect(out).toEqual({ lnInvoice: BOLT11, rgbInvoice: 'rgb:zzz', mappingId: 42 })
  })

  it('falls back to snake_case fields from the LSP response', async () => {
    const { client } = makeLspClient({ ln_invoice: BOLT11, rgb_invoice: 'rgb:snake', mapping_id: 7 })
    const out = await requestLspRgbDeposit({}, { lsp: client, lnInvoice: BOLT11, rgb })
    expect(out).toEqual({ lnInvoice: BOLT11, rgbInvoice: 'rgb:snake', mappingId: 7 })
  })

  it('mints an invoice via account.createInvoice when lnInvoice is omitted (string return)', async () => {
    const { client, fetch } = makeLspClient({ lnInvoice: BOLT11, rgbInvoice: 'rgb:abc', mappingId: 1 })
    const account = { createInvoice: jest.fn(async () => BOLT11) }
    const lnInvoiceRequest = { amtMsat: 1000 }

    await requestLspRgbDeposit(account, { lsp: client, lnInvoiceRequest, rgb })

    expect(account.createInvoice).toHaveBeenCalledWith(lnInvoiceRequest)
    expect(JSON.parse(fetch.mock.calls[0][1].body).ln_invoice).toBe(BOLT11)
  })

  it('mints via account.lnInvoice when createInvoice is absent (object return with .invoice)', async () => {
    const { client, fetch } = makeLspClient({ lnInvoice: BOLT11, rgbInvoice: 'rgb:abc', mappingId: 1 })
    const account = { lnInvoice: jest.fn(async () => ({ invoice: BOLT11 })) }

    await requestLspRgbDeposit(account, { lsp: client, lnInvoiceRequest: {}, rgb })

    expect(account.lnInvoice).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetch.mock.calls[0][1].body).ln_invoice).toBe(BOLT11)
  })

  it('throws when neither lnInvoice nor lnInvoiceRequest is provided', async () => {
    const { client } = makeLspClient({})
    const account = { createInvoice: jest.fn() }
    await expect(requestLspRgbDeposit(account, { lsp: client, rgb }))
      .rejects.toThrow('provide either args.lnInvoice or args.lnInvoiceRequest')
  })

  it('throws when the account minter returns no usable invoice', async () => {
    const { client } = makeLspClient({})
    const account = { createInvoice: jest.fn(async () => ({ noInvoiceHere: true })) }
    await expect(requestLspRgbDeposit(account, { lsp: client, lnInvoiceRequest: {}, rgb }))
      .rejects.toThrow('account invoice mint returned no invoice')
  })

  it('throws when the account exposes neither createInvoice nor lnInvoice', async () => {
    const { client } = makeLspClient({})
    const account = {}
    await expect(requestLspRgbDeposit(account, { lsp: client, lnInvoiceRequest: {}, rgb }))
      .rejects.toThrow('account must expose createInvoice or lnInvoice')
  })

  it('accepts a base-URL string and builds an LspClient driven by injected fetch', async () => {
    const fetch = jest.fn(async () => jsonResponse({ ln_invoice: BOLT11, rgb_invoice: 'rgb:built', mapping_id: 99 }))
    const account = {}
    const out = await requestLspRgbDeposit(account, {
      lsp: 'https://lsp.example',
      lnInvoice: BOLT11,
      rgb,
      lspOpts: { fetch }
    })

    expect(fetch).toHaveBeenCalledTimes(1)
    const [calledUrl, init] = fetch.mock.calls[0]
    expect(calledUrl).toBe('https://lsp.example/lightning_receive')
    expect(init.method).toBe('POST')
    expect(out).toEqual({ lnInvoice: BOLT11, rgbInvoice: 'rgb:built', mappingId: 99 })
  })

  it('accepts a pre-built LspClient instance', async () => {
    const fetch = jest.fn(async () => jsonResponse({ ln_invoice: BOLT11, rgb_invoice: 'rgb:inst', mapping_id: 5 }))
    const client = new LspClient({ baseUrl: 'https://lsp.example', fetch })
    const out = await requestLspRgbDeposit({}, { lsp: client, lnInvoice: BOLT11, rgb })
    expect(out.rgbInvoice).toBe('rgb:inst')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('throws when lsp is neither a client nor a non-empty base URL', async () => {
    await expect(requestLspRgbDeposit({}, { lsp: '', lnInvoice: BOLT11, rgb }))
      .rejects.toThrow('lsp must be an LspClient or a base URL string')
    await expect(requestLspRgbDeposit({}, { lsp: 123, lnInvoice: BOLT11, rgb }))
      .rejects.toThrow('lsp must be an LspClient or a base URL string')
  })
})

describe('payRgbViaLsp', () => {
  const ln = { amtMsat: 1000, expirySec: 3600 }

  it('throws when account is null or lacks sendPayment', async () => {
    await expect(payRgbViaLsp(null, { lsp: 'https://lsp.example', rgbInvoice: 'rgb:x', ln }))
      .rejects.toThrow('account.sendPayment required')
    await expect(payRgbViaLsp({}, { lsp: 'https://lsp.example', rgbInvoice: 'rgb:x', ln }))
      .rejects.toThrow('account.sendPayment required')
  })

  it('throws when rgbInvoice is missing or empty', async () => {
    const account = { sendPayment: jest.fn() }
    await expect(payRgbViaLsp(account, { lsp: 'https://lsp.example', rgbInvoice: '', ln }))
      .rejects.toThrow('rgbInvoice required')
    await expect(payRgbViaLsp(account, { lsp: 'https://lsp.example', rgbInvoice: 123, ln }))
      .rejects.toThrow('rgbInvoice required')
  })

  it('throws when ln params are missing', async () => {
    const account = { sendPayment: jest.fn() }
    await expect(payRgbViaLsp(account, { lsp: 'https://lsp.example', rgbInvoice: 'rgb:x' }))
      .rejects.toThrow('ln params required')
  })

  it('issues the BOLT11 via onchainSend then pays it, returning the DTO (camelCase)', async () => {
    const { client, fetch } = makeLspClient({ lnInvoice: BOLT11, rgbInvoice: 'rgb:out', mappingId: 11 })
    const account = { sendPayment: jest.fn(async () => ({ payment_hash: 'ph2' })) }

    const out = await payRgbViaLsp(account, { lsp: client, rgbInvoice: 'rgb:in', ln })

    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://lsp.example/onchain_send')
    expect(JSON.parse(init.body)).toMatchObject({ rgb_invoice: 'rgb:in' })
    expect(account.sendPayment).toHaveBeenCalledWith({ invoice: BOLT11 })
    expect(out).toEqual({
      lnInvoice: BOLT11,
      rgbInvoice: 'rgb:out',
      mappingId: 11,
      sendResult: { payment_hash: 'ph2' }
    })
  })

  it('falls back to snake_case fields from the onchainSend response', async () => {
    const { client } = makeLspClient({ ln_invoice: BOLT11, rgb_invoice: 'rgb:snk', mapping_id: 3 })
    const account = { sendPayment: jest.fn(async () => ({ ok: true })) }

    const out = await payRgbViaLsp(account, { lsp: client, rgbInvoice: 'rgb:in', ln })

    expect(out).toEqual({
      lnInvoice: BOLT11,
      rgbInvoice: 'rgb:snk',
      mappingId: 3,
      sendResult: { ok: true }
    })
  })

  it('drives a base-URL string + injected fetch through to sendPayment', async () => {
    const fetch = jest.fn(async () => jsonResponse({ ln_invoice: BOLT11, rgb_invoice: 'rgb:url', mapping_id: 8 }))
    const account = { sendPayment: jest.fn(async () => ({ done: true })) }

    const out = await payRgbViaLsp(account, {
      lsp: 'https://lsp.example',
      rgbInvoice: 'rgb:in',
      ln,
      lspOpts: { fetch }
    })

    const [calledUrl, init] = fetch.mock.calls[0]
    expect(calledUrl).toBe('https://lsp.example/onchain_send')
    expect(init.method).toBe('POST')
    expect(account.sendPayment).toHaveBeenCalledWith({ invoice: BOLT11 })
    expect(out.rgbInvoice).toBe('rgb:url')
    expect(out.sendResult).toEqual({ done: true })
  })
})
