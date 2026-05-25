// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
'use strict'

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
    if (cause) this.cause = cause
  }
}

/** Default request timeout if the caller doesn't override. */
const DEFAULT_TIMEOUT_MS = 15_000

/** Max response body we'll buffer (1 MiB). Mirrors the LSP's own cap. */
const MAX_RESPONSE_BYTES = 1 << 20

export class LspClient {
  /**
   * @param {object} opts
   * @param {string} opts.baseUrl       Origin of the LSP API, e.g. `https://lsp.utexo.io`.
   *                                    Trailing slash optional; we normalise.
   * @param {number} [opts.timeoutMs]   Per-request timeout. Default 15 s.
   * @param {typeof fetch} [opts.fetch] Override the global `fetch` (testing / proxies).
   * @param {Record<string,string>} [opts.defaultHeaders]
   *                                    Headers merged into every request. Useful for
   *                                    operator-provided API keys once the LSP grows them.
   */
  constructor ({ baseUrl, timeoutMs = DEFAULT_TIMEOUT_MS, fetch: fetchImpl, defaultHeaders } = {}) {
    if (typeof baseUrl !== 'string' || baseUrl.length === 0) {
      throw new TypeError('LspClient: baseUrl is required')
    }
    const fetcher = fetchImpl ?? globalThis.fetch
    if (typeof fetcher !== 'function') {
      throw new TypeError('LspClient: no fetch available; pass opts.fetch or run in an environment that exposes global fetch (Bare via bare-fetch/global, Node ≥18)')
    }
    this._base = baseUrl.replace(/\/+$/, '')
    this._timeoutMs = Math.max(1, Number(timeoutMs) || DEFAULT_TIMEOUT_MS)
    this._fetch = fetcher
    this._headers = { ...(defaultHeaders ?? {}) }
  }

  get baseUrl () { return this._base }

  /** Liveness probe. Cheap; safe to call every few seconds. */
  health () { return this._req('GET', '/health') }

  /** Returns the LSP's view of its upstream RLN node (pubkey, channel summary, etc). */
  getInfo () { return this._req('GET', '/get_info') }

  /**
   * LUD-06 discovery for a Lightning Address hosted by this LSP.
   * @param {string} username The local-part of `user@host` (no '@', no host).
   */
  lnurlDiscovery (username) {
    if (!isNonEmptyString(username)) throw new TypeError('LspClient.lnurlDiscovery: username required')
    return this._req('GET', `/.well-known/lnurlp/${encodeURIComponent(username)}`)
  }

