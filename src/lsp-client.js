// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
'use strict'

import {
  camelCaseLspResponse,
  snakeCaseLnParams,
  snakeCaseRgbParams,
  toUint64String
} from './lsp-utils.js'

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
  constructor (endpoint, status, body, cause) {
    const head = `LSP ${endpoint}`
    const msg = status
      ? `${head} → HTTP ${status}: ${body}`
      : `${head} → ${cause?.message ?? 'request failed'}`
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

/** Max response body we'll buffer (1 MiB). Mirrors the LSP's own cap. */
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
const RETRY_BASE_MS = 250

/**
 * Hostnames that are always allowed over plain HTTP (mirrors RLN VSS
 * allow-http loopback rule). `10.0.2.2` is the Android emulator's
 * host-loopback alias.
 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '10.0.2.2'])

export class LspClient {
  /**
   * @param {object} opts
   * @param {string} opts.baseUrl       Origin of the LSP API, e.g. `https://lsp.utexo.io`.
   *                                    Trailing slash optional; we normalise.
   * @param {number} [opts.timeoutMs]   Per-request timeout. Default 15 s. Can be
   *                                    overridden per call by passing `timeoutMs` to
   *                                    the individual method (e.g. `health({ timeoutMs: 2000 })`).
   * @param {typeof fetch} [opts.fetch] Override the global `fetch` (testing / proxies).
   * @param {Record<string,string>} [opts.defaultHeaders]
   *                                    Headers merged into every request. Useful for
   *                                    operator-provided API keys once the LSP grows them.
   * @param {boolean} [opts.allowHttp=false]
   *                                    Permit plain `http://` for non-loopback hosts.
   *                                    Off by default — production deployments should
   *                                    use https only. Loopback hosts (localhost,
   *                                    127.0.0.1, ::1, 10.0.2.2) are always allowed.
   *                                    Mirrors RLN's `vssAllowHttp` knob.
   * @param {number} [opts.maxRetries=3] How many 5xx/429 retries before throwing. Set
   *                                    to 0 to disable retries. Only idempotent methods
   *                                    (GET/HEAD/OPTIONS/PUT/DELETE) are retried —
   *                                    POST calls fail-fast since the LSP doesn't yet
   *                                    accept idempotency keys.
   */
  constructor ({ baseUrl, timeoutMs = DEFAULT_TIMEOUT_MS, fetch: fetchImpl, defaultHeaders, allowHttp = false, maxRetries = DEFAULT_RETRIES } = {}) {
    if (typeof baseUrl !== 'string' || baseUrl.length === 0) {
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
    if (parsedUrl.protocol === 'http:' && !allowHttp && !LOOPBACK_HOSTS.has(parsedUrl.hostname)) {
      throw new Error(
        'LspClient: plain http:// is only allowed for loopback hosts; ' +
        `got '${parsedUrl.hostname}'. Pass allowHttp:true to opt in for ` +
        'non-loopback hosts (regtest staging, etc.).'
      )
    }
    this._base = normalized
    this._timeoutMs = Math.max(1, Number(timeoutMs) || DEFAULT_TIMEOUT_MS)
    this._maxRetries = Math.max(0, Number.isFinite(maxRetries) ? Math.trunc(maxRetries) : DEFAULT_RETRIES)
    this._fetch = fetcher
    this._headers = { ...(defaultHeaders ?? {}) }
  }

  get baseUrl () { return this._base }

  /**
   * Liveness probe. Cheap; safe to call every few seconds.
   * @param {object} [opts]
   * @param {number} [opts.timeoutMs] Override the constructor-default timeout.
   */
  health (opts = {}) { return this._req('GET', '/health', undefined, opts) }

  /**
   * Returns the LSP's view of its upstream RLN node (pubkey, channel summary, etc).
   * @param {object} [opts]
   * @param {number} [opts.timeoutMs]
   */
  getInfo (opts = {}) { return this._req('GET', '/get_info', undefined, opts) }

  /**
   * LUD-06 discovery for a Lightning Address hosted by this LSP.
   * @param {string} username The local-part of `user@host` (no '@', no host).
   * @param {object} [opts]
   * @param {number} [opts.timeoutMs]
   */
  lnurlDiscovery (username, opts = {}) {
    if (!isNonEmptyString(username)) throw new TypeError('LspClient.lnurlDiscovery: username required')
    return this._req('GET', `/.well-known/lnurlp/${encodeURIComponent(username)}`, undefined, opts)
  }

  /**
   * LUD-06 callback. Returns `{ pr, routes }`. The wallet pays `pr`
   * through its own RLN node.
   * @param {string} username
   * @param {bigint|number|string} amountMsat
   * @param {object} [opts]
   * @param {string} [opts.assetId]     Optional RGB asset filter the LSP may honour.
   * @param {bigint|number|string} [opts.assetAmount] Optional RGB amount.
   * @param {number} [opts.timeoutMs]
   */
  lnurlCallback (username, amountMsat, opts = {}) {
    if (!isNonEmptyString(username)) throw new TypeError('LspClient.lnurlCallback: username required')
    const params = new URLSearchParams()
    params.set('amount', toUint64String(amountMsat, 'amountMsat'))
    if (opts.assetId !== undefined) params.set('asset_id', String(opts.assetId))
    if (opts.assetAmount !== undefined) params.set('asset_amount', toUint64String(opts.assetAmount, 'assetAmount'))
    return this._req('GET', `/pay/callback/${encodeURIComponent(username)}?${params.toString()}`, undefined, opts)
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
   * @param {string} username                       Local-part of `user@host`.
   * @param {bigint|number|string} amountMsat
   * @param {object} [opts]
   * @param {string} [opts.assetId]
   * @param {bigint|number|string} [opts.assetAmount]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<{ pr:string, routes:unknown[], status?:string, reason?:string }>}
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
    if (opts.assetId !== undefined) params.set('asset_id', String(opts.assetId))
    if (opts.assetAmount !== undefined) params.set('asset_amount', toUint64String(opts.assetAmount, 'assetAmount'))
    const sep = cbPath.includes('?') ? '&' : '?'
    return this._req('GET', `${cbPath}${sep}${params.toString()}`, undefined, opts)
  }

  /**
   * Resolve the auto-assigned Lightning Address (`{ username, domain }`)
   * the LSP minted for a node pubkey — i.e. the offline-receive address
   * created as a side effect of `apayNew` / `async_order/new`. Give the
   * resulting `username@domain` to senders.
   *
   * Mirrors `@utexo/rgb-sdk-rn`'s
   * `UtexoLSPClient.getLightningAddressByPubkey`.
   *
   * @param {string} peerPubkey  33-byte compressed node pubkey (hex).
   * @param {object} [opts]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<{ username:string, domain:string }>}
   */
  getLightningAddressByPubkey (peerPubkey, opts = {}) {
    const pk = typeof peerPubkey === 'string' ? peerPubkey.trim() : ''
    if (pk.length === 0) throw new TypeError('LspClient.getLightningAddressByPubkey: peerPubkey required')
    return this._req('GET', `/lightning_address/by_pubkey/${encodeURIComponent(pk)}`, undefined, opts)
  }

  /**
   * Reduce an LSP-advertised callback URL to a path (+query+hash) rooted
   * at this client's `baseUrl`. Keeps the second LUD-06 hop on the same
   * origin so it inherits the client's retry/timeout config and dodges
   * unreachable internal hosts. Falls back to the raw string if it can't
   * be parsed.
   * @private
   */
  _rewriteCallbackToPath (callbackUrl) {
    try {
      const cb = new URL(callbackUrl, this._base)
      return `${cb.pathname}${cb.search}${cb.hash}`
    } catch {
      return callbackUrl.startsWith('/') ? callbackUrl : `/${callbackUrl}`
    }
  }

  /**
   * Bridge: caller hands the LSP an RGB invoice + LN-side parameters;
   * the LSP returns a BOLT11 invoice for the caller to pay. Once paid,
   * the LSP runs `sendrgb` to the recipient embedded in the RGB
   * invoice. Caller monitors completion via its own RLN node.
   *
   * @param {object} params
   * @param {string} params.rgbInvoice
   * @param {object} params.ln
   * @param {bigint|number} params.ln.amtMsat
   * @param {number} params.ln.expirySec
   * @param {string} [params.ln.assetId]
   * @param {bigint|number} [params.ln.assetAmount]
   * @param {string} [params.ln.descriptionHash]
   * @param {string} [params.ln.paymentHash]
   * @param {number} [params.ln.minFinalCltvExpiryDelta]
   * @returns {Promise<{rgbInvoice:string, lnInvoice:string, mappingId:number}>}
   *   Note: response is normalized to camelCase to match
   *   `lightningReceive()` and the helpers in `lsp-helpers.js`. The LSP
   *   itself returns snake_case JSON; we remap at this layer so the
   *   public surface of LspClient is uniformly camelCase.
   */
  async onchainSend ({ rgbInvoice, ln, timeoutMs } = {}) {
    if (!isNonEmptyString(rgbInvoice)) throw new TypeError('LspClient.onchainSend: rgbInvoice required')
    if (!ln || typeof ln !== 'object') throw new TypeError('LspClient.onchainSend: ln params required')
    const body = {
      rgb_invoice: rgbInvoice,
      lninvoice: snakeCaseLnParams(ln)
    }
    const raw = await this._req('POST', '/onchain_send', body, { timeoutMs })
    return camelCaseLspResponse(raw)
  }

  /**
   * Bridge: caller hands the LSP a BOLT11 invoice + RGB-side
   * parameters; the LSP returns an RGB invoice. The caller shares the
   * RGB invoice with their sender; once the RGB transfer settles, the
   * LSP pays the BOLT11 invoice. Caller monitors completion via its
   * own RLN node's invoice status.
   *
   * @param {object} params
   * @param {string} params.lnInvoice
   * @param {object} params.rgb
   * @param {string} params.rgb.assetId
   * @param {string} [params.rgb.assignment]   default 'Any'
   * @param {number} [params.rgb.durationSeconds]
   * @param {number} [params.rgb.minConfirmations] Backend-controlled; LSP may ignore.
   * @param {boolean} [params.rgb.witness]     default false
   * @returns {Promise<{lnInvoice:string, rgbInvoice:string, mappingId:number}>}
   *   Normalized to camelCase. The LSP returns snake_case JSON; we
   *   remap here so the public surface of LspClient is uniform.
   */
  async lightningReceive ({ lnInvoice, rgb, timeoutMs } = {}) {
    if (!isNonEmptyString(lnInvoice)) throw new TypeError('LspClient.lightningReceive: lnInvoice required')
    if (!rgb || typeof rgb !== 'object') throw new TypeError('LspClient.lightningReceive: rgb params required')
    if (!isNonEmptyString(rgb.assetId)) throw new TypeError('LspClient.lightningReceive: rgb.assetId required')
    const body = {
      ln_invoice: lnInvoice,
      rgb_invoice: snakeCaseRgbParams(rgb)
    }
    const raw = await this._req('POST', '/lightning_receive', body, { timeoutMs })
    return camelCaseLspResponse(raw)
  }

  // ---------------------------------------------------------------------------

  async _req (method, path, body, opts) {
    const url = `${this._base}${path}`
    const callTimeoutMs = opts && Number.isFinite(Number(opts.timeoutMs)) && Number(opts.timeoutMs) > 0
      ? Math.trunc(Number(opts.timeoutMs))
      : this._timeoutMs
    const canRetry = IDEMPOTENT_METHODS.has(method) && this._maxRetries > 0
    // attempt 0 is the original; subsequent attempts are retries.
    // Backoff: 250ms, 500ms, 1000ms, …  (exponential, doubled per try).
    for (let attempt = 0; ; attempt++) {
      const init = {
        method,
        headers: {
          Accept: 'application/json',
          ...this._headers
        },
        signal: this._timeoutSignal(callTimeoutMs)
      }
      if (body !== undefined && body !== null) {
        init.headers['Content-Type'] = 'application/json'
        init.body = JSON.stringify(body)
      }

      let res
      try {
        res = await this._fetch(url, init)
      } catch (cause) {
        // Transport-level failure (DNS, TCP reset, abort). Retry the
        // idempotent class — these are exactly the case where a 5xx
        // upstream proxy can't even respond, and a backoff is the
        // right fix.
        if (canRetry && attempt < this._maxRetries) {
          await wait(backoffMs(attempt))
          continue
        }
        throw new LspError(path, 0, '', cause)
      }

      // Read at most MAX_RESPONSE_BYTES. WHATWG Response doesn't expose
      // a hard byte cap, so we accept the body in full but reject
      // anything suspiciously large. Avoids OOM on a misconfigured LSP
      // that returns megabytes of HTML.
      const text = await res.text()
      if (text.length > MAX_RESPONSE_BYTES) {
        throw new LspError(path, res.status, `response too large (${text.length} bytes)`)
      }

      if (!res.ok) {
        if (canRetry && RETRY_STATUSES.has(res.status) && attempt < this._maxRetries) {
          await wait(backoffMs(attempt))
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
   * `AbortSignal.timeout()` is supported in Bare (via bare-abort-controller)
   * and Node ≥17. Falls back to a manually plumbed AbortController for
   * older runtimes — keeps the package portable without bumping the
   * `engines.node` floor.
   *
   * @param {number} timeoutMs  Per-call timeout override.
   */
  _timeoutSignal (timeoutMs) {
    const ms = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : this._timeoutMs
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      return AbortSignal.timeout(ms)
    }
    if (typeof AbortController !== 'undefined') {
      const ctrl = new AbortController()
      setTimeout(() => ctrl.abort(new Error(`LSP request timed out after ${ms}ms`)), ms).unref?.()
      return ctrl.signal
    }
    return undefined
  }
}

function wait (ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }
function backoffMs (attempt) { return RETRY_BASE_MS * Math.pow(2, attempt) }

function isNonEmptyString (v) {
  return typeof v === 'string' && v.length > 0
}
