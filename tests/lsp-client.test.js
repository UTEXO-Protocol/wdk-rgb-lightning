// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.

// Unit tests for the thin typed LSP HTTP wrapper. Every request is served
// by an injected `fetch` stub (opts.fetch) returning Response-like objects
// so no real network or native code is touched.

import { jest } from '@jest/globals'
import { LspError, LspClient } from '../src/lsp-client.js'

const BASE = 'https://lsp.utexo.io'

// Build a Response-like object. `text` defaults to a JSON serialization of
// `json` so callers can pass either.
function makeRes ({ ok = true, status = 200, json, text, headers } = {}) {
  const bodyText = text !== undefined
    ? text
    : (json !== undefined ? JSON.stringify(json) : '')
  return {
    ok,
    status,
    headers: headers ?? {},
    json: async () => (json !== undefined ? json : JSON.parse(bodyText)),
    text: async () => bodyText
  }
}

// A fetch stub that returns the given (single) response for every call.
function fetchReturning (res) {
  return jest.fn(async () => res)
}

function makeClient (overrides = {}) {
  const fetchImpl = overrides.fetch ?? fetchReturning(makeRes({ json: { ok: true } }))
  const client = new LspClient({ baseUrl: BASE, fetch: fetchImpl, ...overrides })
  return { client, fetchImpl }
}

describe('LspError', () => {
  it('formats a message with status + body for HTTP errors', () => {
    const err = new LspError('/health', 503, 'down')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('LspError')
    expect(err.endpoint).toBe('/health')
    expect(err.status).toBe(503)
    expect(err.body).toBe('down')
    expect(err.message).toBe('LSP /health → HTTP 503: down')
  })

  it('formats a transport-failure message (status 0) from the cause', () => {
    const cause = new Error('ECONNREFUSED')
    const err = new LspError('/get_info', 0, '', cause)
    expect(err.status).toBe(0)
    expect(err.message).toBe('LSP /get_info → ECONNREFUSED')
    expect(err.cause).toBe(cause)
  })

  it('falls back to "request failed" when the cause has no message', () => {
    const err = new LspError('/get_info', 0, '')
    expect(err.message).toBe('LSP /get_info → request failed')
  })

  it('parses a structured JSON error body into errorBody/errorCode/errorTag', () => {
    const body = JSON.stringify({ error: 'asset not allowed', code: 42, name: 'AssetDenied' })
    const err = new LspError('/onchain_send', 400, body)
    expect(err.errorBody).toEqual({ error: 'asset not allowed', code: 42, name: 'AssetDenied' })
    expect(err.errorCode).toBe(42)
    expect(err.errorTag).toBe('AssetDenied')
    // message is rewritten to the structured `error` string.
    expect(err.message).toBe('LSP /onchain_send → HTTP 400: asset not allowed')
  })

  it('accepts a string code in the structured body', () => {
    const body = JSON.stringify({ error: 'nope', code: 'E_NOPE' })
    const err = new LspError('/x', 400, body)
    expect(err.errorCode).toBe('E_NOPE')
    expect(err.errorTag).toBeNull()
  })

  it('leaves structured fields null for a non-JSON body', () => {
    const err = new LspError('/x', 500, 'plain text error')
    expect(err.errorBody).toBeNull()
    expect(err.errorCode).toBeNull()
    expect(err.errorTag).toBeNull()
  })

  it('tolerates a body that starts with { but is not valid JSON', () => {
    const err = new LspError('/x', 500, '{not json')
    expect(err.errorBody).toBeNull()
    expect(err.message).toBe('LSP /x → HTTP 500: {not json')
  })

  it('handles a JSON body without recognised fields', () => {
    const err = new LspError('/x', 400, JSON.stringify({ foo: 'bar' }))
    expect(err.errorBody).toEqual({ foo: 'bar' })
    expect(err.errorCode).toBeNull()
    expect(err.errorTag).toBeNull()
    // message stays the raw-body form since there was no `error` field.
    expect(err.message).toBe('LSP /x → HTTP 400: {"foo":"bar"}')
  })
})

