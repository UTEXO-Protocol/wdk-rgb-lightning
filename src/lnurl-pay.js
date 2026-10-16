// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
'use strict'

import { toUint64String } from './lsp-utils.js'
import { parseLnurlCallback, parseLnurlDiscovery } from './lsp-response-contracts.js'

// Generic LUD-06 (Lightning Address) client, independent of utexo-lsp:
// any LNURL-pay server that follows the spec works. We split this out
// from LspClient so a wallet can pay an external Lightning Address
// (e.g. `alice@getalby.com`) without any utexo-lsp knowledge.
//
// Spec references:
//   https://github.com/lnurl/luds/blob/luds/16.md   (Lightning Address)
//   https://github.com/lnurl/luds/blob/luds/06.md   (LNURL-pay)
//   https://github.com/uma-universal-money-address/protocol/blob/main/umad-01-addresses.md
//
// We deliberately do not verify the BOLT11 invoice's description-hash
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
  /**
   * Create an error for a malformed LNURL response or failed request.
   *
   * @param {string} message - Human-readable failure description.
   * @param {{ status?: number, body?: string, cause?: unknown }} [opts] - Optional
   *   HTTP response context and originating failure.
   */
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
const MAX_RESPONSE_BYTES = 1 << 20

/** Prefix that distinguishes a UMA address from a Lightning Address. */
export const UMA_PREFIX = '$'

/** Maximum UMA username length, including the leading `$`, per UMAD-01. */
export const UMA_MAX_USERNAME_LENGTH = 64

const LIGHTNING_ADDRESS_USERNAME_RE = /^[a-z0-9._+-]+$/

/**
 * Return whether an address uses UMA's leading `$` form.
 *
 * @param {unknown} address - Candidate address.
 * @returns {boolean} - Whether the trimmed string starts with `$`.
 */
export function isUmaAddress (address) {
  return typeof address === 'string' && address.trim().startsWith(UMA_PREFIX)
}

/**
 * Convert a UMA address to Lightning Address form.
 *
 * Plain Lightning Addresses are trimmed and otherwise left unchanged. UMA
 * addresses are lowercased because UMAD-01 defines them as case-insensitive.
 * This helper normalizes syntax only; use {@link parseLightningAddress} when
 * validation is required.
 *
 * @param {string} address - Lightning Address or UMA address.
 * @returns {string} - Address without the UMA prefix.
 * @throws {LnurlPayError} - If `address` is not a string.
 */
export function normalizeLightningAddress (address) {
  if (typeof address !== 'string') {
    throw new LnurlPayError('normalizeLightningAddress: address must be a string')
  }

  const trimmed = address.trim()
  return trimmed.startsWith(UMA_PREFIX)
    ? trimmed.slice(UMA_PREFIX.length).toLowerCase()
    : trimmed
}

/**
 * Parse `user@host` or UMA's `$user@host` form. The UMA prefix is removed
 * before LNURL discovery. The host is case-insensitive and the local part is
 * lowercased per LUD-16.
 *
 * `allowHttp` defaults to false for safety. We auto-allow http for
 * loopback hosts (`localhost`, `127.0.0.1`, `[::1]`, `10.0.2.2`,
 * `*.local`) since those are almost always dev/regtest. `.onion` per LUD-16
 * always uses http.
 *
 * @param {string} addr - Lightning Address or UMA address.
 * @param {object} [opts] - Address parsing options.
 * @param {boolean} [opts.allowHttp] - Whether non-loopback hosts may use
 *   plain HTTP. Defaults to `false`.
 * @returns {{ username:string, host:string, domain:string, address:string, isUma:boolean, discoveryUrl:string }} -
 *   Canonical address components and discovery URL.
 * @throws {LnurlPayError} - If the address or host is malformed.
 */
