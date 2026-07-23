// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
'use strict'

// Composed, stateful LSP flows on top of a WalletAccountRgbLightning +
// an LspClient. Where `lsp-helpers.js` exposes single-shot functions,
// this class bundles the connect → wait-for-channel → receive/send →
// settle lifecycle that a wallet app actually drives, with built-in
// polling, abort support, and per-iteration hooks (e.g. mine a regtest
// block each poll).
//
// API parity with `@utexo/rgb-sdk-rn`'s `UtexoLsp` (src/lsp/UtexoLsp.ts),
// adapted to this module's account surface: our account exposes
// `sync()` (not `syncWallet()`), `createLightningInvoice()` returns
// RLN's `{ invoice }` (not `{ lnInvoice }`), and `getInvoiceStatus()`
// returns `{ status }` (not a bare string). Those shape differences are
// absorbed here so the public method names + semantics match.

import { LspClient } from './lsp-client.js'
import { parseLightningAddress, resolveAddressToInvoice } from './lnurl-pay.js'

/** @typedef {import('./lnurl-pay.js').LnurlPayError} LnurlPayError */
/** @typedef {import('./lsp-client.js').LspError} LspError */

// ── Errors ───────────────────────────────────────────────────────────────────

/** No usable RGB channel for the asset materialised before `timeoutMs`. */
export class LspChannelTimeoutError extends Error {
  /**
   * Create an error for an RGB channel-readiness timeout.
   *
   * @param {string} assetId - RGB asset ID that never obtained a usable
   *   channel.
   * @param {number} elapsedMs - Time spent waiting, in milliseconds.
   */
  constructor (assetId, elapsedMs) {
    super(`No usable RGB channel for ${assetId} after ${Math.round(elapsedMs / 1000)}s`)
    this.name = 'LspChannelTimeoutError'
    this.assetId = assetId
    this.elapsedMs = elapsedMs
  }
}

/** Outbound liquidity on the LSP channel stayed below the requested floor. */
export class LspLiquidityTimeoutError extends Error {
  /**
   * Create an error for an outbound-liquidity timeout.
   *
   * @param {number} minMsat - Required outbound liquidity in millisatoshis.
   * @param {number} elapsedMs - Time spent waiting, in milliseconds.
   * @param {string} peerPubkey - LSP peer public key.
   */
  constructor (minMsat, elapsedMs, peerPubkey) {
    super(`Outbound liquidity for ${peerPubkey} stayed below ${minMsat} msat after ${Math.round(elapsedMs / 1000)}s`)
    this.name = 'LspLiquidityTimeoutError'
    this.minMsat = minMsat
    this.elapsedMs = elapsedMs
    this.peerPubkey = peerPubkey
  }
}