describe('LspClient constructor', () => {
  it('throws when baseUrl is missing or empty', () => {
    expect(() => new LspClient({})).toThrow(/baseUrl is required/)
    expect(() => new LspClient({ baseUrl: '' })).toThrow(/baseUrl is required/)
    expect(() => new LspClient()).toThrow(/baseUrl is required/)
  })

  it('throws when no fetch is available', () => {
    const orig = globalThis.fetch
    // Remove global fetch so the fallback also fails.
    delete globalThis.fetch
    try {
      expect(() => new LspClient({ baseUrl: BASE })).toThrow(/no fetch available/)
    } finally {
      globalThis.fetch = orig
    }
  })

  it('uses globalThis.fetch when no override is supplied', () => {
    const orig = globalThis.fetch
    const g = jest.fn(async () => makeRes({ json: {} }))
    globalThis.fetch = g
    try {
      const client = new LspClient({ baseUrl: BASE })
      expect(client.baseUrl).toBe(BASE)
    } finally {
      globalThis.fetch = orig
    }
  })

  it('normalises a trailing slash off the baseUrl', () => {
    const { client } = makeClient({ baseUrl: 'https://lsp.utexo.io///' })
    expect(client.baseUrl).toBe('https://lsp.utexo.io')
  })

  it('rejects a baseUrl that is not a valid URL', () => {
    expect(() => new LspClient({ baseUrl: 'not a url', fetch: jest.fn() })).toThrow(/not a valid URL/)
  })

  it('rejects a non-http(s) protocol', () => {
    expect(() => new LspClient({ baseUrl: 'ftp://lsp.utexo.io', fetch: jest.fn() })).toThrow(/must use http: or https:/)
  })

  it('rejects plain http on a non-loopback host by default', () => {
    expect(() => new LspClient({ baseUrl: 'http://example.com', fetch: jest.fn() }))
      .toThrow(/plain http:\/\/ is only allowed for loopback/)
  })

  it('allows plain http on a loopback host', () => {
    const client = new LspClient({ baseUrl: 'http://localhost:3000', fetch: jest.fn() })
    expect(client.baseUrl).toBe('http://localhost:3000')
  })

  it('allows plain http on a non-loopback host when allowHttp is set', () => {
    const client = new LspClient({ baseUrl: 'http://staging.local', fetch: jest.fn(), allowHttp: true })
    expect(client.baseUrl).toBe('http://staging.local')
  })

  it('clamps a non-finite maxRetries to the default', () => {
    const { client } = makeClient({ maxRetries: Number.NaN })
    expect(client._maxRetries).toBe(3)
  })

  it('floors a negative maxRetries to 0 and truncates fractions', () => {
    expect(makeClient({ maxRetries: -5 }).client._maxRetries).toBe(0)
    expect(makeClient({ maxRetries: 2.9 }).client._maxRetries).toBe(2)
  })

  it('clamps a bogus timeoutMs to the default', () => {
    expect(makeClient({ timeoutMs: 0 }).client._timeoutMs).toBe(15000)
    expect(makeClient({ timeoutMs: 'x' }).client._timeoutMs).toBe(15000)
  })

  it('copies defaultHeaders defensively', () => {
    const headers = { Authorization: 'Bearer tok' }
    const { client } = makeClient({ defaultHeaders: headers })
    headers.Authorization = 'mutated'
    expect(client._headers).toEqual({ Authorization: 'Bearer tok' })
  })
})