export function parseLightningAddress (addr, opts = {}) {
  if (typeof addr !== 'string' || addr.trim().length === 0) {
    throw new LnurlPayError('parseLightningAddress: address required')
  }
  const isUma = isUmaAddress(addr)
  const normalized = normalizeLightningAddress(addr)
  const at = normalized.lastIndexOf('@')
  if (at <= 0 || at === normalized.length - 1) {
    throw new LnurlPayError(`parseLightningAddress: malformed address '${addr}'`)
  }
  // LUD-16 §spec normalises the local-part to lowercase. The host is
  // already case-insensitive at the DNS layer; we lowercase too so the
  // discovery URL is stable.
  const username = normalized.slice(0, at).toLowerCase()
  const host = normalized.slice(at + 1).toLowerCase()
  if (!LIGHTNING_ADDRESS_USERNAME_RE.test(username)) {
    throw new LnurlPayError(`parseLightningAddress: invalid local-part '${username}'`)
  }
  if (isUma && username.length + UMA_PREFIX.length > UMA_MAX_USERNAME_LENGTH) {
    throw new LnurlPayError(
      `parseLightningAddress: UMA local-part exceeds ${UMA_MAX_USERNAME_LENGTH} characters including '${UMA_PREFIX}'`
    )
  }
  if (!/^[a-z0-9.[\]:_-]+$/.test(host)) {
    throw new LnurlPayError(`parseLightningAddress: invalid host '${host}'`)
  }
  const address = `${username}@${host}`
  const scheme = pickScheme(host, opts.allowHttp === true)
  const discoveryUrl = `${scheme}://${host}/.well-known/lnurlp/${encodeURIComponent(username)}`
  return { username, host, domain: host, address, isUma, discoveryUrl }
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
    noPort === '10.0.2.2' ||
    noPort.endsWith('.local') ||
    noPort.endsWith('.localhost')
}

/**
 * Fetch and validate the LUD-06 discovery document for an address. The caller
 * must still decode the returned invoice and compare its description-hash
 * anchor with the exact `metadata` bytes before authorizing payment.
 *
 * @param {string} addr - Lightning Address, UMA address, or a full URL to a
 *   `/.well-known/lnurlp/<user>` endpoint (useful for
 *   `LspClient.lnurlDiscovery` callers who already have an LSP URL).
 * @param {object} [opts] - Discovery request options.
 * @param {typeof fetch} [opts.fetch] - Fetch implementation. Defaults to the
 *   runtime's global `fetch`.
 * @param {number} [opts.timeoutMs] - Request timeout in milliseconds.
 *   Defaults to 15 seconds.
 * @param {boolean} [opts.allowHttp] - Whether non-loopback hosts may use
 *   plain HTTP. Defaults to `false`.
 * @returns {Promise<LnurlPayDiscovery>} - Validated LUD-06 discovery document.
 * @throws {LnurlPayError} - If fetching fails or the discovery document is
 *   malformed.
 */
