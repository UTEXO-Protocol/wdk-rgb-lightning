// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
'use strict'

import { toUint64String } from './lsp-utils.js'

// Generic LUD-06 (Lightning Address) client. NOT utexo-lsp specific:
// any LNURL-pay server that follows the spec works. We split this out
// from LspClient so a wallet can pay an external Lightning Address
// (e.g. `alice@getalby.com`) without any utexo-lsp knowledge.
//
// Spec references:
//   https://github.com/lnurl/luds/blob/luds/16.md   (Lightning Address)
//   https://github.com/lnurl/luds/blob/luds/06.md   (LNURL-pay)
//
// We deliberately do NOT verify the BOLT11 invoice's description-hash
// matches the metadata here — that's the responsibility of the caller
// once it decodes the invoice via the local RLN node. Doing it here
// would force a duplicate bolt11 parser into this package.

/**
 * Thrown for malformed Lightning Addresses, malformed LUD-06 responses,
 * or transport errors fetching the metadata / callback. HTTP failures
 * carry `status` and `body`; programmer / protocol errors carry just
 * the message.
 */
export class LnurlPayError extends Error {
  constructor (message, { status = 0, body = '', cause } = {}) {
    super(message)
    this.name = 'LnurlPayError'
    this.status = status
    this.body = body
    if (cause) this.cause = cause
  }
}

/** Default request timeout for both discovery + callback fetches. */
const DEFAULT_TIMEOUT_MS = 15_000

/**
 * Parse `user@host` (case-insensitive on the host part, lowercase on
 * the local-part per LUD-16). Returns the canonical components plus
 * the discovery URL the wallet should fetch.
 *
 * `allowHttp` defaults to false for safety. We auto-allow http for
 * loopback hosts (`localhost`, `127.0.0.1`, `[::1]`, `*.local`) since
 * those are almost always dev/regtest. `.onion` per LUD-16 always uses
 * http.
 *
 * @param {string} addr
 * @param {object} [opts]
 * @param {boolean} [opts.allowHttp]
 * @returns {{ username:string, host:string, discoveryUrl:string }}
 */
export function parseLightningAddress (addr, opts = {}) {
  if (typeof addr !== 'string' || addr.length === 0) {
    throw new LnurlPayError('parseLightningAddress: address required')
  }
  const at = addr.lastIndexOf('@')
  if (at <= 0 || at === addr.length - 1) {
    throw new LnurlPayError(`parseLightningAddress: malformed address '${addr}'`)
  }
  // LUD-16 §spec normalises the local-part to lowercase. The host is
  // already case-insensitive at the DNS layer; we lowercase too so the
  // discovery URL is stable.
  const username = addr.slice(0, at).toLowerCase()
  const host = addr.slice(at + 1).toLowerCase()
  if (!/^[a-z0-9._+-]+$/.test(username)) {
    throw new LnurlPayError(`parseLightningAddress: invalid local-part '${username}'`)
  }
  if (!/^[a-z0-9.[\]:_-]+$/.test(host)) {
    throw new LnurlPayError(`parseLightningAddress: invalid host '${host}'`)
  }
  const scheme = pickScheme(host, opts.allowHttp === true)
  const discoveryUrl = `${scheme}://${host}/.well-known/lnurlp/${encodeURIComponent(username)}`
  return { username, host, discoveryUrl }
}

function pickScheme (host, allowHttp) {
  if (host.endsWith('.onion')) return 'http'
  if (isLoopback(host)) return 'http'
  return allowHttp ? 'http' : 'https'
}

function isLoopback (host) {
  // Strip port if present (`[::1]:8080`, `127.0.0.1:8080`, `localhost:8080`).
  const noPort = host.replace(/:\d+$/, '').replace(/^\[(.+)\]$/, '$1')
  return noPort === 'localhost' ||
    noPort === '127.0.0.1' ||
    noPort === '::1' ||
    noPort.endsWith('.local') ||
    noPort.endsWith('.localhost')
}

/**
 * Fetch the LUD-06 discovery document for an address. Returns the
 * server's response verbatim (no schema validation beyond shape). The
 * caller is expected to honour `minSendable` / `maxSendable` and
 * compute `metadata` hash from the returned `metadata` string when
 * checking the invoice's description-hash anchor.
 *
 * @param {string} addr Lightning Address (`user@host`) OR a full URL
 *                      to a `/.well-known/lnurlp/<user>` endpoint
 *                      (useful for `LspClient.lnurlDiscovery` callers
 *                      who already have an LSP URL).
 * @param {object} [opts]
 * @param {typeof fetch} [opts.fetch]
 * @param {number} [opts.timeoutMs]
 * @param {boolean} [opts.allowHttp]
 */
