// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.

// Unit tests for the generic LUD-06 / Lightning-Address client. Pure
// module — no node or binding. Network access is mocked via an injected
// `opts.fetch` returning fake Response-like objects.

import { jest } from '@jest/globals'
import {
  LnurlPayError,
  parseLightningAddress,
  fetchDiscovery,
  resolveAddressToInvoice
} from '../src/lnurl-pay.js'

// A minimal Response-like stub. `body` is serialized to JSON unless a raw
// string is supplied, so we can also exercise the invalid-JSON path.
function makeResponse ({ ok = true, status = 200, body = {}, raw } = {}) {
  const text = raw !== undefined ? raw : JSON.stringify(body)
  return { ok, status, text: async () => text }
}

// A valid LUD-06 discovery document used as the happy-path baseline.
function discoveryDoc (overrides = {}) {
  return {
    tag: 'payRequest',
    callback: 'https://b.com/lnurlp/cb',
    minSendable: 1000,
    maxSendable: 100000,
    metadata: '[["text/plain","pay alice"]]',
    ...overrides
  }
}

describe('LnurlPayError', () => {
  it('defaults status/body and exposes a stable name', () => {
    const err = new LnurlPayError('boom')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('LnurlPayError')
    expect(err.message).toBe('boom')
    expect(err.status).toBe(0)
    expect(err.body).toBe('')
    expect(err.cause).toBeUndefined()
  })

  it('carries status, body and cause when provided', () => {
    const cause = new Error('root')
    const err = new LnurlPayError('http', { status: 502, body: 'bad gateway', cause })
    expect(err.status).toBe(502)
    expect(err.body).toBe('bad gateway')
    expect(err.cause).toBe(cause)
  })
})

describe('parseLightningAddress', () => {
  it('parses a canonical user@host and builds the https discovery URL', () => {
    const out = parseLightningAddress('Alice@GetAlby.com')
    expect(out).toEqual({
      username: 'alice',
      host: 'getalby.com',
      discoveryUrl: 'https://getalby.com/.well-known/lnurlp/alice'
    })
  })

  it('percent-encodes the local-part in the discovery URL', () => {
    const out = parseLightningAddress('a.b+c@host.com')
    expect(out.username).toBe('a.b+c')
    expect(out.discoveryUrl).toBe('https://host.com/.well-known/lnurlp/a.b%2Bc')
  })

  it('uses the last @ so the local-part may not contain one', () => {
    // Only the final @ splits; everything before must still be a valid
    // local-part, so an embedded @ makes the local-part invalid.
    expect(() => parseLightningAddress('a@b@host.com')).toThrow(LnurlPayError)
  })

  it('auto-allows http for localhost / loopback / .local hosts', () => {
    expect(parseLightningAddress('bob@localhost').discoveryUrl)
      .toBe('http://localhost/.well-known/lnurlp/bob')
    expect(parseLightningAddress('bob@127.0.0.1:3000').discoveryUrl)
      .toBe('http://127.0.0.1:3000/.well-known/lnurlp/bob')
    expect(parseLightningAddress('bob@[::1]:8080').discoveryUrl)
      .toBe('http://[::1]:8080/.well-known/lnurlp/bob')
    expect(parseLightningAddress('bob@node.local').discoveryUrl)
      .toBe('http://node.local/.well-known/lnurlp/bob')
    expect(parseLightningAddress('bob@dev.localhost').discoveryUrl)
      .toBe('http://dev.localhost/.well-known/lnurlp/bob')
  })

  it('uses http for .onion hosts regardless of allowHttp', () => {
    expect(parseLightningAddress('bob@abc.onion').discoveryUrl)
      .toBe('http://abc.onion/.well-known/lnurlp/bob')
  })

  it('uses http for a normal host only when allowHttp is true', () => {
    expect(parseLightningAddress('bob@example.com', { allowHttp: true }).discoveryUrl)
      .toBe('http://example.com/.well-known/lnurlp/bob')
    expect(parseLightningAddress('bob@example.com', { allowHttp: false }).discoveryUrl)
      .toBe('https://example.com/.well-known/lnurlp/bob')
  })

  it('throws when the address is missing or not a string', () => {
    expect(() => parseLightningAddress('')).toThrow(LnurlPayError)
    expect(() => parseLightningAddress(undefined)).toThrow(/address required/)
    expect(() => parseLightningAddress(42)).toThrow(LnurlPayError)
  })

  it('throws on a missing @, a leading @, or a trailing @', () => {
    expect(() => parseLightningAddress('nohost')).toThrow(/malformed address/)
    expect(() => parseLightningAddress('@host.com')).toThrow(/malformed address/)
    expect(() => parseLightningAddress('user@')).toThrow(/malformed address/)
  })

  it('throws on an invalid local-part', () => {
    expect(() => parseLightningAddress('a b@host.com')).toThrow(/invalid local-part/)
  })

  it('throws on an invalid host', () => {
    expect(() => parseLightningAddress('user@ho st.com')).toThrow(/invalid host/)
  })
})

