// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
'use strict'

import {
  camelCaseLspResponse,
  canonicalAssetId,
  canonicalInvoice,
  snakeCaseLnParams,
  snakeCaseRgbParams,
  toUint64String
} from './lsp-utils.js'
import { parseLspInfo } from './lsp-info.js'
import {
  LspProtocolError,
  parseLightningAddressByPubkey,
  parseLightningReceive,
  parseLightningSend,
  parseLightningSendStatus,
  parseLnurlCallback,
  parseLnurlDiscovery,
  parseOnchainSend
} from './lsp-response-contracts.js'

// Thin typed wrapper around utexo-lsp's HTTP API. Side-effect free:
// methods build URLs, send JSON, validate response status, and return
// parsed JSON DTOs. Anything that combines an LSP call with a local
// daemon call (e.g. "pay this LSP-issued invoice via our own RLN")
// lives in lsp-helpers.js, not here.
//
// Bare + Node both supply WHATWG `fetch` globally: in Bare via
// bare-fetch/global (pulled in by `bare-node-runtime/global` from
// ./bare.js); in Node 18+ natively. We accept an optional `fetch`
// override for tests and proxy scenarios but default to the global so
// the common case stays one-liner constructible.

/**
 * Error thrown for non-2xx responses or transport failures from the
 * LSP. Carries the endpoint path, HTTP status (0 for transport errors)
 * and the raw response body so callers can map specific failures
 * (e.g. 400 from /onchain_send when an asset is outside the LSP's
 * allowlist) without re-parsing the message string.
 *
 * When the LSP returns a structured error body (`{ error: "...",
 * code?: number, name?: "Tag" }`), the parsed fields are exposed on
 * `errorBody`, `errorCode`, and `errorTag` so callers can match on
 * structured fields rather than substring-match the message.
 */
export class LspError extends Error {
  /**
   * Create an error for an LSP transport, HTTP, or response failure.
   *
   * @param {string} endpoint - LSP endpoint path.
   * @param {number} status - HTTP status, or `0` for a transport failure.
   * @param {string} body - Raw response body when available.
   * @param {unknown} [cause] - Originating transport or parsing failure.
   */
  constructor (endpoint, status, body, cause) {
    const head = `LSP ${endpoint}`
    const causeMessage = cause && typeof cause === 'object' && 'message' in cause
      ? String(cause.message)
      : 'request failed'
    const msg = status
      ? `${head} → HTTP ${status}: ${body}`
      : `${head} → ${causeMessage}`
    super(msg)
    this.name = 'LspError'
    this.endpoint = endpoint
    this.status = status
    this.body = body
    /** Parsed `{error,code,name}` fields, when the body is JSON. */
    this.errorBody = null
    this.errorCode = null
    this.errorTag = null
    if (typeof body === 'string' && body.length > 0 && body.charCodeAt(0) === 0x7b /* { */) {
      try {
        const parsed = JSON.parse(body)
        if (parsed && typeof parsed === 'object') {
          this.errorBody = parsed
          if (typeof parsed.error === 'string') this.message = `${head} → HTTP ${status}: ${parsed.error}`
          if (typeof parsed.code === 'number' || typeof parsed.code === 'string') this.errorCode = parsed.code
          if (typeof parsed.name === 'string') this.errorTag = parsed.name
        }
      } catch { /* not JSON — leave raw body in this.body */ }
    }
    if (cause) this.cause = cause
  }
}

/** Default request timeout if the caller doesn't override. */
const DEFAULT_TIMEOUT_MS = 15_000

/** Largest delay accepted by the JavaScript timer APIs (signed 32-bit ms). */
const MAX_TIMEOUT_MS = 2_147_483_647

/** Maximum UTF-8 response body accepted from the LSP (1 MiB). */
const MAX_RESPONSE_BYTES = 1 << 20

/**
 * HTTP statuses we retry. 5xx (server errors) + 429 (rate-limit) are
 * idempotent-safe to retry; everything else is a "the request is
 * wrong" or "you don't have permission" outcome that retrying won't
 * fix.
 */
const RETRY_STATUSES = new Set([502, 503, 504, 429])

/** Methods safe to retry without consulting the server (RFC 7231 §4.2.2). */
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'])