describe('GET endpoint methods', () => {
  it('health() issues GET /health and returns parsed JSON', async () => {
    const { client, fetchImpl } = makeClient({ fetch: fetchReturning(makeRes({ json: { status: 'ok' } })) })
    const out = await client.health()
    expect(out).toEqual({ status: 'ok' })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://lsp.utexo.io/health')
    expect(init.method).toBe('GET')
    expect(init.headers.Accept).toBe('application/json')
    // No body / Content-Type on a GET.
    expect(init.body).toBeUndefined()
    expect(init.headers['Content-Type']).toBeUndefined()
  })

  it('getInfo() issues GET /get_info', async () => {
    const { client, fetchImpl } = makeClient({ fetch: fetchReturning(makeRes({ json: { pubkey: 'abc' } })) })
    expect(await client.getInfo()).toEqual({ pubkey: 'abc' })
    expect(fetchImpl.mock.calls[0][0]).toBe('https://lsp.utexo.io/get_info')
  })

  it('merges defaultHeaders (e.g. a Bearer token) into every request', async () => {
    const { client, fetchImpl } = makeClient({ defaultHeaders: { Authorization: 'Bearer tok' } })
    await client.health()
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer tok')
  })

  it('lnurlDiscovery() encodes the username into the well-known path', async () => {
    const { client, fetchImpl } = makeClient({ fetch: fetchReturning(makeRes({ json: { callback: 'x' } })) })
    await client.lnurlDiscovery('al ice')
    expect(fetchImpl.mock.calls[0][0]).toBe('https://lsp.utexo.io/.well-known/lnurlp/al%20ice')
  })

  it('lnurlDiscovery() requires a username', () => {
    const { client } = makeClient()
    expect(() => client.lnurlDiscovery('')).toThrow(/username required/)
    expect(() => client.lnurlDiscovery()).toThrow(/username required/)
  })

  it('lnurlCallback() builds the amount query and encodes the username', async () => {
    const { client, fetchImpl } = makeClient({ fetch: fetchReturning(makeRes({ json: { pr: 'lnbc' } })) })
    await client.lnurlCallback('alice', 1000)
    expect(fetchImpl.mock.calls[0][0]).toBe('https://lsp.utexo.io/pay/callback/alice?amount=1000')
  })

  it('lnurlCallback() forwards optional asset_id / asset_amount', async () => {
    const { client, fetchImpl } = makeClient({ fetch: fetchReturning(makeRes({ json: {} })) })
    await client.lnurlCallback('alice', 5000n, { assetId: 'rgb:asset', assetAmount: 7 })
    const url = fetchImpl.mock.calls[0][0]
    expect(url).toContain('amount=5000')
    expect(url).toContain('asset_id=rgb%3Aasset')
    expect(url).toContain('asset_amount=7')
  })

  it('lnurlCallback() requires a username', () => {
    const { client } = makeClient()
    expect(() => client.lnurlCallback('', 1)).toThrow(/username required/)
  })

  it('lnurlCallback() rejects a non-integer amount', () => {
    const { client } = makeClient()
    expect(() => client.lnurlCallback('alice', -1)).toThrow(/non-negative integer/)
    expect(() => client.lnurlCallback('alice', 'abc')).toThrow(/non-negative integer/)
  })

  it('getLightningAddressByPubkey() trims and encodes the pubkey', async () => {
    const { client, fetchImpl } = makeClient({ fetch: fetchReturning(makeRes({ json: { username: 'u', domain: 'd' } })) })
    const out = await client.getLightningAddressByPubkey('  02abc  ')
    expect(out).toEqual({ username: 'u', domain: 'd' })
    expect(fetchImpl.mock.calls[0][0]).toBe('https://lsp.utexo.io/lightning_address/by_pubkey/02abc')
  })

  it('getLightningAddressByPubkey() requires a non-empty pubkey', () => {
    const { client } = makeClient()
    expect(() => client.getLightningAddressByPubkey('   ')).toThrow(/peerPubkey required/)
    expect(() => client.getLightningAddressByPubkey(123)).toThrow(/peerPubkey required/)
  })
})