export async function fetchDiscovery (addr, opts = {}) {
  const fetcher = opts.fetch ?? globalThis.fetch
  if (typeof fetcher !== 'function') {
    throw new LnurlPayError('fetchDiscovery: no global fetch; pass opts.fetch')
  }
  const url = discoveryUrlFor(addr, opts)

  const data = await fetchJson(fetcher, url, {
    signal: timeoutSignal(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  })
  validateDiscovery(data, url)
  return /** @type {LnurlPayDiscovery} */ (data)
}

/**
 * Resolve a Lightning Address to a BOLT11 invoice for `amountMsat`.
 * Returns `{ pr, routes, discovery, callbackUrl }` — the wallet pays
 * `pr` through its local RLN node. `discovery` is included so callers
 * can verify the description-hash anchor against the returned invoice
 * after decoding it.
 *
 * @param {string} addr
 * @param {bigint|number|string} amountMsat
 * @param {object} [opts]
 * @param {typeof fetch} [opts.fetch]
 * @param {number} [opts.timeoutMs]
 * @param {boolean} [opts.allowHttp]
 * @param {boolean} [opts.allowCrossHostCallback=false]
 *   Permit a callback on a host other than the discovery endpoint.
 *   Disabled by default to prevent a discovery document from redirecting
 *   the wallet's authenticated network access to an unrelated host.
 * @param {string} [opts.comment]   LUD-12 comment (server-policy gated).
 * @param {string} [opts.assetId]   Optional RGB asset extension.
 * @param {bigint|number|string} [opts.assetAmount]
 * @returns {Promise<{ pr:string, routes:Array, discovery:LnurlPayDiscovery, callbackUrl:string }>}
 */
export async function resolveAddressToInvoice (addr, amountMsat, opts = {}) {
  const fetcher = opts.fetch ?? globalThis.fetch
  if (typeof fetcher !== 'function') {
    throw new LnurlPayError('resolveAddressToInvoice: no global fetch; pass opts.fetch')
  }

  const discoveryUrl = discoveryUrlFor(addr, opts)
  const discovery = await fetchDiscovery(discoveryUrl, opts)
  assertCallbackOrigin(discovery.callback, discoveryUrl, opts)
  const amount = asUint64String(amountMsat, 'amountMsat')
  enforceRange(amount, discovery)

  const callbackUrl = appendQuery(discovery.callback, {
    amount,
    ...(opts.assetId !== undefined ? { asset_id: String(opts.assetId) } : {}),
    ...(opts.assetAmount !== undefined ? { asset_amount: asUint64String(opts.assetAmount, 'assetAmount') } : {}),
    ...(opts.comment ? { comment: opts.comment } : {})
  })

  const data = await fetchJson(fetcher, callbackUrl, {
    signal: timeoutSignal(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  })
  if (data.status === 'ERROR') {
    throw new LnurlPayError(`LUD-06 callback rejected: ${data.reason ?? 'no reason'}`, {
      status: 200,
      body: JSON.stringify(data)
    })
  }
  if (typeof data.pr !== 'string' || data.pr.length === 0) {
    throw new LnurlPayError(`LUD-06 callback missing 'pr': ${truncate(JSON.stringify(data))}`)
  }
  return {
    pr: data.pr,
    routes: Array.isArray(data.routes) ? data.routes : [],
    discovery,
    callbackUrl
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function fetchJson (fetcher, url, init) {
  let res
  try {
    res = await fetcher(url, { ...init, headers: { Accept: 'application/json', ...(init?.headers ?? {}) } })
  } catch (cause) {
    throw new LnurlPayError(`fetch failed for ${url}`, { cause })
  }
  const text = await res.text()
  if (!res.ok) {
    throw new LnurlPayError(`HTTP ${res.status} from ${url}`, { status: res.status, body: text.trim() })
  }
  try {
    return JSON.parse(text)
  } catch (cause) {
    throw new LnurlPayError(`invalid JSON from ${url}: ${truncate(text)}`, { status: res.status, body: text, cause })
  }
}

function validateDiscovery (data, url) {
  if (data == null || typeof data !== 'object') {
    throw new LnurlPayError(`LUD-06 discovery from ${url} is not an object`)
  }
  if (data.status === 'ERROR') {
    throw new LnurlPayError(`LUD-06 discovery rejected: ${data.reason ?? 'no reason'}`)
  }
  if (data.tag !== 'payRequest') {
    throw new LnurlPayError(`LUD-06 discovery: expected tag='payRequest', got '${data.tag}'`)
  }
  if (typeof data.callback !== 'string' || !isHttpUrl(data.callback)) {
    throw new LnurlPayError(`LUD-06 discovery: invalid callback '${data.callback}'`)
  }
  let min
  let max
  try {
    min = BigInt(toUint64String(data.minSendable, 'minSendable'))
    max = BigInt(toUint64String(data.maxSendable, 'maxSendable'))
  } catch (cause) {
    throw new LnurlPayError(
      `LUD-06 discovery: invalid sendable range min=${data.minSendable} max=${data.maxSendable}`,
      { cause }
    )
  }
  if (min > max || min === 0n) {
    throw new LnurlPayError(`LUD-06 discovery: invalid sendable range min=${data.minSendable} max=${data.maxSendable}`)
  }
  if (typeof data.metadata !== 'string') {
    throw new LnurlPayError('LUD-06 discovery: missing metadata string')
  }
}

function enforceRange (amountStr, d) {
  // Compare as BigInt to avoid 2^53 truncation on large msat values.
  const amount = BigInt(amountStr)
  const min = BigInt(asUint64String(d.minSendable, 'minSendable'))
  const max = BigInt(asUint64String(d.maxSendable, 'maxSendable'))
  if (amount < min || amount > max) {
    throw new LnurlPayError(`amount ${amountStr} outside server range [${d.minSendable}, ${d.maxSendable}]`)
  }
}

function appendQuery (url, params) {
  const callback = new URL(url)
  for (const [key, value] of Object.entries(params)) callback.searchParams.set(key, String(value))
  return callback.toString()
}

function discoveryUrlFor (addr, opts) {
  if (typeof addr !== 'string' || !/^https?:\/\//i.test(addr)) {
    return parseLightningAddress(addr, opts).discoveryUrl
  }

  let url
  try {
    url = new URL(addr)
  } catch (cause) {
    throw new LnurlPayError(`invalid discovery URL '${addr}'`, { cause })
  }
  if (url.protocol === 'http:' && opts.allowHttp !== true && !isLoopback(url.host) && !url.hostname.endsWith('.onion')) {
    throw new LnurlPayError(`plain HTTP discovery is not allowed for '${url.host}'`)
  }
  return url.toString()
}

function assertCallbackOrigin (callbackUrl, discoveryUrl, opts) {
  const callback = new URL(callbackUrl)
  const discovery = new URL(discoveryUrl)
  if (callback.protocol === 'http:' && opts.allowHttp !== true && !isLoopback(callback.host) && !callback.hostname.endsWith('.onion')) {
    throw new LnurlPayError(`LUD-06 callback uses disallowed plain HTTP origin '${callback.origin}'`)
  }
  if (opts.allowCrossHostCallback !== true && callback.host !== discovery.host) {
    throw new LnurlPayError(
      `LUD-06 callback host '${callback.host}' does not match discovery host '${discovery.host}'`
    )
  }
}

function isHttpUrl (value) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function asUint64String (value, field) {
  try {
    return toUint64String(value, field)
  } catch (cause) {
    throw new LnurlPayError(cause.message, { cause })
  }
}

function timeoutSignal (ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms)
  }
  if (typeof AbortController !== 'undefined') {
    const ctrl = new AbortController()
    setTimeout(() => ctrl.abort(new Error(`LNURL request timed out after ${ms}ms`)), ms).unref?.()
    return ctrl.signal
  }
  return undefined
}

function truncate (s) { return s.length > 200 ? s.slice(0, 197) + '…' : s }

/**
 * @typedef {object} LnurlPayDiscovery
 * @property {'payRequest'} tag
 * @property {string} callback
 * @property {number|string} minSendable
 * @property {number|string} maxSendable
 * @property {string} metadata             JSON string per LUD-06.
 * @property {number|string} [commentAllowed]
 */