/** Default retry budget: 3 attempts with exponential backoff (250/500/1000 ms). */
const DEFAULT_RETRIES = 3
const MAX_RETRIES = 10
const RETRY_BASE_MS = 250

/**
 * Hostnames that are always allowed over plain HTTP (mirrors RLN VSS
 * allow-http loopback rule). `10.0.2.2` is the Android emulator's
 * host-loopback alias.
 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '10.0.2.2'])

export class LspClient {
  /**
   * Create an HTTP client bound to one LSP API origin.
   *
   * @param {object} opts - Client configuration.
   * @param {string} opts.baseUrl - LSP API origin, for example
   *   `https://lsp.utexo.io`. A trailing slash is optional.
   * @param {number} [opts.timeoutMs] - Default per-request timeout in
   *   milliseconds. Defaults to 15 seconds and can be overridden per call.
   * @param {typeof fetch} [opts.fetch] - Fetch implementation. Defaults to the
   *   runtime's global `fetch`.
   * @param {Record<string,string>} [opts.defaultHeaders] - Headers merged into
   *   every request.
   * @param {boolean} [opts.allowHttp] - Whether non-loopback hosts may use
   *   plain HTTP. Defaults to `false`; loopback hosts are always allowed.
   * @param {number} [opts.maxRetries] - Number of retries for idempotent
   *   requests that fail with a transport error, HTTP 429, or a retryable 5xx
   *   response. Defaults to `3`; set to `0` to disable retries.
   * @throws {TypeError} - If the base URL or fetch implementation is invalid.
   * @throws {Error} - If plain HTTP is requested for a non-loopback host
   *   without explicit opt-in.
   */
  constructor ({ baseUrl, timeoutMs = DEFAULT_TIMEOUT_MS, fetch: fetchImpl, defaultHeaders, allowHttp = false, maxRetries = DEFAULT_RETRIES } = {}) {
    if (typeof baseUrl !== 'string' || baseUrl.length === 0 || baseUrl !== baseUrl.trim()) {
      throw new TypeError('LspClient: baseUrl is required')
    }
    const fetcher = fetchImpl ?? globalThis.fetch
    if (typeof fetcher !== 'function') {
      throw new TypeError('LspClient: no fetch available; pass opts.fetch or run in an environment that exposes global fetch (Bare via bare-fetch/global, Node ≥18)')
    }
    const normalized = baseUrl.replace(/\/+$/, '')
    // HTTPS enforcement: reject plain http on non-loopback unless the
    // host explicitly opts in via allowHttp. Mirrors the same safety
    // rail RLN uses for vssAllowHttp — channel-state and Lightning-
    // Address payment requests are too sensitive to send over plaintext
    // by accident.
    let parsedUrl
    try {
      parsedUrl = new URL(normalized)
    } catch {
      throw new TypeError(`LspClient: baseUrl is not a valid URL: ${baseUrl}`)
    }
    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
      throw new TypeError(`LspClient: baseUrl must use http: or https:, got ${parsedUrl.protocol}`)
    }
    if (parsedUrl.username !== '' || parsedUrl.password !== '') {
      throw new TypeError('LspClient: baseUrl must not contain credentials')
    }
    if (parsedUrl.search !== '' || parsedUrl.hash !== '') {
      throw new TypeError('LspClient: baseUrl must not contain a query or fragment')
    }
    if (parsedUrl.protocol === 'http:' && !allowHttp && !LOOPBACK_HOSTS.has(parsedUrl.hostname)) {
      throw new Error(
        'LspClient: plain http:// is only allowed for loopback hosts; ' +
        `got '${parsedUrl.hostname}'. Pass allowHttp:true to opt in for ` +
        'non-loopback hosts (regtest staging, etc.).'
      )
    }
    this._base = normalized
    this._timeoutMs = parseTimeoutMs(timeoutMs, 'LspClient: timeoutMs')
    this._maxRetries = parseRetryCount(maxRetries, 'LspClient: maxRetries')
    this._fetch = fetcher
    this._headers = { ...(defaultHeaders ?? {}) }
  }

  get baseUrl () { return this._base }

  /**
   * Liveness probe. Cheap; safe to call every few seconds.
   *
   * @param {object} [opts] - Per-call request options.
   * @param {number} [opts.timeoutMs] - Override the constructor's timeout in
   *   milliseconds.
   * @returns {Promise<object|null>} - Parsed liveness response.
   * @throws {LspError} - If transport, HTTP, size, or JSON validation fails.
   */
  health (opts = {}) { return this._req('GET', '/health', undefined, opts) }

  /**
   * Returns the LSP's public identity, supported assets, and operating policy.
   *
   * @param {object} [opts] - Per-call request options.
   * @param {number} [opts.timeoutMs] - Override the constructor's timeout in
   *   milliseconds.
   * @returns {Promise<import('../index.js').LspInfo>} - Validated LSP information.
   * @throws {LspError} - If transport, HTTP, size, or JSON validation fails.
   */
  async getInfo (opts = {}) {
    return parseLspInfo(await this._req('GET', '/get_info', undefined, opts))
  }

  /**
   * LUD-06 discovery for a Lightning Address hosted by this LSP.
   *
   * @param {string} username - Local part of `user@host`, without `@` or host.
   * @param {object} [opts] - Per-call request options.
   * @param {number} [opts.timeoutMs] - Override the constructor's timeout in
   *   milliseconds.
   * @returns {Promise<object>} - LUD-06 discovery document.
   * @throws {TypeError} - If `username` is empty or not a string.
   * @throws {LspError} - If transport, HTTP, size, or JSON validation fails.
   */
  lnurlDiscovery (username, opts = {}) {
    if (!isNonEmptyString(username)) throw new TypeError('LspClient.lnurlDiscovery: username required')
    return this._req('GET', `/.well-known/lnurlp/${encodeURIComponent(username)}`, undefined, opts)
  }

  /** Strict discovery alias matching the shared SDK vocabulary. */
  async discoverAddress (username, opts = {}) {
    const path = `/.well-known/lnurlp/${encodeURIComponent(username)}`
    return parseLnurlDiscovery(await this.lnurlDiscovery(username, opts), path)
  }

  /**
   * LUD-06 callback. Returns `{ pr, routes }`. The wallet pays `pr`
   * through its own RLN node.
   *
   * @param {string} username - Local part of `user@host`, without `@` or host.
   * @param {bigint|number|string} amountMsat - Invoice amount in
   *   millisatoshis.
   * @param {object} [opts] - Callback request options.
   * @param {string} [opts.assetId] - Optional RGB asset filter.
   * @param {bigint|number|string} [opts.assetAmount] - Optional RGB asset
   *   amount.
   * @param {number} [opts.timeoutMs] - Override the constructor's timeout in
   *   milliseconds.
   * @returns {Promise<{pr:string, routes?:unknown[]}>} - LSP-issued BOLT11
   *   invoice and optional route hints.
   * @throws {TypeError} - If the username or uint64 amount fields are invalid.
   * @throws {LspError} - If transport, HTTP, size, or JSON validation fails.
   */
  lnurlCallback (username, amountMsat, opts = {}) {
    if (!isNonEmptyString(username)) throw new TypeError('LspClient.lnurlCallback: username required')
    const params = new URLSearchParams()
    params.set('amount', toUint64String(amountMsat, 'amountMsat'))
    appendAssetQuery(params, opts, 'LspClient.lnurlCallback')
    return this._req(
      'GET',
      `/pay/callback/${encodeURIComponent(username)}?${params.toString()}`,
      undefined,
      { ...opts, retry: false }
    )
  }

  /**
   * Full LUD-06 resolution against *this* LSP: discover the callback
   * URL from the Lightning-Address metadata, then fetch the BOLT11
   * invoice in one call. Unlike {@link resolveAddressToInvoice} in
   * `lnurl-pay.js` (which is host-agnostic and dials the address's own
   * domain), this method always routes through the LSP's `baseUrl`: the
   * callback URL the LSP returns is rewritten onto `baseUrl`'s origin so
   * the second hop also benefits from this client's retry/timeout rails
   * and works when the LSP advertises an internal/emulator host
   * (e.g. `10.0.2.2`) the device can't otherwise reach.
   *
   * Mirrors `@utexo/rgb-sdk-rn`'s `UtexoLSPClient.resolveAddress`.
   *
   * @param {string} username - Local part of `user@host`, without `@` or host.
   * @param {bigint|number|string} amountMsat - Invoice amount in
   *   millisatoshis.
   * @param {object} [opts] - Resolution request options.
   * @param {string} [opts.assetId] - Optional RGB asset filter.
   * @param {bigint|number|string} [opts.assetAmount] - Optional RGB asset
   *   amount.
   * @param {number} [opts.timeoutMs] - Override the constructor's timeout in
   *   milliseconds.
   * @returns {Promise<{ pr:string, routes:unknown[], status?:string, reason?:string }>} - LSP-issued
   *   invoice response.
   * @throws {TypeError} - If the username or uint64 amount fields are invalid.
   * @throws {LspError} - If discovery lacks a callback or either request
   *   fails.
   */
  async resolveAddress (username, amountMsat, opts = {}) {
    if (!isNonEmptyString(username)) throw new TypeError('LspClient.resolveAddress: username required')
    const meta = await this.lnurlDiscovery(username, opts)
    if (!meta || typeof meta.callback !== 'string' || meta.callback.length === 0) {
      throw new LspError(`/.well-known/lnurlp/${username}`, 200, 'missing callback in LNURL response')
    }
    const cbPath = this._rewriteCallbackToPath(meta.callback)
    const params = new URLSearchParams()
    params.set('amount', toUint64String(amountMsat, 'amountMsat'))
    appendAssetQuery(params, opts, 'LspClient.resolveAddress')
    const path = appendPathQuery(cbPath, params)
    return this._req(
      'GET',
      path,
      undefined,
      { ...opts, retry: false }
    )
  }

  /** Resolve a hosted address and validate both protocol responses. */
  async resolveAddressVerified (username, amountMsat, opts = {}) {
    if (!isNonEmptyString(username)) throw new TypeError('LspClient.resolveAddressVerified: username required')
    const discoveryPath = `/.well-known/lnurlp/${encodeURIComponent(username)}`
    const discovery = parseLnurlDiscovery(
      await this.lnurlDiscovery(username, opts),
      discoveryPath
    )
    const amount = toUint64String(amountMsat, 'amountMsat')
    const minimum = BigInt(toUint64String(discovery.minSendable, 'minSendable'))
    const maximum = BigInt(toUint64String(discovery.maxSendable, 'maxSendable'))
    if (BigInt(amount) < minimum || BigInt(amount) > maximum) {
      throw new LspProtocolError(
        discoveryPath,
        'amount',
        `a value in the advertised range [${minimum}, ${maximum}]`
      )
    }

    const hasAssetId = opts.assetId !== undefined
    const hasAssetAmount = opts.assetAmount !== undefined
    if (hasAssetId !== hasAssetAmount) {
      throw new TypeError('LspClient.resolveAddressVerified: assetId and assetAmount must be set together')
    }
    if (hasAssetId) {
      const assetId = typeof opts.assetId === 'string' ? opts.assetId.trim() : ''
      if (assetId.length === 0 || assetId !== opts.assetId) {
        throw new TypeError('LspClient.resolveAddressVerified: assetId must be a non-empty trimmed string')
      }
      const accepted = discovery.acceptedAssets ?? (discovery.payoutAsset ? [discovery.payoutAsset] : [])
      if (!accepted.some((asset) => asset.assetId === assetId)) {
        throw new LspProtocolError(discoveryPath, 'assetId', 'an exact contract advertised by accepted_assets')
      }
    }
    const callbackPath = this._rewriteCallbackToPath(discovery.callback)
    const params = new URLSearchParams()
    params.set('amount', amount)
    appendAssetQuery(params, opts, 'LspClient.resolveAddressVerified')
    const path = appendPathQuery(callbackPath, params)
    return {
      ...parseLnurlCallback(
        await this._req('GET', path, undefined, { ...opts, retry: false }),
        path
      ),
      discovery
    }
  }

  /**
   * Resolve the auto-assigned Lightning Address (`{ username, domain }`)
   * the LSP provisioned for a node pubkey. Provisioning can complete shortly
   * after peer connection, before the wallet submits its address-attested
   * APay batch, so callers should tolerate a temporary not-found response.
   * Give the resulting `username@domain` to senders.
   *
   * Mirrors `@utexo/rgb-sdk-rn`'s
   * `UtexoLSPClient.getLightningAddressByPubkey`.
   *
   * @param {string} peerPubkey - Hex-encoded, 33-byte compressed node public
   *   key.
   * @param {object} [opts] - Per-call request options.
   * @param {number} [opts.timeoutMs] - Override the constructor's timeout in
   *   milliseconds.
   * @returns {Promise<{ username:string, domain:string }>} - Auto-assigned
   *   Lightning Address components.
   * @throws {TypeError} - If `peerPubkey` is empty or not a string.
   * @throws {LspError} - If transport, HTTP, size, or JSON validation fails.
   */
  getLightningAddressByPubkey (peerPubkey, opts = {}) {
    const pk = typeof peerPubkey === 'string' ? peerPubkey.trim() : ''
    if (pk.length === 0) throw new TypeError('LspClient.getLightningAddressByPubkey: peerPubkey required')
    return this._req('GET', `/lightning_address/by_pubkey/${encodeURIComponent(pk)}`, undefined, opts)
  }

  /** Resolve and strictly validate an auto-assigned Lightning Address. */
  async getLightningAddressByPubkeyVerified (peerPubkey, opts = {}) {
    const expected = typeof peerPubkey === 'string' ? peerPubkey.trim().toLowerCase() : ''
    if (!/^(02|03)[0-9a-f]{64}$/.test(expected)) {
      throw new TypeError('LspClient.getLightningAddressByPubkeyVerified: peerPubkey must be a compressed public key')
    }
    const address = parseLightningAddressByPubkey(
      await this.getLightningAddressByPubkey(peerPubkey, opts)
    )
    if (address.recipientPubkey !== undefined && address.recipientPubkey !== expected) {
      throw new LspProtocolError(
        '/lightning_address/by_pubkey',
        'recipient_pubkey',
        'the public key requested by the caller'
      )
    }
    return address
  }

  /**
   * Reduce an LSP-advertised callback URL to a path and query rooted
   * at this client's `baseUrl`. Keeps the second LUD-06 hop on the same
   * origin so it inherits the client's retry/timeout config and dodges
   * unreachable internal hosts. Malformed and non-HTTP(S) callbacks fail
   * closed.
   * @private
   */
  _rewriteCallbackToPath (callbackUrl) {
    try {
      const cb = new URL(callbackUrl, this._base)
      if (cb.protocol !== 'https:' && cb.protocol !== 'http:') {
        throw new TypeError('LspClient: callback URL must use HTTP(S)')
      }
      if (cb.username !== '' || cb.password !== '') {
        throw new TypeError('LspClient: callback URL must not contain credentials')
      }
      if (cb.hash !== '') {
        throw new TypeError('LspClient: callback URL must not contain a fragment')
      }
      return `${cb.pathname}${cb.search}`
    } catch {
      throw new TypeError('LspClient: callback URL is malformed')
    }
  }

  /**
   * Bridge: caller hands the LSP an RGB invoice + LN-side parameters;
   * the LSP returns a BOLT11 invoice for the caller to pay. Once paid,
   * the LSP runs `sendrgb` to the recipient embedded in the RGB
   * invoice. Caller monitors completion via its own RLN node.
   * Response keys are normalized to camelCase so this method matches
   * `lightningReceive()` and the helpers in `lsp-helpers.js`.
   *
   * @param {object} params - RGB-to-Lightning bridge request.
   * @param {string} params.rgbInvoice - Recipient's on-chain RGB invoice.
   * @param {object} params.ln - Lightning invoice parameters.
   * @param {bigint|number|string} params.ln.amtMsat - Lightning amount in
   *   millisatoshis.
   * @param {number} params.ln.expirySec - Lightning invoice lifetime in
   *   seconds.
   * @param {string} [params.ln.assetId] - Optional RGB asset ID for an
   *   asset-bound Lightning invoice.
   * @param {bigint|number|string} [params.ln.assetAmount] - Optional RGB asset
   *   amount.
   * @param {string} [params.ln.descriptionHash] - Optional BOLT11 description
   *   hash.
   * @param {string} [params.ln.paymentHash] - Optional caller-supplied payment
   *   hash.
   * @param {number} [params.ln.minFinalCltvExpiryDelta] - Optional minimum
   *   final CLTV expiry delta.
   * @param {number} [params.timeoutMs] - Override the constructor's timeout in
   *   milliseconds.
   * @returns {Promise<{rgbInvoice:string, lnInvoice:string, mappingId:number}>} - Normalized
   *   bridge response.
   * @throws {TypeError} - If required inputs or integer fields are invalid.
   * @throws {LspError} - If the bridge request fails.
   */
  async onchainSend ({ rgbInvoice, ln, timeoutMs, signal } = {}) {
    const invoice = canonicalInvoice(rgbInvoice, 'LspClient.onchainSend: rgbInvoice')
    if (ln !== undefined && (ln === null || typeof ln !== 'object' || Array.isArray(ln))) {
      throw new TypeError('LspClient.onchainSend: ln params must be an object when provided')
    }
    const body = { rgb_invoice: invoice }
    if (ln !== undefined) body.lninvoice = snakeCaseLnParams(ln)
    return camelCaseLspResponse(await this._req('POST', '/onchain_send', body, { timeoutMs, signal }))
  }

  /** Submit and strictly validate an RGB-to-Lightning bridge response. */
  async onchainSendVerified (params = {}) {
    return parseOnchainSend(await this.onchainSend(params))
  }

  /**
   * Bridge: caller hands the LSP a BOLT11 invoice + RGB-side
   * parameters; the LSP returns an RGB invoice. The caller shares the
   * RGB invoice with their sender; once the RGB transfer settles, the
   * LSP pays the BOLT11 invoice. Caller monitors completion via its
   * own RLN node's invoice status.
   * Response keys are normalized to camelCase across the public client.
   *
   * @param {object} params - Lightning-to-RGB bridge request.
   * @param {string} params.lnInvoice - BOLT11 invoice paid by the LSP.
   * @param {object} params.rgb - RGB invoice parameters.
   * @param {string} [params.rgb.assetId] - RGB asset ID. Omit to ask the LSP
   *   to resolve the canonical on-chain counterpart of the Lightning asset.
   * @param {string} [params.rgb.assignment] - RGB assignment kind. Defaults to
   *   `Any`.
   * @param {number} [params.rgb.durationSeconds] - RGB invoice lifetime in
   *   seconds.
   * @param {number} [params.rgb.minConfirmations] - Requested confirmation
   *   floor. The LSP may apply its own policy.
   * @param {boolean} [params.rgb.witness] - Whether to request a witness
   *   invoice. Defaults to `false`.
   * @param {number} [params.timeoutMs] - Override the constructor's timeout in
   *   milliseconds.
   * @returns {Promise<{lnInvoice:string, rgbInvoice:string, mappingId:number}>} - Normalized
   *   bridge response.
   * @throws {TypeError} - If required inputs or integer fields are invalid.
   * @throws {LspError} - If the bridge request fails.
   */
  async lightningReceive ({ lnInvoice, rgb, timeoutMs, signal } = {}) {
    const invoice = canonicalInvoice(lnInvoice, 'LspClient.lightningReceive: lnInvoice')
    if (!rgb || typeof rgb !== 'object' || Array.isArray(rgb)) {
      throw new TypeError('LspClient.lightningReceive: rgb params required')
    }
    const body = {
      ln_invoice: invoice,
      rgb_invoice: snakeCaseRgbParams(rgb)
    }
    return camelCaseLspResponse(await this._req('POST', '/lightning_receive', body, { timeoutMs, signal }))
  }

  /** Submit and strictly validate a Lightning-to-RGB bridge response. */
  async lightningReceiveVerified (params = {}) {
    return parseLightningReceive(await this.lightningReceive(params))
  }

  /**
   * Ask the LSP to relay a third-party RGB BOLT11 through a HODL invoice.
   * The caller must decode and verify both invoices before paying.
   *
   * @param {object} params
   * @param {string} params.invoice - Third-party delivery invoice.
   * @param {string} [params.payWithAssetId] - Asset used for the funding leg.
   * @param {number} [params.timeoutMs] - Per-call timeout.
   * @param {AbortSignal} [params.signal] - Caller cancellation signal.
   * @returns {Promise<object>} - Validated relay quote.
   */
  async lightningSend ({ invoice, payWithAssetId, timeoutMs, signal } = {}) {
    const target = canonicalInvoice(invoice, 'LspClient.lightningSend: invoice')
    const body = { invoice: target }
    if (payWithAssetId !== undefined) {
      body.pay_with_asset_id = canonicalAssetId(
        payWithAssetId,
        'LspClient.lightningSend: payWithAssetId'
      )
    }
    return parseLightningSend(
      await this._req('POST', '/lightning_send', body, { timeoutMs, signal })
    )
  }

  /**
   * Read the durable LSP state for a Lightning relay by payment hash.
   *
   * @param {string} paymentHash - 32-byte payment hash in hex.
   * @param {object} [opts] - Per-call timeout/cancellation options.
   * @returns {Promise<object>} - Validated relay status.
   */
  async lightningSendStatus (paymentHash, opts = {}) {
    const hash = typeof paymentHash === 'string' ? paymentHash.trim().toLowerCase() : ''
    if (!/^[0-9a-f]{64}$/.test(hash)) {
      throw new TypeError('LspClient.lightningSendStatus: paymentHash must be 32-byte hexadecimal')
    }
    const result = parseLightningSendStatus(
      await this._req('GET', `/lightning_send/${encodeURIComponent(hash)}`, undefined, opts)
    )
    if (result.paymentHash !== hash) {
      throw new LspProtocolError(
        '/lightning_send/{payment_hash}',
        'payment_hash',
        'the payment hash requested by the caller'
      )
    }
    return result
  }

  // ---------------------------------------------------------------------------

  async _req (method, path, body, opts) {
    const url = `${this._base}${path}`
    const callTimeoutMs = opts?.timeoutMs === undefined
      ? this._timeoutMs
      : parseTimeoutMs(opts.timeoutMs, 'LspClient request timeoutMs')
    const canRetry = opts?.retry !== false && IDEMPOTENT_METHODS.has(method) && this._maxRetries > 0
    // attempt 0 is the original; subsequent attempts are retries.
    // Backoff: 250ms, 500ms, 1000ms, …  (exponential, doubled per try).
    for (let attempt = 0; ; attempt++) {
      if (opts?.signal?.aborted) {
        throw new LspError(path, 0, '', abortCause(opts.signal, 'LSP request aborted'))
      }
      const requestSignal = composeRequestSignal(this._timeoutSignal(callTimeoutMs), opts?.signal)
      const init = {
        method,
        redirect: 'error',
        headers: {
          Accept: 'application/json',
          ...this._headers
        },
        signal: requestSignal.signal
      }
      if (body !== undefined && body !== null) {
        init.headers['Content-Type'] = 'application/json'
        init.body = JSON.stringify(body)
      }

      let res
      try {
        res = await this._fetch(url, init)
        assertNoRedirect(res, url, path)
      } catch (cause) {
        requestSignal.cleanup()
        if (cause instanceof LspError) throw cause
        // Transport-level failure (DNS, TCP reset, abort). Retry the
        // idempotent class — these are exactly the case where a 5xx
        // upstream proxy can't even respond, and a backoff is the
        // right fix.
        if (canRetry && !opts?.signal?.aborted && attempt < this._maxRetries) {
          await wait(backoffMs(attempt), opts?.signal)
          continue
        }
        throw new LspError(path, 0, '', cause)
      }

      let text
      try {
        text = await readResponseText(res, path)
      } finally {
        requestSignal.cleanup()
      }

      if (!res.ok) {
        if (canRetry && RETRY_STATUSES.has(res.status) && attempt < this._maxRetries) {
          await wait(backoffMs(attempt), opts?.signal)
          continue
        }
        throw new LspError(path, res.status, text.trim())
      }
      if (text.length === 0) return null
      try {
        return JSON.parse(text)
      } catch (cause) {
        throw new LspError(path, res.status, `invalid JSON: ${text.slice(0, 200)}`, cause)
      }
    }
  }

  /**
   * Build a timeout signal without changing the SDK's historic runtime floor.
   * Caller cancellation is composed separately by `_req`.
   *
   * @param {number} timeoutMs
   * @returns {AbortSignal|undefined}
   */
  _timeoutSignal (timeoutMs) {
    const ms = timeoutMs === undefined
      ? this._timeoutMs
      : parseTimeoutMs(timeoutMs, 'LspClient request timeoutMs')
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      return AbortSignal.timeout(ms)
    }
    if (typeof AbortController !== 'undefined') {
      const controller = new AbortController()
      setTimeout(
        () => controller.abort(new Error(`LSP request timed out after ${ms}ms`)),
        ms
      ).unref?.()
      return controller.signal
    }
    return undefined
  }
}