describe('resolveAddress', () => {
  it('requires a username', async () => {
    const { client } = makeClient()
    await expect(client.resolveAddress('', 1000)).rejects.toThrow(/username required/)
  })

  it('discovers the callback then fetches the invoice in one call', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(makeRes({ json: { callback: 'https://lsp.utexo.io/pay/callback/alice' } }))
      .mockResolvedValueOnce(makeRes({ json: { pr: 'lnbc1', routes: [] } }))
    const { client } = makeClient({ fetch: fetchImpl })
    const out = await client.resolveAddress('alice', 2500, { assetId: 'rgb:a', assetAmount: 3 })
    expect(out).toEqual({ pr: 'lnbc1', routes: [] })
    expect(fetchImpl.mock.calls[0][0]).toBe('https://lsp.utexo.io/.well-known/lnurlp/alice')
    const cbUrl = fetchImpl.mock.calls[1][0]
    expect(cbUrl).toContain('https://lsp.utexo.io/pay/callback/alice?')
    expect(cbUrl).toContain('amount=2500')
    expect(cbUrl).toContain('asset_id=rgb%3Aa')
    expect(cbUrl).toContain('asset_amount=3')
  })

  it('rewrites an internal/emulator callback host onto the baseUrl origin', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(makeRes({ json: { callback: 'http://10.0.2.2:9000/pay/callback/bob' } }))
      .mockResolvedValueOnce(makeRes({ json: { pr: 'lnbc2' } }))
    const { client } = makeClient({ fetch: fetchImpl })
    await client.resolveAddress('bob', 100)
    // second hop is rewritten to the client's own origin.
    expect(fetchImpl.mock.calls[1][0]).toBe('https://lsp.utexo.io/pay/callback/bob?amount=100')
  })

  it('appends with & when the callback already has a query string', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(makeRes({ json: { callback: 'https://lsp.utexo.io/pay/callback/x?nonce=1' } }))
      .mockResolvedValueOnce(makeRes({ json: { pr: 'lnbc3' } }))
    const { client } = makeClient({ fetch: fetchImpl })
    await client.resolveAddress('x', 100)
    const url = fetchImpl.mock.calls[1][0]
    expect(url).toContain('nonce=1&amount=100')
  })

  it('throws an LspError when the discovery response lacks a callback', async () => {
    const fetchImpl = fetchReturning(makeRes({ json: { other: true } }))
    const { client } = makeClient({ fetch: fetchImpl })
    await expect(client.resolveAddress('alice', 100)).rejects.toThrow(/missing callback in LNURL response/)
  })
})

describe('POST endpoint methods', () => {
  it('onchainSend() posts the snake_cased body and camel-cases the response', async () => {
    const fetchImpl = fetchReturning(makeRes({
      json: { rgb_invoice: 'rgb:x', ln_invoice: 'lnbc', mapping_id: 9 }
    }))
    const { client } = makeClient({ fetch: fetchImpl })
    const out = await client.onchainSend({
      rgbInvoice: 'rgb:x',
      ln: {
        amtMsat: 1000n,
        expirySec: 3600,
        assetId: 'rgb:a',
        assetAmount: 5,
        descriptionHash: 'dh',
        paymentHash: 'ph',
        minFinalCltvExpiryDelta: 40
      }
    })
    expect(out).toEqual({
      rgb_invoice: 'rgb:x',
      ln_invoice: 'lnbc',
      mapping_id: 9,
      rgbInvoice: 'rgb:x',
      lnInvoice: 'lnbc',
      mappingId: 9
    })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://lsp.utexo.io/onchain_send')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    const body = JSON.parse(init.body)
    expect(body).toEqual({
      rgb_invoice: 'rgb:x',
      lninvoice: {
        amt_msat: 1000,
        expiry_sec: 3600,
        asset_id: 'rgb:a',
        asset_amount: 5,
        description_hash: 'dh',
        payment_hash: 'ph',
        min_final_cltv_expiry_delta: 40
      }
    })
  })

  it('onchainSend() requires rgbInvoice and ln params', async () => {
    const { client } = makeClient()
    await expect(client.onchainSend({})).rejects.toThrow(/rgbInvoice required/)
    await expect(client.onchainSend({ rgbInvoice: 'rgb:x' })).rejects.toThrow(/ln params required/)
  })

  it('lightningReceive() posts snake_cased rgb params with defaults', async () => {
    const fetchImpl = fetchReturning(makeRes({
      json: { ln_invoice: 'lnbc', rgb_invoice: 'rgb:y', mapping_id: 3 }
    }))
    const { client } = makeClient({ fetch: fetchImpl })
    const out = await client.lightningReceive({
      lnInvoice: 'lnbc',
      rgb: { assetId: 'rgb:a' }
    })
    expect(out).toMatchObject({ lnInvoice: 'lnbc', rgbInvoice: 'rgb:y', mappingId: 3 })
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(body).toEqual({
      ln_invoice: 'lnbc',
      rgb_invoice: { asset_id: 'rgb:a', min_confirmations: 1, witness: false }
    })
  })

  it('lightningReceive() forwards optional rgb fields', async () => {
    const fetchImpl = fetchReturning(makeRes({ json: {} }))
    const { client } = makeClient({ fetch: fetchImpl })
    await client.lightningReceive({
      lnInvoice: 'lnbc',
      rgb: { assetId: 'rgb:a', assignment: 'Any', durationSeconds: 600, minConfirmations: 2, witness: true }
    })
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(body.rgb_invoice).toEqual({
      asset_id: 'rgb:a',
      min_confirmations: 2,
      witness: true,
      assignment: 'Any',
      duration_seconds: 600
    })
  })

  it('lightningReceive() validates lnInvoice and rgb params', async () => {
    const { client } = makeClient()
    await expect(client.lightningReceive({})).rejects.toThrow(/lnInvoice required/)
    await expect(client.lightningReceive({ lnInvoice: 'lnbc' })).rejects.toThrow(/rgb params required/)
    await expect(client.lightningReceive({ lnInvoice: 'lnbc', rgb: {} })).rejects.toThrow(/rgb.assetId required/)
  })
})