export async function fetchDiscovery (addr, opts = {}) {
  const fetcher = opts.fetch ?? globalThis.fetch
  if (typeof fetcher !== 'function') {
    throw new LnurlPayError('fetchDiscovery: no global fetch; pass opts.fetch')
  }
  const url = discoveryUrlFor(addr, opts)

  const requestSignal = composeRequestSignal(
    timeoutSignal(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    opts.signal
  )
  try {
    const data = await fetchJson(fetcher, url, { signal: requestSignal.signal })
    validateDiscovery(data, url)
    try {
      return parseLnurlDiscovery(data, url)
    } catch (cause) {
      throw new LnurlPayError(cause.message, { cause })
    }
  } finally {
    requestSignal.cleanup()
  }
}

/**
 * Resolve a Lightning Address to a BOLT11 invoice for `amountMsat`.
 * Returns `{ pr, routes, discovery, callbackUrl }` — the wallet pays
 * `pr` through its local RLN node. `discovery` is included so callers
 * can verify the description-hash anchor against the returned invoice
 * after decoding it.
 *
 * @param {string} addr - Lightning Address, UMA address, or discovery endpoint
 *   URL.
 * @param {bigint|number|string} amountMsat - Amount to request, in
 *   millisatoshis.
 * @param {object} [opts] - LNURL resolution options.
 * @param {typeof fetch} [opts.fetch] - Fetch implementation. Defaults to the
 *   runtime's global `fetch`.
 * @param {number} [opts.timeoutMs] - Per-request timeout in milliseconds.
 *   Defaults to 15 seconds.
 * @param {boolean} [opts.allowHttp] - Whether non-loopback hosts may use
 *   plain HTTP. Defaults to `false`.
 * @param {boolean} [opts.allowCrossHostCallback] - Permit a callback on a
 *   different host than discovery. Defaults to `false` to prevent discovery
 *   documents from redirecting the follow-up request to an unrelated host.
 * @param {string} [opts.comment] - LUD-12 comment, subject to server policy.
 * @param {string} [opts.assetId] - Optional RGB asset extension.
 * @param {bigint|number|string} [opts.assetAmount] - Optional RGB asset
 *   amount.
 * @returns {Promise<{ pr:string, routes:Array, discovery:LnurlPayDiscovery, callbackUrl:string }>} - BOLT11
 *   invoice, route hints, discovery document, and callback URL.
 * @throws {LnurlPayError} - If discovery or callback fetching fails, the
 *   amount is outside the advertised range, or a response is malformed.
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
  enforceAssetRequest(opts.assetId, opts.assetAmount, discovery)
  enforceComment(opts.comment, discovery)

  const callbackUrl = appendQuery(discovery.callback, {
    amount,
    ...(opts.assetId !== undefined ? { asset_id: String(opts.assetId) } : {}),
    ...(opts.assetAmount !== undefined ? { asset_amount: asUint64String(opts.assetAmount, 'assetAmount') } : {}),
    ...(opts.comment ? { comment: opts.comment } : {})
  })

  const requestSignal = composeRequestSignal(
    timeoutSignal(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    opts.signal
  )
  let data
  try {
    const raw = await fetchJson(fetcher, callbackUrl, { signal: requestSignal.signal })
    if (raw.status === 'ERROR') {
      throw new LnurlPayError(`LUD-06 callback rejected: ${raw.reason ?? 'no reason'}`, {
        status: 200,
        body: JSON.stringify(raw)
      })
    }
    if (typeof raw.pr !== 'string' || raw.pr.length === 0) {
      throw new LnurlPayError(`LUD-06 callback missing 'pr': ${truncate(JSON.stringify(raw))}`)
    }
    try {
      data = parseLnurlCallback(raw, callbackUrl)
    } catch (cause) {
      throw new LnurlPayError(cause.message, { cause })
    }
  } finally {
    requestSignal.cleanup()
  }
  return {
    pr: data.pr,
    routes: Array.isArray(data.routes) ? data.routes : [],
    ...(data.status === undefined ? {} : { status: data.status }),
    ...(data.reason === undefined ? {} : { reason: data.reason }),
    ...(data.proof === undefined ? {} : { proof: data.proof }),
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
    res = await fetcher(url, {
      ...init,
      redirect: 'error',
      headers: { Accept: 'application/json', ...(init?.headers ?? {}) }
    })
    assertNoRedirect(res, url)
  } catch (cause) {
    if (cause instanceof LnurlPayError) throw cause
    throw new LnurlPayError(`fetch failed for ${url}`, { cause })
  }
  const text = await readBoundedResponseText(res, url)
  if (!res.ok) {
    throw new LnurlPayError(`HTTP ${res.status} from ${url}`, { status: res.status, body: text.trim() })
  }
  try {
    return JSON.parse(text)
  } catch (cause) {
    throw new LnurlPayError(`invalid JSON from ${url}: ${truncate(text)}`, { status: res.status, body: text, cause })
  }
}

function assertNoRedirect (response, requestedUrl) {
  const finalUrl = typeof response?.url === 'string' && response.url.length > 0
    ? response.url
    : requestedUrl
  if (response?.redirected === true || finalUrl !== requestedUrl) {
    throw new LnurlPayError(`redirected response is not accepted for ${requestedUrl}`, {
      status: Number(response?.status) || 0
    })
  }
}

async function readBoundedResponseText (response, url) {
  const declaredLength = response.headers?.get?.('content-length')
  if (declaredLength !== null && declaredLength !== undefined && declaredLength !== '') {
    const bytes = Number(declaredLength)
    if (Number.isFinite(bytes) && bytes > MAX_RESPONSE_BYTES) {
      throw responseTooLarge(url, response.status, bytes)
    }
  }

  const body = response.body
  if (!body || typeof body.getReader !== 'function') {
    const text = await response.text()
    const bytes = new TextEncoder().encode(text).byteLength
    if (bytes > MAX_RESPONSE_BYTES) throw responseTooLarge(url, response.status, bytes)
    return text
  }

  const reader = body.getReader()
  const chunks = []
  let byteLength = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = value instanceof Uint8Array
        ? value
        : new Uint8Array(value.buffer ?? value, value.byteOffset ?? 0, value.byteLength)
      byteLength += chunk.byteLength
      if (byteLength > MAX_RESPONSE_BYTES) {
        try {
          await reader.cancel()
        } catch {}
        throw responseTooLarge(url, response.status, byteLength)
      }
      chunks.push(chunk)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

function responseTooLarge (url, status, bytes) {
  return new LnurlPayError(
    `response from ${url} exceeds ${MAX_RESPONSE_BYTES} bytes (${bytes} received)`,
    { status }
  )
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

function enforceAssetRequest (assetId, assetAmount, discovery) {
  const hasAssetId = assetId !== undefined
  const hasAssetAmount = assetAmount !== undefined
  if (hasAssetId !== hasAssetAmount) {
    throw new LnurlPayError('assetId and assetAmount must be set together')
  }
  if (!hasAssetId) return
  if (
    typeof assetId !== 'string' ||
    assetId.length === 0 ||
    assetId !== assetId.trim() ||
    /\s/.test(assetId)
  ) {
    throw new LnurlPayError('assetId must be a non-empty whitespace-free string')
  }
  if (BigInt(asUint64String(assetAmount, 'assetAmount')) === 0n) {
    throw new LnurlPayError('assetAmount must be positive')
  }
  const accepted = discovery.acceptedAssets ??
    (discovery.payoutAsset ? [discovery.payoutAsset] : [])
  if (!accepted.some((asset) => asset.assetId === assetId)) {
    throw new LnurlPayError(`asset '${assetId}' is not advertised by this Lightning Address`)
  }
}

function enforceComment (comment, discovery) {
  if (comment === undefined || comment === '') return
  if (typeof comment !== 'string') {
    throw new LnurlPayError('comment must be a string')
  }
  const maximum = discovery.commentAllowed ?? 0
  if (maximum === 0) {
    throw new LnurlPayError('this Lightning Address does not accept comments')
  }
  if ([...comment].length > maximum) {
    throw new LnurlPayError(`comment exceeds the advertised ${maximum}-character limit`)
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
  if (url.username !== '' || url.password !== '' || url.hash !== '') {
    throw new LnurlPayError('discovery URL must not contain credentials or a fragment')
  }
  if (url.protocol === 'http:' && opts.allowHttp !== true && !isLoopback(url.host) && !url.hostname.endsWith('.onion')) {
    throw new LnurlPayError(`plain HTTP discovery is not allowed for '${url.host}'`)
  }
  return url.toString()
}

function assertCallbackOrigin (callbackUrl, discoveryUrl, opts) {
  const callback = new URL(callbackUrl)
  const discovery = new URL(discoveryUrl)
  if (callback.username !== '' || callback.password !== '' || callback.hash !== '') {
    throw new LnurlPayError('LUD-06 callback must not contain credentials or a fragment')
  }
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
    return (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.username === '' &&
      url.password === '' &&
      url.hash === ''
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
    const controller = new AbortController()
    setTimeout(
      () => controller.abort(new Error(`LNURL request timed out after ${ms}ms`)),
      ms
    ).unref?.()
    return controller.signal
  }
  return undefined
}

function composeRequestSignal (timeout, callerSignal) {
  if (callerSignal?.aborted) {
    throw new LnurlPayError('LNURL request aborted', { cause: callerSignal.reason })
  }
  if (!timeout) return { signal: callerSignal, cleanup: () => {} }
  if (!callerSignal) return { signal: timeout, cleanup: () => {} }
  if (typeof AbortController === 'undefined') {
    return { signal: callerSignal, cleanup: () => {} }
  }
  const controller = new AbortController()
  const onTimeout = () => controller.abort(timeout.reason)
  const onAbort = () => controller.abort(callerSignal.reason)
  timeout.addEventListener('abort', onTimeout, { once: true })
  callerSignal.addEventListener('abort', onAbort, { once: true })
  return {
    signal: controller.signal,
    cleanup: () => {
      timeout.removeEventListener('abort', onTimeout)
      callerSignal.removeEventListener('abort', onAbort)
    }
  }
}

function truncate (s) { return s.length > 200 ? s.slice(0, 197) + '…' : s }

/**
 * @typedef {Object} LnurlPayDiscovery
 * @property {'payRequest'} tag - LUD-06 request type.
 * @property {string} callback - URL used to request a BOLT11 invoice.
 * @property {number|string} minSendable - Minimum amount in millisatoshis.
 * @property {number|string} maxSendable - Maximum amount in millisatoshis.
 * @property {string} metadata - LUD-06 metadata JSON string.
 * @property {number|string} [commentAllowed] - Maximum LUD-12 comment length.
 * @property {object} [payoutAsset] - Receiver's exact payout representation.
 * @property {object[]} [acceptedAssets] - Exact representations accepted by the callback.
 */