  /**
   * LUD-06 callback. Returns `{ pr, routes }`. The wallet pays `pr`
   * through its own RLN node.
   * @param {string} username
   * @param {bigint|number|string} amountMsat
   * @param {object} [opts]
   * @param {string} [opts.assetId]     Optional RGB asset filter the LSP may honour.
   * @param {bigint|number|string} [opts.assetAmount] Optional RGB amount.
   */
  lnurlCallback (username, amountMsat, opts = {}) {
    if (!isNonEmptyString(username)) throw new TypeError('LspClient.lnurlCallback: username required')
    const params = new URLSearchParams()
    params.set('amount', toIntString(amountMsat, 'amountMsat'))
    if (opts.assetId !== undefined) params.set('asset_id', String(opts.assetId))
    if (opts.assetAmount !== undefined) params.set('asset_amount', toIntString(opts.assetAmount, 'assetAmount'))
    return this._req('GET', `/pay/callback/${encodeURIComponent(username)}?${params.toString()}`)
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
   * @returns {Promise<{rgb_invoice:string, ln_invoice:string, mapping_id:number}>}
   */
  onchainSend ({ rgbInvoice, ln } = {}) {
    if (!isNonEmptyString(rgbInvoice)) throw new TypeError('LspClient.onchainSend: rgbInvoice required')
    if (!ln || typeof ln !== 'object') throw new TypeError('LspClient.onchainSend: ln params required')
    const body = {
      rgb_invoice: rgbInvoice,
      lninvoice: snakeCaseLnParams(ln)
    }
    return this._req('POST', '/onchain_send', body)
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
   * @returns {Promise<{ln_invoice:string, rgb_invoice:string, mapping_id:number}>}
   */
  lightningReceive ({ lnInvoice, rgb } = {}) {
    if (!isNonEmptyString(lnInvoice)) throw new TypeError('LspClient.lightningReceive: lnInvoice required')
    if (!rgb || typeof rgb !== 'object') throw new TypeError('LspClient.lightningReceive: rgb params required')
    if (!isNonEmptyString(rgb.assetId)) throw new TypeError('LspClient.lightningReceive: rgb.assetId required')
    const body = {
      ln_invoice: lnInvoice,
      rgb_invoice: snakeCaseRgbParams(rgb)
    }
    return this._req('POST', '/lightning_receive', body)
  }

  // ---------------------------------------------------------------------------

  async _req (method, path, body) {
    const url = `${this._base}${path}`
    const init = {
      method,
      headers: {
        Accept: 'application/json',
        ...this._headers
      },
      signal: this._timeoutSignal()
    }
    if (body !== undefined && body !== null) {
      init.headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(body)
    }

    let res
    try {
      res = await this._fetch(url, init)
    } catch (cause) {
      throw new LspError(path, 0, '', cause)
    }

    // Read at most MAX_RESPONSE_BYTES. WHATWG Response doesn't expose a
    // hard byte cap, so we accept the body in full but reject anything
    // suspiciously large. Avoids OOM on a misconfigured LSP that
    // returns megabytes of HTML.
    const text = await res.text()
    if (text.length > MAX_RESPONSE_BYTES) {
      throw new LspError(path, res.status, `response too large (${text.length} bytes)`)
    }

    if (!res.ok) {
      throw new LspError(path, res.status, text.trim())
    }
    if (text.length === 0) return null
    try {
      return JSON.parse(text)
    } catch (cause) {
      throw new LspError(path, res.status, `invalid JSON: ${text.slice(0, 200)}`, cause)
    }
  }

  /**
   * `AbortSignal.timeout()` is supported in Bare (via bare-abort-controller)
   * and Node ≥17. Falls back to a manually plumbed AbortController for
   * older runtimes — keeps the package portable without bumping the
   * `engines.node` floor.
   */
  _timeoutSignal () {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      return AbortSignal.timeout(this._timeoutMs)
    }
    if (typeof AbortController !== 'undefined') {
      const ctrl = new AbortController()
      setTimeout(() => ctrl.abort(new Error(`LSP request timed out after ${this._timeoutMs}ms`)), this._timeoutMs).unref?.()
      return ctrl.signal
    }
    return undefined
  }
}

// ---------------------------------------------------------------------------
// Shape adapters
// ---------------------------------------------------------------------------

function snakeCaseLnParams (ln) {
  const out = {}
  if (ln.amtMsat !== undefined) out.amt_msat = toUint64Json(ln.amtMsat, 'ln.amtMsat')
  if (ln.expirySec !== undefined) out.expiry_sec = toUint32(ln.expirySec, 'ln.expirySec')
  if (ln.assetId !== undefined) out.asset_id = String(ln.assetId)
  if (ln.assetAmount !== undefined) out.asset_amount = toUint64Json(ln.assetAmount, 'ln.assetAmount')
  if (ln.descriptionHash !== undefined) out.description_hash = String(ln.descriptionHash)
  if (ln.paymentHash !== undefined) out.payment_hash = String(ln.paymentHash)
  if (ln.minFinalCltvExpiryDelta !== undefined) {
    out.min_final_cltv_expiry_delta = toUint32(ln.minFinalCltvExpiryDelta, 'ln.minFinalCltvExpiryDelta')
  }
  return out
}

function snakeCaseRgbParams (rgb) {
  const out = {
    asset_id: rgb.assetId,
    min_confirmations: rgb.minConfirmations !== undefined ? toUint32(rgb.minConfirmations, 'rgb.minConfirmations') : 1,
    witness: !!rgb.witness
  }
  if (rgb.assignment !== undefined) out.assignment = String(rgb.assignment)
  if (rgb.durationSeconds !== undefined) out.duration_seconds = toUint32(rgb.durationSeconds, 'rgb.durationSeconds')
  return out
}

function isNonEmptyString (v) {
  return typeof v === 'string' && v.length > 0
}

function toIntString (v, field) {
  if (typeof v === 'bigint' && v >= 0n) return v.toString()
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return Math.trunc(v).toString()
  if (typeof v === 'string' && /^\d+$/.test(v)) return v
  throw new TypeError(`${field} must be a non-negative integer`)
}

/**
 * The Go side uses uint64 fields. JS numbers lose precision above 2^53.
 * Emit bigint values as numeric JSON (rgb-lightning-node accepts both
 * 1234 and "1234" but we prefer numeric for amt_msat to match the
 * canonical shape). For values above 2^53 we drop to strings — RLN
 * tolerates this on amt_msat (see daemon JsonLnInvoiceRequest).
 */
function toUint64Json (v, field) {
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 0) throw new TypeError(`${field} must be ≥ 0`)
    return Math.trunc(v)
  }
  if (typeof v === 'bigint') {
    if (v < 0n) throw new TypeError(`${field} must be ≥ 0`)
    return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString()
  }
  if (typeof v === 'string' && /^\d+$/.test(v)) return v
  throw new TypeError(`${field} must be a non-negative integer`)
}

function toUint32 (v, field) {
  const n = typeof v === 'bigint' ? Number(v) : Number(v)
  if (!Number.isFinite(n) || n < 0 || n > 0xffffffff || !Number.isInteger(n)) {
    throw new TypeError(`${field} must fit in uint32`)
  }
  return n
}