describe('_req error and edge handling', () => {
  it('returns null for an empty (204-style) ok body', async () => {
    const { client } = makeClient({ fetch: fetchReturning(makeRes({ ok: true, status: 204, text: '' })) })
    expect(await client.health()).toBeNull()
  })

  it('throws an LspError carrying status + trimmed body on a non-ok response', async () => {
    const { client } = makeClient({
      fetch: fetchReturning(makeRes({ ok: false, status: 400, text: '  bad request  ' }))
    })
    await expect(client.health()).rejects.toMatchObject({
      name: 'LspError',
      status: 400,
      endpoint: '/health',
      body: 'bad request'
    })
  })

  it('throws an LspError when the ok body is not valid JSON', async () => {
    const { client } = makeClient({ fetch: fetchReturning(makeRes({ ok: true, status: 200, text: '<html>' })) })
    await expect(client.health()).rejects.toMatchObject({
      name: 'LspError',
      status: 200,
      body: 'invalid JSON: <html>'
    })
  })

  it('rejects a response larger than the 1 MiB cap', async () => {
    const huge = 'a'.repeat((1 << 20) + 1)
    const { client } = makeClient({ fetch: fetchReturning(makeRes({ ok: true, status: 200, text: huge })) })
    await expect(client.health()).rejects.toThrow(/response too large/)
  })

  it('wraps a transport-level fetch rejection in an LspError with status 0', async () => {
    const cause = new Error('ECONNRESET')
    const fetchImpl = jest.fn(async () => { throw cause })
    // disable retries so it fails fast.
    const { client } = makeClient({ fetch: fetchImpl, maxRetries: 0 })
    await expect(client.health()).rejects.toMatchObject({ name: 'LspError', status: 0 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('honours a per-call timeoutMs override (no throw, request still issued)', async () => {
    const { client, fetchImpl } = makeClient({ fetch: fetchReturning(makeRes({ json: {} })) })
    await client.getInfo({ timeoutMs: 2000 })
    expect(fetchImpl.mock.calls[0][1].signal).toBeDefined()
  })
})

describe('_req retry behaviour', () => {
  it('retries idempotent GETs on a retryable 503 then succeeds', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(makeRes({ ok: false, status: 503, text: 'unavailable' }))
      .mockResolvedValueOnce(makeRes({ json: { status: 'ok' } }))
    const { client } = makeClient({ fetch: fetchImpl, maxRetries: 3 })
    const out = await client.health()
    expect(out).toEqual({ status: 'ok' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('retries on a transport error then succeeds', async () => {
    const fetchImpl = jest.fn()
      .mockRejectedValueOnce(new Error('ETIMEDOUT'))
      .mockResolvedValueOnce(makeRes({ json: { ok: true } }))
    const { client } = makeClient({ fetch: fetchImpl, maxRetries: 2 })
    await client.health()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('gives up after exhausting the retry budget and throws the last status', async () => {
    const fetchImpl = jest.fn(async () => makeRes({ ok: false, status: 502, text: 'bad gateway' }))
    const { client } = makeClient({ fetch: fetchImpl, maxRetries: 2 })
    await expect(client.health()).rejects.toMatchObject({ status: 502 })
    // original + 2 retries = 3 calls.
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('does not retry a non-retryable status (e.g. 404)', async () => {
    const fetchImpl = jest.fn(async () => makeRes({ ok: false, status: 404, text: 'not found' }))
    const { client } = makeClient({ fetch: fetchImpl, maxRetries: 3 })
    await expect(client.health()).rejects.toMatchObject({ status: 404 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('does not retry POST methods even on a retryable status', async () => {
    const fetchImpl = jest.fn(async () => makeRes({ ok: false, status: 503, text: 'unavailable' }))
    const { client } = makeClient({ fetch: fetchImpl, maxRetries: 3 })
    await expect(client.onchainSend({ rgbInvoice: 'rgb:x', ln: { amtMsat: 1 } })).rejects.toMatchObject({ status: 503 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('_rewriteCallbackToPath', () => {
  it('reduces an absolute URL to path+search+hash', () => {
    const { client } = makeClient()
    expect(client._rewriteCallbackToPath('https://other.example/pay/cb?x=1#frag')).toBe('/pay/cb?x=1#frag')
  })

  it('resolves a relative path against the baseUrl', () => {
    const { client } = makeClient()
    expect(client._rewriteCallbackToPath('/pay/cb')).toBe('/pay/cb')
  })

  it('falls back to a leading-slash-prefixed string when parsing throws', () => {
    const { client } = makeClient()
    // Force `new URL(...)` to throw by stubbing the base to an unparseable value.
    client._base = '::::'
    expect(client._rewriteCallbackToPath('pay/cb')).toBe('/pay/cb')
    expect(client._rewriteCallbackToPath('/already')).toBe('/already')
  })
})

describe('numeric coercion edge cases (via public API)', () => {
  it('accepts a large bigint amount as a string in the LN body', async () => {
    const fetchImpl = fetchReturning(makeRes({ json: {} }))
    const { client } = makeClient({ fetch: fetchImpl })
    const big = BigInt(Number.MAX_SAFE_INTEGER) + 10n
    await client.onchainSend({ rgbInvoice: 'rgb:x', ln: { amtMsat: big } })
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(body.lninvoice.amt_msat).toBe(big.toString())
  })

  it('accepts a numeric-string amount in lnurlCallback', async () => {
    const { client, fetchImpl } = makeClient({ fetch: fetchReturning(makeRes({ json: {} })) })
    await client.lnurlCallback('alice', '1234')
    expect(fetchImpl.mock.calls[0][0]).toContain('amount=1234')
  })

  it('rejects a negative bigint amount', async () => {
    const { client } = makeClient()
    await expect(client.onchainSend({ rgbInvoice: 'rgb:x', ln: { amtMsat: -1n } }))
      .rejects.toThrow(/must be ≥ 0/)
  })

  it('rejects a uint32 field that overflows', async () => {
    const { client } = makeClient()
    await expect(client.onchainSend({ rgbInvoice: 'rgb:x', ln: { expirySec: 0x1ffffffff } }))
      .rejects.toThrow(/must fit in uint32/)
  })

  it('passes a numeric-string amtMsat through unchanged (uint64 string path)', async () => {
    const fetchImpl = fetchReturning(makeRes({ json: {} }))
    const { client } = makeClient({ fetch: fetchImpl })
    await client.onchainSend({ rgbInvoice: 'rgb:x', ln: { amtMsat: '987654321' } })
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(body.lninvoice.amt_msat).toBe('987654321')
  })

  it('rejects a non-numeric-string amtMsat', async () => {
    const { client } = makeClient()
    await expect(client.onchainSend({ rgbInvoice: 'rgb:x', ln: { amtMsat: 'oops' } }))
      .rejects.toThrow(/must be a non-negative integer/)
  })
})

describe('_timeoutSignal', () => {
  it('returns an AbortSignal from AbortSignal.timeout when available', () => {
    const { client } = makeClient()
    const sig = client._timeoutSignal(1000)
    expect(sig).toBeInstanceOf(AbortSignal)
  })

  it('falls back to an AbortController when AbortSignal.timeout is missing', () => {
    const orig = AbortSignal.timeout
    // Force the fallback branch.
    AbortSignal.timeout = undefined
    try {
      const { client } = makeClient()
      const sig = client._timeoutSignal(1000)
      expect(sig).toBeInstanceOf(AbortSignal)
    } finally {
      AbortSignal.timeout = orig
    }
  })

  it('uses the constructor timeout when given a non-positive override', () => {
    const { client } = makeClient({ timeoutMs: 5000 })
    const sig = client._timeoutSignal(0)
    expect(sig).toBeInstanceOf(AbortSignal)
  })
})