function parseTimeoutMs (value, label) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > MAX_TIMEOUT_MS) {
    throw new TypeError(`${label} must be an integer from 1 to ${MAX_TIMEOUT_MS}`)
  }
  return value
}

function parseRetryCount (value, label) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > MAX_RETRIES) {
    throw new TypeError(`${label} must be an integer from 0 to ${MAX_RETRIES}`)
  }
  return value
}

function wait (ms, signal) {
  if (signal?.aborted) return Promise.reject(abortCause(signal, 'LSP request aborted'))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(abortCause(signal, 'LSP request aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
function backoffMs (attempt) { return RETRY_BASE_MS * Math.pow(2, attempt) }

function composeRequestSignal (timeoutSignal, callerSignal) {
  if (!timeoutSignal) return { signal: callerSignal, cleanup: () => {} }
  if (!callerSignal) return { signal: timeoutSignal, cleanup: () => {} }
  if (typeof AbortController === 'undefined') {
    return { signal: callerSignal, cleanup: () => {} }
  }

  const controller = new AbortController()
  const onTimeout = () => controller.abort(abortCause(timeoutSignal, 'LSP request timed out'))
  const onCallerAbort = () => controller.abort(abortCause(callerSignal, 'LSP request aborted'))
  timeoutSignal.addEventListener('abort', onTimeout, { once: true })
  callerSignal.addEventListener('abort', onCallerAbort, { once: true })
  return {
    signal: controller.signal,
    cleanup: () => {
      timeoutSignal.removeEventListener('abort', onTimeout)
      callerSignal.removeEventListener('abort', onCallerAbort)
    }
  }
}

function abortCause (signal, fallback) {
  return signal && 'reason' in signal && signal.reason !== undefined
    ? signal.reason
    : new Error(fallback)
}

async function readResponseText (res, path) {
  const declaredLength = res?.headers?.get?.('content-length')
  if (declaredLength !== null && declaredLength !== undefined && declaredLength !== '') {
    if (!/^(0|[1-9][0-9]*)$/.test(declaredLength)) {
      throw new LspError(path, res.status, 'invalid Content-Length response header')
    }
    const byteLength = BigInt(declaredLength)
    if (byteLength > BigInt(MAX_RESPONSE_BYTES)) {
      throw new LspError(
        path,
        res.status,
        `response too large (${declaredLength} bytes; maximum ${MAX_RESPONSE_BYTES})`
      )
    }
  }

  const body = res && res.body
  if (!body || typeof body.getReader !== 'function') {
    const text = await res.text()
    assertResponseSize(path, res.status, new TextEncoder().encode(text).byteLength)
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
        assertResponseSize(path, res.status, byteLength)
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

function assertResponseSize (path, status, byteLength) {
  if (byteLength > MAX_RESPONSE_BYTES) {
    throw new LspError(
      path,
      status,
      `response too large (${byteLength} bytes; maximum ${MAX_RESPONSE_BYTES})`
    )
  }
}

function assertNoRedirect (response, requestedUrl, path) {
  const finalUrl = typeof response?.url === 'string' && response.url.length > 0
    ? response.url
    : requestedUrl
  if (response?.redirected === true || finalUrl !== requestedUrl) {
    throw new LspError(path, Number(response?.status) || 0, 'redirected responses are not accepted')
  }
}

function isNonEmptyString (v) {
  return typeof v === 'string' && v.length > 0
}

function appendAssetQuery (params, opts, context) {
  const hasAssetId = opts.assetId !== undefined
  const hasAssetAmount = opts.assetAmount !== undefined
  if (hasAssetId !== hasAssetAmount) {
    throw new TypeError(`${context}: assetId and assetAmount must be set together`)
  }
  if (!hasAssetId) return

  if (typeof opts.assetId !== 'string' || opts.assetId.length === 0 || opts.assetId !== opts.assetId.trim()) {
    throw new TypeError(`${context}: assetId must be a non-empty trimmed string`)
  }
  const amount = toUint64String(opts.assetAmount, 'assetAmount')
  if (BigInt(amount) === 0n) {
    throw new TypeError(`${context}: assetAmount must be positive`)
  }
  params.set('asset_id', opts.assetId)
  params.set('asset_amount', amount)
}

function appendPathQuery (path, params) {
  const callback = new URL(path, 'http://lsp.invalid')
  for (const [key, value] of params) callback.searchParams.set(key, value)
  return `${callback.pathname}${callback.search}`
}