/** Settlement reached a terminal non-success state (Failed / Expired). */
export class LspSettlementError extends Error {
  /**
   * Create an error for terminal non-success settlement.
   *
   * @param {string} step - Settlement step that failed.
   * @param {string} status - Terminal non-success settlement status.
   */
  constructor (step, status) {
    super(`Settlement ended with status "${status}" at step ${step}`)
    this.name = 'LspSettlementError'
    this.step = step
    this.status = status
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build the `pubkey@host:port` string accepted by `connectPeer`.
 *
 * @param {object} peer - LSP peer connection details.
 * @returns {string} - Canonical Lightning peer URI.
 */
export function peerUri (peer) {
  return `${peer.peerPubkey}@${peer.peerHost}:${peer.peerPort}`
}

/**
 * Canonicalise the many status shapes RLN / the LSP emit into the four
 * receive states. Accepts a bare string (`'Succeeded'`) or an object
 * (`{ status }` from `getInvoiceStatus`).
 *
 * @param {string|{status?:string}|null|undefined} raw - Native or LSP status
 *   value.
 * @returns {'Pending'|'Succeeded'|'Failed'|'Expired'} - Canonical receive
 *   status.
 */
export function normalizeReceiveStatus (raw) {
  const s = (typeof raw === 'object' && raw !== null ? raw.status : raw) ?? ''
  const up = String(s).toUpperCase()
  if (up === 'SUCCEEDED' || up === 'SETTLED') return 'Succeeded'
  if (up === 'FAILED') return 'Failed'
  if (up === 'EXPIRED') return 'Expired'
  return 'Pending'
}

const DEFAULT_CHANNEL_TIMEOUT_MS = 120_000
const DEFAULT_SETTLEMENT_TIMEOUT_MS = 60_000
const DEFAULT_POLL_INTERVAL_MS = 2_000

// ── UtexoLsp ─────────────────────────────────────────────────────────────────

export class UtexoLsp {
  /**
   * Create composed LSP flows for one wallet account and one LSP peer.
   *
   * @param {object} account - A `WalletAccountRgbLightning` or compatible
   *   exposing connectPeer, sync, listChannels, createLightningInvoice,
   *   getInvoiceStatus, sendPayment, getNodeInfo, apayNew, listPayments,
   *   claimHodlInvoice.
   * @param {object} peer - LSP peer details: `{ baseUrl, peerPubkey, peerHost,
   *   peerPort, bearerToken?, timeoutMs?, allowHttp? }`.
   * @throws {TypeError} - If the account or peer base URL is missing or
   *   malformed.
   * @throws {Error} - If the LSP client rejects an insecure HTTP origin.
   */
  constructor (account, peer) {
    if (account == null) throw new TypeError('UtexoLsp: account required')
    if (peer == null || typeof peer.baseUrl !== 'string') {
      throw new TypeError('UtexoLsp: peer.baseUrl required')
    }
    this.account = account
    this.peer = peer
    /** Raw HTTP client for one-off LSP calls. @type {LspClient} */
    this.http = new LspClient({
      baseUrl: peer.baseUrl,
      defaultHeaders: peer.bearerToken ? { Authorization: `Bearer ${peer.bearerToken}` } : undefined,
      allowHttp: peer.allowHttp === true,
      timeoutMs: peer.timeoutMs
    })
  }

  // ── 1. Connection ────────────────────────────────────────────────────────────

  /**
   * Connect to the LSP's Lightning node. Idempotent — the account's
   * `connectPeer` already swallows RLN's `Conflict` on a known peer.
   *
   * @returns {Promise<object>} - Account peer-connection result.
   * @throws {Error} - If the account cannot connect to the LSP peer.
   */
  async connect () {
    return this.account.connectPeer(peerUri(this.peer))
  }

  // ── 2. Channel readiness ──────────────────────────────────────────────────────

  /**
   * Poll `listChannels` until a usable RGB channel for `assetId` exists.
   *
   * @param {string} assetId - RGB asset ID to wait for.
   * @param {object} [opts] - Wait options including timeout, poll interval,
   *   abort signal, progress callback, and per-poll hook.
   * @returns {Promise<object>} - Channel readiness details.
   * @throws {LspChannelTimeoutError} - If no usable channel appears before
   *   the deadline.
   * @throws {Error} - If the operation is aborted or account synchronization
   *   fails.
   */
  async waitForChannel (assetId, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_CHANNEL_TIMEOUT_MS
    const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    const deadline = Date.now() + timeoutMs

    while (Date.now() < deadline) {
      this._checkAbort(opts.signal)
      if (opts.onEachPoll) await opts.onEachPoll()
      await this.account.sync()
      const channels = await this._listChannels()
      const match = channels.find((c) => this._isUsableRgbChannel(c, assetId))
      opts.onProgress?.(`channels: ${channels.length} — RGB usable: ${match ? 'yes' : 'no'}`)
      if (match) return this._toChannelReadyInfo(match)
      await this._sleep(pollIntervalMs, opts.signal)
    }
    throw new LspChannelTimeoutError(assetId, timeoutMs)
  }

  // ── 3. Receive RGB over Lightning (POST /lightning_receive) ───────────────────

  /**
   * Lightning → RGB bridge. Mints a LN invoice on this wallet, registers
   * it with the LSP, and returns both invoices. Share `rgbInvoice` with
   * the on-chain sender; the LSP pays `lnInvoice` once the RGB transfer
   * settles.
   *
   * @param {object} opts - Receive request.
   * @param {string} opts.assetId - RGB asset ID to receive.
   * @param {number} [opts.amountSats] - Lightning amount in satoshis. Omit for
   *   an amountless BOLT11 invoice.
   * @param {number} [opts.amountRgb] - RGB units bound to the invoice.
   * @param {number} [opts.expirySeconds] - Invoice lifetime in seconds.
   *   Defaults to `3600`.
   * @returns {Promise<{ lnInvoice:string, rgbInvoice:string, mappingId:string }>} - Paired
   *   invoices and LSP bridge mapping ID.
   * @throws {TypeError} - If `assetId` is missing or malformed.
   * @throws {LspError} - If the LSP bridge request fails.
   * @throws {Error} - If local invoice creation fails or returns no invoice.
   */
  async receiveAsset (opts = {}) {
    if (typeof opts.assetId !== 'string' || opts.assetId.length === 0) {
      throw new TypeError('UtexoLsp.receiveAsset: assetId required')
    }
    const expirySeconds = opts.expirySeconds ?? 3600

    const createdAtMs = Date.now()
    const created = await this.account.createLightningInvoice({
      amountMsat: opts.amountSats != null ? Number(opts.amountSats) * 1000 : undefined,
      expirySec: expirySeconds,
      assetId: opts.assetId,
      assetAmount: opts.amountRgb
    })
    const lnInvoice = created?.invoice ?? created?.lnInvoice
    if (typeof lnInvoice !== 'string' || lnInvoice.length === 0) {
      throw new Error('UtexoLsp.receiveAsset: createLightningInvoice returned no invoice')
    }

    // The LSP validates durationSeconds against the LN invoice's
    // *remaining* lifetime (utexo-lsp EXPIRY_MATCH_TOLERANCE_SEC, ~5s).
    // Invoice creation on a mobile node can take seconds, so send the
    // remaining lifetime — sending the full expiry 400s once creation
    // outlasts the tolerance.
    const elapsedSeconds = Math.round((Date.now() - createdAtMs) / 1000)
    const durationSeconds = Math.max(1, expirySeconds - elapsedSeconds)

    const lr = await this.http.lightningReceive({
      lnInvoice,
      rgb: { assetId: opts.assetId, durationSeconds }
    })
    return { lnInvoice, rgbInvoice: lr.rgbInvoice, mappingId: String(lr.mappingId) }
  }

  // ── 4. Settlement polling ─────────────────────────────────────────────────────

  /**
   * Poll `getInvoiceStatus(lnInvoice)` until terminal.
   *
   * @param {string} lnInvoice - BOLT11 invoice whose settlement is monitored.
   * @param {object} [opts] - Wait options.
   * @returns {Promise<'settled'|'timed_out'>} - Settlement outcome.
   * @throws {LspSettlementError} - If settlement reaches `Failed` or
   *   `Expired`.
   * @throws {Error} - If the operation is aborted or account synchronization
   *   fails.
   */
  async awaitReceiveSettlement (lnInvoice, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_SETTLEMENT_TIMEOUT_MS
    const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    const deadline = Date.now() + timeoutMs

    while (Date.now() < deadline) {
      this._checkAbort(opts.signal)
      await this.account.sync()
      const raw = await this.account.getInvoiceStatus(lnInvoice)
      const status = normalizeReceiveStatus(raw)
      opts.onProgress?.(status)
      if (status === 'Succeeded') return 'settled'
      if (status === 'Failed' || status === 'Expired') {
        throw new LspSettlementError('ln_invoice', status)
      }
      await this._sleep(pollIntervalMs, opts.signal)
    }
    opts.onProgress?.('timeout')
    return 'timed_out'
  }

  // ── 5. Outbound liquidity wait ────────────────────────────────────────────────

  /**
   * Poll until outbound balance on the LSP channel ≥ `minMsat`.
   *
   * @param {number} minMsat - Required outbound liquidity in millisatoshis.
   * @param {object} [opts] - Wait options.
   * @returns {Promise<void>} - Resolves when sufficient liquidity is visible.
   * @throws {LspLiquidityTimeoutError} - If liquidity stays below the floor
   *   until the deadline.
   * @throws {Error} - If the operation is aborted or account synchronization
   *   fails.
   */
  async waitForOutboundLiquidity (minMsat, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_CHANNEL_TIMEOUT_MS
    const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    const deadline = Date.now() + timeoutMs

    while (Date.now() < deadline) {
      this._checkAbort(opts.signal)
      await this.account.sync()
      const channels = await this._listChannels()
      const lspChan = channels.find((c) =>
        this._raw(c, 'peerPubkey', 'peer_pubkey') === this.peer.peerPubkey &&
        Boolean(this._raw(c, 'isUsable', 'is_usable'))
      )
      const outbound = Number(this._outboundMsat(lspChan))
      opts.onProgress?.(`outbound: ${outbound} msat (need ${minMsat})`)
      if (outbound >= minMsat) return
      await this._sleep(pollIntervalMs, opts.signal)
    }
    throw new LspLiquidityTimeoutError(minMsat, timeoutMs, this.peer.peerPubkey)
  }

  // ── 6. Send RGB via LSP (POST /onchain_send) ──────────────────────────────────

  /**
   * RGB → Lightning bridge. Submits the recipient's on-chain RGB invoice
   * to the LSP, then pays the LN invoice the LSP returns. The LSP runs
   * `sendrgb` to the recipient once the LN payment settles.
   *
   * @param {object} opts - Send request.
   * @param {string} opts.rgbInvoice - Recipient's on-chain RGB invoice.
   * @param {object} [opts.ln] - Lightning parameters including `amtMsat`,
   *   `expirySec`, `assetId`, and `assetAmount`.
   * @returns {Promise<{ lnInvoice:string, rgbInvoice:string, mappingId:string, sendResult:any }>} - Paired
   *   invoices, mapping ID, and account payment result.
   * @throws {TypeError} - If `rgbInvoice` or Lightning parameters are invalid.
   * @throws {LspError} - If the LSP bridge request fails.
   * @throws {Error} - If the account payment fails.
   */
  async sendAsset (opts = {}) {
    if (typeof opts.rgbInvoice !== 'string' || opts.rgbInvoice.length === 0) {
      throw new TypeError('UtexoLsp.sendAsset: rgbInvoice required')
    }
    const issued = await this.http.onchainSend({ rgbInvoice: opts.rgbInvoice, ln: opts.ln })
    const sendResult = await this.account.sendPayment({ invoice: issued.lnInvoice })
    return {
      lnInvoice: issued.lnInvoice,
      rgbInvoice: issued.rgbInvoice,
      mappingId: String(issued.mappingId),
      sendResult
    }
  }

  // ── 7. Pay a Lightning Address ────────────────────────────────────────────────

  /**
   * Resolve a Lightning Address and pay it. Addresses on this LSP's host
   * use `resolveAddress` first (for internal/emulator host rewriting) and
   * fall back to the shared LNURL resolver. External hosts go directly
   * through the shared resolver so a same-named LSP user cannot be paid
   * by mistake.
   *
   * @param {object} opts - Lightning Address payment request.
   * @param {string} opts.address - Lightning Address in `user@host` form.
   * @param {bigint|number|string} opts.amtMsat - Payment amount in
   *   millisatoshis.
   * @param {object} [opts.asset] - Optional RGB asset ID and amount.
   * @param {boolean} [opts.allowCrossHostCallback] - Permit delegated LNURL
   *   callbacks on another host. Defaults to `false`.
   * @returns {Promise<{ invoice:string, sendResult:any }>} - Resolved invoice
   *   and account payment result.
   * @throws {TypeError} - If the Lightning Address or uint64 amount is invalid.
   * @throws {LnurlPayError} - If standard LNURL resolution fails.
   * @throws {Error} - If no invoice is returned or the account payment fails.
   */
  async payAddress (opts = {}) {
    const address = opts.address
    let parsed
    try {
      parsed = parseLightningAddress(address, { allowHttp: this.peer.allowHttp === true })
    } catch {
      throw new TypeError(`UtexoLsp.payAddress: invalid Lightning Address "${address}"`)
    }

    let invoice
    let useStandardResolver = parsed.host !== new URL(this.http.baseUrl ?? this.peer.baseUrl).host.toLowerCase()
    if (!useStandardResolver) {
      try {
        const cb = await this.http.resolveAddress(
          parsed.username, opts.amtMsat, { assetId: opts.asset?.assetId, assetAmount: opts.asset?.assetAmount }
        )
        invoice = cb?.pr
      } catch {
        useStandardResolver = true
      }
    }

    if (useStandardResolver) {
      const resolved = await resolveAddressToInvoice(address, opts.amtMsat, {
        allowHttp: this.peer.allowHttp === true,
        allowCrossHostCallback: opts.allowCrossHostCallback === true,
        assetId: opts.asset?.assetId,
        assetAmount: opts.asset?.assetAmount
      })
      invoice = resolved.pr
    }

    if (typeof invoice !== 'string' || invoice.length === 0) {
      throw new Error('UtexoLsp.payAddress: no invoice returned for Lightning Address')
    }
    const sendResult = await this.account.sendPayment({ invoice })
    return { invoice, sendResult }
  }

  // ── 8. Async / offline receive (APay) ─────────────────────────────────────────

  /**
   * Register the async-payment hash pool with this LSP, then read back
   * the auto-assigned Lightning Address for this wallet's pubkey. Call
   * once after first unlock to enable offline receive.
   *
   * @returns {Promise<{ username:string, domain:string, address:string }>} - Auto-assigned
   *   Lightning Address components and full address.
   * @throws {LspError} - If LSP information or address lookup fails.
   * @throws {Error} - If the wallet is locked, the LSP response is malformed,
   *   or APay registration fails.
   */
  async enableLightningAddress () {
    const nodeInfo = await this.account.getNodeInfo()
    const pubkey = String(nodeInfo?.pubkey ?? '')
    if (!pubkey) throw new Error('UtexoLsp.enableLightningAddress: wallet not unlocked (no pubkey)')

    const lspInfo = await this.http.getInfo()
    const lspPubkey = lspInfo?.pubkey
    if (typeof lspPubkey !== 'string' || lspPubkey.length === 0) {
      throw new Error('UtexoLsp.enableLightningAddress: LSP /get_info returned no pubkey')
    }
    await this.account.apayNew(lspPubkey)

    const addr = await this.http.getLightningAddressByPubkey(pubkey)
    return { username: addr.username, domain: addr.domain, address: `${addr.username}@${addr.domain}` }
  }

  // ── 9. Claim pending HODL payments ────────────────────────────────────────────

  /**
   * Find inbound CLAIMABLE/CLAIMING payments and claim each via
   * `claimHodlInvoice`. Use after unlock to settle invoices that arrived
   * while offline.
   *
   * @returns {Promise<Array<{ paymentHash:string, claimed:boolean, error?:string }>>} - Per-payment
   *   claim outcomes.
   */
  async claimPendingPayments () {
    const payments = await this._listPayments()
    const claimable = payments.filter((p) => {
      const s = String(this._raw(p, 'status', 'status') ?? '').toUpperCase()
      return s === 'CLAIMABLE' || s === 'CLAIMING'
    })

    const results = []
    for (const p of claimable) {
      const paymentHash = String(this._raw(p, 'paymentHash', 'payment_hash') ?? '')
      const preimage = String(
        this._raw(p, 'paymentPreimage', 'payment_preimage') ??
        this._raw(p, 'paymentImage', 'payment_image') ?? ''
      )
      try {
        // RLN's claim request is passed through verbatim by the account;
        // include both the hash and preimage under the common key names.
        await this.account.claimHodlInvoice({ payment_hash: paymentHash, payment_preimage: preimage })
        results.push({ paymentHash, claimed: true })
      } catch (err) {
        results.push({ paymentHash, claimed: false, error: err?.message })
      }
    }
    return results
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  async _listChannels () {
    const resp = await this.account.listChannels()
    if (Array.isArray(resp)) return resp
    if (resp && Array.isArray(resp.channels)) return resp.channels
    return []
  }

  async _listPayments () {
    const resp = await this.account.listPayments()
    if (Array.isArray(resp)) return resp
    if (resp && Array.isArray(resp.payments)) return resp.payments
    return []
  }

  _isUsableRgbChannel (c, assetId) {
    return (
      this._raw(c, 'assetId', 'asset_id') === assetId &&
      Boolean(this._raw(c, 'isUsable', 'is_usable') ?? this._raw(c, 'ready', 'ready'))
    )
  }

  _toChannelReadyInfo (c) {
    return {
      channelId: String(this._raw(c, 'channelId', 'channel_id') ?? ''),
      peerPubkey: this.peer.peerPubkey,
      capacitySat: Number(this._raw(c, 'capacitySat', 'capacity_sat') ?? 0),
      outboundBalanceMsat: Number(this._outboundMsat(c)),
      inboundBalanceMsat: Number(this._raw(c, 'inboundBalanceMsat', 'inbound_balance_msat') ?? 0)
    }
  }

  // RLN channel JSON has shifted field names across versions
  // (`outbound_balance_msat` vs `local_balance_msat`); read either.
  _outboundMsat (c) {
    return (
      this._raw(c, 'outboundBalanceMsat', 'outbound_balance_msat') ??
      this._raw(c, 'localBalanceMsat', 'local_balance_msat') ??
      0
    )
  }

  _raw (obj, camel, snake) {
    if (obj == null) return undefined
    return obj[camel] ?? obj[snake]
  }

  _checkAbort (signal) {
    if (signal?.aborted) throw new Error('UtexoLsp: operation aborted')
  }

  _sleep (ms, signal) {
    // Do not unref this timer: it is a deliberate poll-interval wait and
    // must keep the event loop alive until it resolves or aborts.
    return new Promise((resolve, reject) => {
      const t = setTimeout(resolve, ms)
      signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('UtexoLsp: aborted')) }, { once: true })
    })
  }
}