describe('fetchDiscovery', () => {
  it('requests the derived well-known URL with an Accept header and returns parsed params', async () => {
    const fetch = jest.fn(async () => makeResponse({ body: discoveryDoc() }))
    const out = await fetchDiscovery('alice@getalby.com', { fetch })
    expect(out).toEqual(discoveryDoc())
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://getalby.com/.well-known/lnurlp/alice')
    expect(init.headers).toEqual({ Accept: 'application/json' })
    expect(init.signal === undefined || typeof init.signal === 'object').toBe(true)
  })

  it('passes a full http(s) URL straight through without parsing it as an address', async () => {
    const fetch = jest.fn(async () => makeResponse({ body: discoveryDoc() }))
    const url = 'https://lsp.example/.well-known/lnurlp/carol'
    await fetchDiscovery(url, { fetch })
    expect(fetch.mock.calls[0][0]).toBe(url)
  })

  it('rejects malformed and disallowed plain-HTTP discovery URLs before fetching', async () => {
    const fetch = jest.fn()
    await expect(fetchDiscovery('http://[invalid', { fetch })).rejects.toThrow(/invalid discovery URL/)
    await expect(fetchDiscovery('http://public.example/lnurlp/alice', { fetch }))
      .rejects.toThrow(/plain HTTP discovery is not allowed/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('throws when no usable fetch is available', async () => {
    // `opts.fetch ?? globalThis.fetch` only falls back on null/undefined,
    // so a non-function value reaches the typeof guard.
    await expect(fetchDiscovery('a@b.com', { fetch: 'not-a-fn' }))
      .rejects.toThrow(/no global fetch/)
  })

  it('wraps a thrown fetch transport error with a cause', async () => {
    const cause = new Error('ECONNREFUSED')
    const fetch = jest.fn(async () => { throw cause })
    const err = await fetchDiscovery('a@b.com', { fetch }).catch((e) => e)
    expect(err).toBeInstanceOf(LnurlPayError)
    expect(err.message).toMatch(/fetch failed/)
    expect(err.cause).toBe(cause)
  })

  it('throws with status + body on a non-ok HTTP response', async () => {
    const fetch = jest.fn(async () => makeResponse({ ok: false, status: 404, raw: '  not found  ' }))
    const err = await fetchDiscovery('a@b.com', { fetch }).catch((e) => e)
    expect(err).toBeInstanceOf(LnurlPayError)
    expect(err.status).toBe(404)
    expect(err.body).toBe('not found')
    expect(err.message).toMatch(/HTTP 404/)
  })

  it('throws when the body is not valid JSON', async () => {
    const fetch = jest.fn(async () => makeResponse({ raw: 'not-json{' }))
    await expect(fetchDiscovery('a@b.com', { fetch })).rejects.toThrow(/invalid JSON/)
  })

  it('throws when discovery is not an object', async () => {
    const fetch = jest.fn(async () => makeResponse({ raw: 'null' }))
    await expect(fetchDiscovery('a@b.com', { fetch })).rejects.toThrow(/is not an object/)
  })

  it('throws when the server returns status=ERROR', async () => {
    const fetch = jest.fn(async () => makeResponse({ body: { status: 'ERROR', reason: 'blocked' } }))
    await expect(fetchDiscovery('a@b.com', { fetch })).rejects.toThrow(/discovery rejected: blocked/)
  })

  it('throws when the status=ERROR document omits a reason', async () => {
    const fetch = jest.fn(async () => makeResponse({ body: { status: 'ERROR' } }))
    await expect(fetchDiscovery('a@b.com', { fetch })).rejects.toThrow(/no reason/)
  })

  it('throws when the tag is not payRequest', async () => {
    const fetch = jest.fn(async () => makeResponse({ body: discoveryDoc({ tag: 'withdrawRequest' }) }))
    await expect(fetchDiscovery('a@b.com', { fetch })).rejects.toThrow(/expected tag='payRequest'/)
  })

  it('throws when the callback is not an http(s) URL', async () => {
    const fetch = jest.fn(async () => makeResponse({ body: discoveryDoc({ callback: 'ftp://x' }) }))
    await expect(fetchDiscovery('a@b.com', { fetch })).rejects.toThrow(/invalid callback/)

    const malformed = jest.fn(async () => makeResponse({ body: discoveryDoc({ callback: 'https://[invalid' }) }))
    await expect(fetchDiscovery('a@b.com', { fetch: malformed })).rejects.toThrow(/invalid callback/)
  })

  it('throws when the sendable range is missing, inverted, or non-positive', async () => {
    const cases = [
      { minSendable: undefined },
      { minSendable: 5000, maxSendable: 1000 },
      { minSendable: 0 }
    ]
    for (const overrides of cases) {
      const fetch = jest.fn(async () => makeResponse({ body: discoveryDoc(overrides) }))
      await expect(fetchDiscovery('a@b.com', { fetch })).rejects.toThrow(/invalid sendable range/)
    }
  })

  it('rejects minSendable=0 but accepts minSendable=1 (min <= 0 boundary)', async () => {
    const zeroFetch = jest.fn(async () => makeResponse({ body: discoveryDoc({ minSendable: 0 }) }))
    await expect(fetchDiscovery('a@b.com', { fetch: zeroFetch }))
      .rejects.toThrow(/invalid sendable range min=0 max=100000/)

    const oneFetch = jest.fn(async () => makeResponse({ body: discoveryDoc({ minSendable: 1 }) }))
    await expect(fetchDiscovery('a@b.com', { fetch: oneFetch }))
      .resolves.toMatchObject({ minSendable: 1 })
  })

  it('accepts numeric sendable bounds passed as strings', async () => {
    const fetch = jest.fn(async () => makeResponse({
      body: discoveryDoc({ minSendable: '1000', maxSendable: '5000' })
    }))
    await expect(fetchDiscovery('a@b.com', { fetch })).resolves.toMatchObject({ tag: 'payRequest' })
  })

  it('wraps fractional sendable bounds as LnurlPayError instead of leaking RangeError', async () => {
    const fetch = jest.fn(async () => makeResponse({
      body: discoveryDoc({ minSendable: 1000.5 })
    }))
    const error = await fetchDiscovery('a@b.com', { fetch }).catch((cause) => cause)
    expect(error).toBeInstanceOf(LnurlPayError)
    expect(error).not.toBeInstanceOf(RangeError)
    expect(error.message).toMatch(/invalid sendable range/)
    expect(error.cause).toBeInstanceOf(TypeError)
  })

  it('throws when metadata is not a string', async () => {
    const fetch = jest.fn(async () => makeResponse({ body: discoveryDoc({ metadata: 123 }) }))
    await expect(fetchDiscovery('a@b.com', { fetch })).rejects.toThrow(/missing metadata string/)
  })
})

describe('resolveAddressToInvoice', () => {
  // Build a two-call fetch: first call -> discovery, second -> callback.
  function twoStepFetch (discovery, callbackResp) {
    let n = 0
    return jest.fn(async () => {
      n += 1
      return n === 1 ? makeResponse({ body: discovery }) : makeResponse({ body: callbackResp })
    })
  }

  it('resolves an in-range amount to the bolt11 invoice plus context', async () => {
    const discovery = discoveryDoc()
    const fetch = twoStepFetch(discovery, { pr: 'lnbc1...', routes: [{ a: 1 }] })
    const out = await resolveAddressToInvoice('alice@b.com', 5000n, { fetch })
    expect(out.pr).toBe('lnbc1...')
    expect(out.routes).toEqual([{ a: 1 }])
    expect(out.discovery).toEqual(discovery)
    expect(out.callbackUrl).toBe('https://b.com/lnurlp/cb?amount=5000')
    // discovery + callback = exactly two fetches.
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[1][0]).toBe('https://b.com/lnurlp/cb?amount=5000')
  })

  it('defaults routes to an empty array when the callback omits them', async () => {
    const fetch = twoStepFetch(discoveryDoc(), { pr: 'lnbc1...' })
    const out = await resolveAddressToInvoice('a@b.com', 5000, { fetch })
    expect(out.routes).toEqual([])
  })

  it('rejects a fractional numeric amount instead of silently truncating it', async () => {
    const fetch = twoStepFetch(discoveryDoc(), { pr: 'lnbc1...' })
    await expect(resolveAddressToInvoice('a@b.com', 4999.9, { fetch }))
      .rejects.toBeInstanceOf(LnurlPayError)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('accepts an integer string amount', async () => {
    const fetch = twoStepFetch(discoveryDoc(), { pr: 'lnbc1...' })
    const out = await resolveAddressToInvoice('a@b.com', '2500', { fetch })
    expect(out.callbackUrl).toBe('https://b.com/lnurlp/cb?amount=2500')
  })

  it('rejects a callback on a different host before making the second request', async () => {
    const fetch = twoStepFetch(
      discoveryDoc({ callback: 'https://attacker.example/collect' }),
      { pr: 'must-not-be-reached' }
    )
    await expect(resolveAddressToInvoice('a@b.com', 2500, { fetch }))
      .rejects.toThrow(/callback host .* does not match discovery host/)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('rejects a plain-HTTP callback on a public host', async () => {
    const fetch = twoStepFetch(
      discoveryDoc({ callback: 'http://b.com/cb' }),
      { pr: 'must-not-be-reached' }
    )
    await expect(resolveAddressToInvoice('a@b.com', 2500, { fetch }))
      .rejects.toThrow(/disallowed plain HTTP/)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('allows an explicitly opted-in cross-host callback for delegated services', async () => {
    const fetch = twoStepFetch(
      discoveryDoc({ callback: 'https://delegate.example/cb' }),
      { pr: 'lnbc-delegated' }
    )
    const out = await resolveAddressToInvoice('a@b.com', 2500, {
      fetch,
      allowCrossHostCallback: true
    })
    expect(out.pr).toBe('lnbc-delegated')
    expect(out.callbackUrl).toBe('https://delegate.example/cb?amount=2500')
  })

  it('forwards validated RGB extension parameters through the shared resolver', async () => {
    const fetch = twoStepFetch(discoveryDoc(), { pr: 'lnbc-rgb' })
    const out = await resolveAddressToInvoice('a@b.com', 2500, {
      fetch,
      assetId: 'rgb:asset',
      assetAmount: 7n
    })
    expect(out.callbackUrl).toBe('https://b.com/lnurlp/cb?amount=2500&asset_id=rgb%3Aasset&asset_amount=7')
  })

  it('appends a LUD-12 comment with & when the callback already has a query', async () => {
    const discovery = discoveryDoc({ callback: 'https://b.com/cb?token=xyz' })
    const fetch = twoStepFetch(discovery, { pr: 'lnbc1...' })
    const out = await resolveAddressToInvoice('a@b.com', 5000, { fetch, comment: 'hi there' })
    expect(out.callbackUrl).toBe('https://b.com/cb?token=xyz&amount=5000&comment=hi+there')
  })

  it('uses ? for the first param and & between params when the callback has no query', async () => {
    const fetch = twoStepFetch(discoveryDoc(), { pr: 'lnbc1...' })
    const out = await resolveAddressToInvoice('a@b.com', 5000, { fetch, comment: 'hi there' })
    expect(out.callbackUrl).toBe('https://b.com/lnurlp/cb?amount=5000&comment=hi+there')
    expect(fetch.mock.calls[1][0]).toBe('https://b.com/lnurlp/cb?amount=5000&comment=hi+there')
  })

  it('omits the comment param entirely when no comment is supplied', async () => {
    const fetch = twoStepFetch(discoveryDoc(), { pr: 'lnbc1...' })
    const out = await resolveAddressToInvoice('a@b.com', 5000, { fetch })
    expect(out.callbackUrl).toBe('https://b.com/lnurlp/cb?amount=5000')
    expect(out.callbackUrl).not.toContain('comment')
  })

  it('throws when no usable fetch is available', async () => {
    await expect(resolveAddressToInvoice('a@b.com', 1000, { fetch: 'not-a-fn' }))
      .rejects.toThrow(/no global fetch/)
  })

  it('throws when the amount is below the server minimum', async () => {
    const fetch = twoStepFetch(discoveryDoc(), { pr: 'lnbc1...' })
    await expect(resolveAddressToInvoice('a@b.com', 500, { fetch }))
      .rejects.toThrow(/outside server range/)
    // Only discovery is fetched; the out-of-range guard short-circuits.
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('throws when the amount is above the server maximum', async () => {
    const fetch = twoStepFetch(discoveryDoc(), { pr: 'lnbc1...' })
    await expect(resolveAddressToInvoice('a@b.com', 999999, { fetch }))
      .rejects.toThrow(/outside server range/)
  })

  it('accepts an amount exactly equal to minSendable (inclusive lower bound)', async () => {
    const fetch = twoStepFetch(discoveryDoc(), { pr: 'lnbc1...' })
    const out = await resolveAddressToInvoice('a@b.com', 1000, { fetch })
    expect(out.pr).toBe('lnbc1...')
    expect(out.callbackUrl).toBe('https://b.com/lnurlp/cb?amount=1000')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('accepts an amount exactly equal to maxSendable (inclusive upper bound)', async () => {
    const fetch = twoStepFetch(discoveryDoc(), { pr: 'lnbc1...' })
    const out = await resolveAddressToInvoice('a@b.com', 100000, { fetch })
    expect(out.pr).toBe('lnbc1...')
    expect(out.callbackUrl).toBe('https://b.com/lnurlp/cb?amount=100000')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('rejects an amount one below minSendable but accepts the boundary', async () => {
    const below = twoStepFetch(discoveryDoc(), { pr: 'lnbc1...' })
    await expect(resolveAddressToInvoice('a@b.com', 999, { fetch: below }))
      .rejects.toThrow(/outside server range \[1000, 100000\]/)
    expect(below).toHaveBeenCalledTimes(1)
  })

  it('rejects an amount one above maxSendable but accepts the boundary', async () => {
    const above = twoStepFetch(discoveryDoc(), { pr: 'lnbc1...' })
    await expect(resolveAddressToInvoice('a@b.com', 100001, { fetch: above }))
      .rejects.toThrow(/outside server range \[1000, 100000\]/)
    expect(above).toHaveBeenCalledTimes(1)
  })

  it('throws on a negative bigint amount', async () => {
    const fetch = jest.fn(async () => makeResponse({ body: discoveryDoc() }))
    await expect(resolveAddressToInvoice('a@b.com', -1n, { fetch }))
      .rejects.toThrow(/non-negative integer/)
  })

  it('throws on a non-integer / negative amount', async () => {
    const fetch = jest.fn(async () => makeResponse({ body: discoveryDoc() }))
    await expect(resolveAddressToInvoice('a@b.com', -5, { fetch }))
      .rejects.toThrow(/non-negative integer/)
    await expect(resolveAddressToInvoice('a@b.com', 'abc', { fetch }))
      .rejects.toThrow(/non-negative integer/)
    await expect(resolveAddressToInvoice('a@b.com', {}, { fetch }))
      .rejects.toThrow(/non-negative integer/)
  })

  it('throws when the callback responds with status=ERROR', async () => {
    const errorBody = { status: 'ERROR', reason: 'too poor' }
    const fetch = twoStepFetch(discoveryDoc(), errorBody)
    const err = await resolveAddressToInvoice('a@b.com', 5000, { fetch }).catch((e) => e)
    expect(err).toBeInstanceOf(LnurlPayError)
    expect(err.message).toMatch(/callback rejected: too poor/)
    expect(err.status).toBe(200)
    // The error must carry the verbatim callback body for diagnostics:
    // blanking it to '' (or any other value) is a regression.
    expect(err.body).toBe(JSON.stringify(errorBody))
    expect(JSON.parse(err.body)).toEqual(errorBody)
  })

  it('reports "no reason" when the callback ERROR omits a reason', async () => {
    const fetch = twoStepFetch(discoveryDoc(), { status: 'ERROR' })
    await expect(resolveAddressToInvoice('a@b.com', 5000, { fetch }))
      .rejects.toThrow(/no reason/)
  })

  it('throws when the callback omits pr', async () => {
    const fetch = twoStepFetch(discoveryDoc(), { routes: [] })
    await expect(resolveAddressToInvoice('a@b.com', 5000, { fetch }))
      .rejects.toThrow(/missing 'pr'/)
  })

  it('truncates an over-long missing-pr body to 197 chars + an ellipsis', async () => {
    // The padding contains no quotes, keeping the serialized length stable.
    const longBody = { routes: [], note: 'x'.repeat(500) }
    const serialized = JSON.stringify(longBody)
    expect(serialized.length).toBeGreaterThan(200)
    const fetch = twoStepFetch(discoveryDoc(), longBody)
    const err = await resolveAddressToInvoice('a@b.com', 5000, { fetch }).catch((e) => e)
    expect(err).toBeInstanceOf(LnurlPayError)
    const expectedTruncation = serialized.slice(0, 197) + '…'
    expect(err.message).toBe(`LUD-06 callback missing 'pr': ${expectedTruncation}`)
    expect(err.message).toContain('…')
    expect(err.message.endsWith('…')).toBe(true)
    const payload = err.message.slice("LUD-06 callback missing 'pr': ".length)
    expect(payload).toHaveLength(198)
    expect(payload.slice(0, 197)).toBe(serialized.slice(0, 197))
  })

  it('does not truncate a short missing-pr body', async () => {
    const shortBody = { routes: [] }
    const serialized = JSON.stringify(shortBody)
    expect(serialized.length).toBeLessThanOrEqual(200)
    const fetch = twoStepFetch(discoveryDoc(), shortBody)
    const err = await resolveAddressToInvoice('a@b.com', 5000, { fetch }).catch((e) => e)
    expect(err.message).toBe(`LUD-06 callback missing 'pr': ${serialized}`)
    expect(err.message).not.toContain('…')
  })

  it('throws when pr is an empty string', async () => {
    const fetch = twoStepFetch(discoveryDoc(), { pr: '' })
    await expect(resolveAddressToInvoice('a@b.com', 5000, { fetch }))
      .rejects.toThrow(/missing 'pr'/)
  })

  it('compares large msat amounts as BigInt without 2^53 truncation', async () => {
    const big = '9007199254740993' // 2^53 + 1
    const discovery = discoveryDoc({ minSendable: '1000', maxSendable: big })
    const fetch = twoStepFetch(discovery, { pr: 'lnbc1...' })
    const out = await resolveAddressToInvoice('a@b.com', BigInt(big), { fetch })
    expect(out.callbackUrl).toBe(`https://b.com/lnurlp/cb?amount=${big}`)
  })
})

describe('timeout signal selection', () => {
  // Exercise runtime feature fallbacks unavailable in the current Node process.
  let savedTimeout

  beforeEach(() => {
    savedTimeout = AbortSignal.timeout
  })

  afterEach(() => {
    AbortSignal.timeout = savedTimeout
  })

  it('falls back to AbortController when AbortSignal.timeout is unavailable', async () => {
    AbortSignal.timeout = undefined
    let captured
    const fetch = jest.fn(async (url, init) => {
      captured = init.signal
      return makeResponse({ body: discoveryDoc() })
    })
    await fetchDiscovery('a@b.com', { fetch })
    // The controller's signal is a real AbortSignal instance.
    expect(captured).toBeInstanceOf(AbortSignal)
  })

  it('passes undefined when neither AbortSignal.timeout nor AbortController exist', async () => {
    AbortSignal.timeout = undefined
    const savedController = globalThis.AbortController
    globalThis.AbortController = undefined
    try {
      let captured = 'unset'
      const fetch = jest.fn(async (url, init) => {
        captured = init.signal
        return makeResponse({ body: discoveryDoc() })
      })
      await fetchDiscovery('a@b.com', { fetch })
      expect(captured).toBeUndefined()
    } finally {
      globalThis.AbortController = savedController
    }
  })
})
