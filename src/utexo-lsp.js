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
import { fetchDiscovery, parseLightningAddress, resolveAddressToInvoice } from './lnurl-pay.js'
import { canonicalAssetId, canonicalInvoice, snakeCaseLnParams } from './lsp-utils.js'
import {
  LspQuoteMismatchError,
  assertLiquidPaymentAsset,
  assertAddressQuote,
  assertAddressRequest,
  assertRelayQuote,
  decodedInvoice,
  payableAssets,
  pickPayableAsset,
  resolveRelayFundingAsset,
  selectLiquidPaymentAsset,
  verifyApayAddressAttestation,
  verifyApayInvoiceProof
} from './lsp-linked-assets.js'

export {
  LspAmbiguousPayableAssetError,
  LspInsufficientAssetLiquidityError,
  LspNoPayableAssetError,
  LspQuoteMismatchError,
  LspUnknownPayableAssetError
} from './lsp-linked-assets.js'

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

/** Settlement reached a terminal non-success state. */
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
 * Canonicalise the many status shapes RLN / the LSP emit into the five
 * receive states. Accepts a bare string (`'Succeeded'`) or an object
 * (`{ status }` from `getInvoiceStatus`).
 *
 * @param {string|{status?:string}|null|undefined} raw - Native or LSP status
 *   value.
 * @returns {'Pending'|'Succeeded'|'Cancelled'|'Failed'|'Expired'} - Canonical receive
 *   status.
 */
export function normalizeReceiveStatus (raw) {
  const s = (typeof raw === 'object' && raw !== null ? raw.status : raw) ?? ''
  const up = String(s).toUpperCase()
  if (up === 'SUCCEEDED' || up === 'SETTLED') return 'Succeeded'
  if (up === 'CANCELLED' || up === 'CANCELED') return 'Cancelled'
  if (up === 'FAILED') return 'Failed'
  if (up === 'EXPIRED') return 'Expired'
  return 'Pending'
}

const DEFAULT_CHANNEL_TIMEOUT_MS = 120_000
const DEFAULT_SETTLEMENT_TIMEOUT_MS = 60_000
const DEFAULT_POLL_INTERVAL_MS = 2_000
const DEFAULT_EXPIRY_SECONDS = 3_600
const LIGHTNING_ADDRESS_LOOKUP_ATTEMPTS = 8
const LIGHTNING_ADDRESS_LOOKUP_DELAY_MS = 2_000
const MAX_NATIVE_CHANNELS = 512

// ── UtexoLsp ─────────────────────────────────────────────────────────────────

export class UtexoLsp {
  /**
   * Create composed LSP flows for one wallet account and one LSP peer.
   *
   * @param {object} account - A `WalletAccountRgbLightning` or compatible
   *   exposing connectPeer, sync, listChannels, createLightningInvoice,
   *   getInvoiceStatus, sendPayment, getNodeInfo, apayNewWithAddress,
   *   apayNew, listPayments, claimHodlInvoice.
   * @param {object} peer - LSP peer details: `{ baseUrl, peerPubkey, peerHost,
   *   peerPort, network?, bearerToken?, timeoutMs?, allowHttp? }`.
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
    const expectedAssetId = canonicalAssetId(assetId, 'UtexoLsp.waitForChannel: assetId')
    const timeoutMs = positiveSafeNumber(
      opts.timeoutMs ?? DEFAULT_CHANNEL_TIMEOUT_MS,
      'UtexoLsp.waitForChannel: timeoutMs'
    )
    const pollIntervalMs = positiveSafeNumber(
      opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      'UtexoLsp.waitForChannel: pollIntervalMs'
    )
    const deadline = futureDeadline(timeoutMs, 'UtexoLsp.waitForChannel: timeoutMs')

    while (Date.now() < deadline) {
      this._checkAbort(opts.signal)
      if (opts.onEachPoll) await opts.onEachPoll()
      await this.account.sync()
      const channels = await this._listChannels()
      const match = channels.find((c) => this._isUsableRgbChannel(c, expectedAssetId))
      opts.onProgress?.(`channels: ${channels.length} — RGB usable: ${match ? 'yes' : 'no'}`)
      if (match) return this._toChannelReadyInfo(match)
      await this._sleep(pollIntervalMs, opts.signal)
    }
    throw new LspChannelTimeoutError(expectedAssetId, timeoutMs)
  }

  // ── 3. Receive RGB over Lightning (POST /lightning_receive) ───────────────────

  /**
   * Lightning → RGB bridge. Mints a LN invoice on this wallet, registers
   * it with the LSP, and returns both invoices. Share `rgbInvoice` with
   * the on-chain sender; the LSP pays `lnInvoice` once the RGB transfer
   * settles.
   *
   * @param {object} opts - Receive request.
   * @param {string} opts.assetId - RGB asset delivered over Lightning.
   * @param {number} opts.amountSats - Lightning amount in satoshis.
   * @param {number} opts.amountRgb - RGB units bound to the invoice.
   * @param {number} [opts.expirySeconds] - Invoice lifetime in seconds.
   *   Defaults to `3600`.
   * @param {'convertible'|'payout'} [opts.onchainAsset] - Omit the on-chain
   *   asset ID and let the LSP select the configured convertible counterpart,
   *   or request the Lightning payout asset on both legs. Defaults to
   *   `convertible`.
   * @returns {Promise<{ lnInvoice:string, rgbInvoice:string, mappingId:string, onchainAssetId?:string, converted?:boolean }>} - Paired
   *   invoices, exact on-chain representation, and LSP bridge mapping ID.
   * @throws {TypeError} - If `assetId` is missing or malformed.
   * @throws {LspError} - If the LSP bridge request fails.
   * @throws {Error} - If local invoice creation fails or returns no invoice.
   */
  async receiveAsset (opts = {}) {
    if (typeof opts.assetId !== 'string' || opts.assetId.length === 0) {
      throw new TypeError('UtexoLsp.receiveAsset: assetId required')
    }
    const assetId = canonicalAssetId(opts.assetId, 'UtexoLsp.receiveAsset: assetId')
    const amountSats = positiveSafeNumber(opts.amountSats, 'UtexoLsp.receiveAsset: amountSats')
    const amountRgb = positiveSafeNumber(opts.amountRgb, 'UtexoLsp.receiveAsset: amountRgb')
    const amountMsat = amountSats * 1000
    if (!Number.isSafeInteger(amountMsat)) {
      throw new TypeError('UtexoLsp.receiveAsset: amountSats is too large to convert exactly to millisatoshis')
    }
    const expirySeconds = opts.expirySeconds ?? DEFAULT_EXPIRY_SECONDS
    if (!Number.isSafeInteger(expirySeconds) || expirySeconds <= 0) {
      throw new TypeError('UtexoLsp.receiveAsset: expirySeconds must be a positive safe integer')
    }
    if (opts.onchainAsset !== undefined && opts.onchainAsset !== 'convertible' && opts.onchainAsset !== 'payout') {
      throw new TypeError('UtexoLsp.receiveAsset: onchainAsset must be "convertible" or "payout"')
    }

    this._checkAbort(opts.signal)
    const lspInfo = await this.http.getInfo({ signal: opts.signal })
    const supportedAssets = this._supportedAssets(lspInfo, this.peer.network)
    if (!supportedAssets.some((asset) => asset.assetId === assetId)) {
      throw new LspQuoteMismatchError('the requested Lightning payout asset is not advertised by this LSP')
    }
    const expectedNetwork = String(lspInfo.network).toLowerCase()
    this._checkAbort(opts.signal)
    const createdAtMs = Date.now()
    const created = await this.account.createLightningInvoice({
      amountMsat,
      expirySec: expirySeconds,
      assetId,
      assetAmount: amountRgb
    })
    const lnInvoice = canonicalInvoice(
      created?.invoice ?? created?.lnInvoice,
      'UtexoLsp.receiveAsset: createLightningInvoice returned no invoice'
    )

    const canVerifyInvoices =
      typeof this.account.decodeRgbInvoice === 'function' &&
      typeof this.account.decodeInvoice === 'function'
    let decodedLn
    if (canVerifyInvoices) {
      decodedLn = decodedInvoice(
        await this.account.decodeInvoice(lnInvoice),
        'receive Lightning invoice'
      )
      this._verifyCreatedReceiveInvoice(
        decodedLn,
        { ...opts, assetId, amountSats, amountRgb, expirySeconds },
        expectedNetwork
      )
    } else if (opts.requireInvoiceVerification !== false) {
      throw new LspQuoteMismatchError('the wallet cannot decode both receive invoices for local verification')
    }

    // The LSP validates durationSeconds against the LN invoice's
    // *remaining* lifetime (utexo-lsp EXPIRY_MATCH_TOLERANCE_SEC, ~5s).
    // Invoice creation on a mobile node can take seconds, so send the
    // remaining lifetime. Sending the full expiry returns HTTP 400 once
    // creation outlasts the tolerance.
    const elapsedSeconds = Math.max(0, Math.ceil((Date.now() - createdAtMs) / 1000))
    const durationSeconds = expirySeconds - elapsedSeconds
    if (durationSeconds <= 0) {
      throw new LspQuoteMismatchError(
        'the receive Lightning invoice expired before the mapping could be registered'
      )
    }

    this._checkAbort(opts.signal)
    const receive = typeof this.http.lightningReceiveVerified === 'function'
      ? this.http.lightningReceiveVerified.bind(this.http)
      : this.http.lightningReceive.bind(this.http)
    const lr = await receive({
      lnInvoice,
      rgb: {
        ...((opts.onchainAsset ?? 'convertible') === 'payout' ? { assetId } : {}),
        durationSeconds
      },
      ...(opts.signal === undefined ? {} : { signal: opts.signal })
    })
    if (lr.lnInvoice !== lnInvoice) {
      throw new LspQuoteMismatchError('the receive mapping refers to a different Lightning invoice')
    }
    if ((opts.onchainAsset ?? 'convertible') === 'payout') {
      if (lr.converted || (lr.rgbAssetId !== undefined && lr.rgbAssetId !== assetId)) {
        throw new LspQuoteMismatchError('the LSP converted a receive request that required the payout asset')
      }
    }
    let verifiedReceive
    if (canVerifyInvoices) {
      verifiedReceive = await this._verifyRgbReceiveInvoice(
        lr,
        { ...opts, assetId, amountSats, amountRgb },
        decodedLn
      )
    }
    return {
      lnInvoice,
      rgbInvoice: lr.rgbInvoice,
      mappingId: String(lr.mappingId),
      ...((verifiedReceive?.assetId ?? lr.rgbAssetId) === undefined
        ? {}
        : { onchainAssetId: verifiedReceive?.assetId ?? lr.rgbAssetId }),
      ...(verifiedReceive === undefined && !lr.converted && lr.rgbAssetId === undefined
        ? {}
        : { converted: verifiedReceive?.converted ?? lr.converted })
    }
  }

  // ── 4. Settlement polling ─────────────────────────────────────────────────────

  /**
   * Poll `getInvoiceStatus(lnInvoice)` until terminal.
   *
   * @param {string} lnInvoice - BOLT11 invoice whose settlement is monitored.
   * @param {object} [opts] - Wait options.
   * @returns {Promise<'settled'|'timed_out'>} - Settlement outcome.
   * @throws {LspSettlementError} - If settlement reaches `Cancelled`,
   *   `Failed`, or `Expired`.
   * @throws {Error} - If the operation is aborted or account synchronization
   *   fails.
   */
  async awaitReceiveSettlement (lnInvoice, opts = {}) {
    const invoice = canonicalInvoice(
      lnInvoice,
      'UtexoLsp.awaitReceiveSettlement: lnInvoice'
    )
    const timeoutMs = positiveSafeNumber(
      opts.timeoutMs ?? DEFAULT_SETTLEMENT_TIMEOUT_MS,
      'UtexoLsp.awaitReceiveSettlement: timeoutMs'
    )
    const pollIntervalMs = positiveSafeNumber(
      opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      'UtexoLsp.awaitReceiveSettlement: pollIntervalMs'
    )
    const deadline = futureDeadline(
      timeoutMs,
      'UtexoLsp.awaitReceiveSettlement: timeoutMs'
    )

    while (Date.now() < deadline) {
      this._checkAbort(opts.signal)
      if (opts.onEachPoll) await opts.onEachPoll()
      await this.account.sync()
      const raw = await this.account.getInvoiceStatus(invoice)
      const status = normalizeReceiveStatus(raw)
      opts.onProgress?.(status)
      if (status === 'Succeeded') return 'settled'
      if (status === 'Cancelled' || status === 'Failed' || status === 'Expired') {
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
    const requiredMsat = positiveSafeNumber(
      minMsat,
      'UtexoLsp.waitForOutboundLiquidity: minMsat'
    )
    const timeoutMs = positiveSafeNumber(
      opts.timeoutMs ?? DEFAULT_CHANNEL_TIMEOUT_MS,
      'UtexoLsp.waitForOutboundLiquidity: timeoutMs'
    )
    const pollIntervalMs = positiveSafeNumber(
      opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      'UtexoLsp.waitForOutboundLiquidity: pollIntervalMs'
    )
    const deadline = futureDeadline(
      timeoutMs,
      'UtexoLsp.waitForOutboundLiquidity: timeoutMs'
    )

    while (Date.now() < deadline) {
      this._checkAbort(opts.signal)
      if (opts.onEachPoll) await opts.onEachPoll()
      await this.account.sync()
      const channels = await this._listChannels()
      const lspChan = channels.find((c) =>
        this._isConfiguredPeer(c) && this._isExplicitlyUsable(c)
      )
      const outbound = nonNegativeSafeNumber(
        this._outboundMsat(lspChan),
        'UtexoLsp.waitForOutboundLiquidity: native outbound balance'
      )
      opts.onProgress?.(`outbound: ${outbound} msat (need ${requiredMsat})`)
      if (outbound >= requiredMsat) return
      await this._sleep(pollIntervalMs, opts.signal)
    }
    throw new LspLiquidityTimeoutError(requiredMsat, timeoutMs, this.peer.peerPubkey)
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
   * @param {number} [opts.maxTotalRoutingFeeMsat=0] - Maximum native routing
   *   fee. Defaults to zero so an omitted policy cannot authorize an
   *   unbounded payment.
   * @returns {Promise<{ lnInvoice:string, rgbInvoice:string, mappingId:string, sendResult:any }>} - Paired
   *   invoices, mapping ID, and account payment result.
   * @throws {TypeError} - If `rgbInvoice` or Lightning parameters are invalid.
   * @throws {LspError} - If the LSP bridge request fails.
   * @throws {Error} - If the account payment fails.
   */
  async sendAsset (opts = {}) {
    const rgbInvoice = canonicalInvoice(opts.rgbInvoice, 'UtexoLsp.sendAsset: rgbInvoice')
    if (opts.ln !== undefined) snakeCaseLnParams(opts.ln)
    const maxTotalRoutingFeeMsat = opts.maxTotalRoutingFeeMsat === undefined
      ? 0
      : nonNegativeSafeNumber(
        opts.maxTotalRoutingFeeMsat,
        'UtexoLsp.sendAsset: maxTotalRoutingFeeMsat'
      )
    this._checkAbort(opts.signal)
    const canVerifyInvoices =
      typeof this.account.decodeRgbInvoice === 'function' &&
      typeof this.account.decodeInvoice === 'function'
    let decodedRgb
    let recipientNetwork = this.peer.network
    if (canVerifyInvoices) {
      decodedRgb = await this.account.decodeRgbInvoice(rgbInvoice)
      recipientNetwork = this._verifyRecipientRgbInvoice(decodedRgb)
    } else if (opts.requireInvoiceVerification !== false) {
      throw new LspQuoteMismatchError('the wallet cannot decode both bridge invoices for local verification')
    }
    const supportedAssets = this._supportedAssets(
      await this.http.getInfo({ signal: opts.signal }),
      recipientNetwork
    )
    this._checkAbort(opts.signal)
    const issue = typeof this.http.onchainSendVerified === 'function'
      ? this.http.onchainSendVerified.bind(this.http)
      : this.http.onchainSend.bind(this.http)
    const issued = await issue({
      rgbInvoice,
      ln: opts.ln,
      ...(opts.signal === undefined ? {} : { signal: opts.signal })
    })
    if (issued.rgbInvoice !== rgbInvoice) {
      throw new LspQuoteMismatchError('the on-chain mapping refers to a different RGB invoice')
    }
    if (canVerifyInvoices) {
      const decodedLn = await this._verifyOnchainSendInvoice(
        issued,
        opts,
        decodedRgb,
        supportedAssets
      )
      this._checkAbort(opts.signal)
      await this._assertRgbPaymentLiquidity(
        decodedLn.assetId,
        decodedLn.assetAmount,
        decodedLn.amtMsat
      )
    }
    this._checkAbort(opts.signal)
    const sendResult = await this.account.sendPayment({
      invoice: issued.lnInvoice,
      max_total_routing_fee_msat: maxTotalRoutingFeeMsat
    })
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
   * @param {string} opts.address - Lightning Address in `user@host` form or
   *   UMA address in `$user@host` form.
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
    const quote = await this.quoteAddress(opts)
    this._checkAbort(opts.signal)
    if (quote.assetId !== undefined) {
      await this._assertRgbPaymentLiquidity(
        quote.assetId,
        quote.assetAmount,
        quote.amtMsat
      )
    }
    this._checkAbort(opts.signal)
    const sendResult = await this.account.sendPayment({
      invoice: quote.invoice,
      ...(quote.maxTotalRoutingFeeMsat === undefined
        ? {}
        : {
            max_total_routing_fee_msat: quote.maxTotalRoutingFeeMsat
          })
    })
    return {
      invoice: quote.invoice,
      sendResult,
      ...(quote.assetSelection === undefined ? {} : { assetSelection: quote.assetSelection })
    }
  }

  /**
   * Resolve and locally verify a Lightning Address without paying it.
   * Hosted quotes consume one APay hash, so callers should request a quote only
   * after the user has supplied a final amount and asset.
   *
   * @param {object} opts - Same address, amount, and asset fields as payAddress.
   * @param {boolean} [opts.requireAddressProof] - Require APay evidence for an
   *   address hosted by this LSP. Defaults to true for hosted addresses.
   * @returns {Promise<object>} - Verified BOLT11 quote.
   */
  async quoteAddress (opts = {}) {
    const address = opts.address
    let parsed
    try {
      parsed = parseLightningAddress(address, { allowHttp: this.peer.allowHttp === true })
    } catch {
      throw new TypeError(`UtexoLsp.quoteAddress: invalid Lightning Address "${address}"`)
    }

    const amtMsat = positiveSafeNumber(opts.amtMsat, 'UtexoLsp.quoteAddress: amtMsat')
    if (
      opts.asset !== undefined &&
      (opts.asset === null || typeof opts.asset !== 'object' || Array.isArray(opts.asset))
    ) {
      throw new TypeError('UtexoLsp.quoteAddress: asset must be an object when provided')
    }
    const requestedAssetAmount = opts.asset?.assetAmount ?? opts.asset?.amount
    if (opts.asset && requestedAssetAmount === undefined) {
      throw new TypeError('UtexoLsp.quoteAddress: asset.assetAmount is required when asset is set')
    }
    const assetAmount = requestedAssetAmount === undefined
      ? undefined
      : positiveSafeNumber(requestedAssetAmount, 'UtexoLsp.quoteAddress: asset.assetAmount')
    const maxTotalRoutingFeeMsat = opts.maxTotalRoutingFeeMsat === undefined
      ? 0
      : nonNegativeSafeNumber(
        opts.maxTotalRoutingFeeMsat,
        'UtexoLsp.quoteAddress: maxTotalRoutingFeeMsat'
      )

    const localHost = new URL(this.http.baseUrl ?? this.peer.baseUrl).host.toLowerCase()
    const hosted = parsed.host === localHost
    let expectedNetwork = this.peer.network
    if (hosted || expectedNetwork === undefined) {
      const info = await this.http.getInfo({ signal: opts.signal })
      this._supportedAssets(info, this.peer.network)
      expectedNetwork = info.network
    }
    let assetSelection
    let assetId = opts.asset?.assetId === undefined
      ? undefined
      : canonicalAssetId(opts.asset.assetId, 'UtexoLsp.quoteAddress: asset.assetId')
    if (opts.asset && assetId === undefined) {
      assetSelection = await this.selectPaymentAsset({
        address: parsed.address,
        assetAmount,
        amtMsat,
        signal: opts.signal
      })
      assetId = assetSelection.assetId
    }

    let resolved
    if (hosted) {
      const resolve = typeof this.http.resolveAddressVerified === 'function'
        ? this.http.resolveAddressVerified.bind(this.http)
        : this.http.resolveAddress.bind(this.http)
      this._checkAbort(opts.signal)
      resolved = await resolve(parsed.username, amtMsat, {
        assetId,
        assetAmount,
        signal: opts.signal
      })
    } else {
      resolved = await resolveAddressToInvoice(parsed.address, amtMsat, {
        allowHttp: this.peer.allowHttp === true,
        allowCrossHostCallback: opts.allowCrossHostCallback === true,
        assetId,
        assetAmount,
        signal: opts.signal
      })
    }

    const invoice = canonicalInvoice(
      resolved?.pr,
      'UtexoLsp.quoteAddress: no invoice returned for Lightning Address'
    )

    const discovery = resolved.discovery ?? await this.discoverAddress(parsed.address, opts)
    assertAddressRequest(discovery, { amtMsat, assetId, assetAmount })

    const proof = resolved.proof
    const canVerifyInvoice = typeof this.account.decodeInvoice === 'function'
    const requireProof = opts.requireAddressProof ?? hosted
    if (requireProof && !proof) {
      throw new LspQuoteMismatchError('the hosted Lightning Address quote has no APay inclusion proof')
    }
    if (hosted && (requireProof || discovery.addressSig !== undefined)) {
      if (discovery.recipientPubkey === undefined || discovery.addressSig === undefined) {
        throw new LspQuoteMismatchError('the hosted Lightning Address has no recipient attestation')
      }
      verifyApayAddressAttestation({
        recipientPubkey: discovery.recipientPubkey,
        username: parsed.username,
        domain: parsed.host,
        addressSig: discovery.addressSig
      })
    }
    const requireInvoiceVerification = opts.requireInvoiceVerification !== false
    if (canVerifyInvoice) {
      const decoded = decodedInvoice(await this.account.decodeInvoice(invoice), 'Lightning Address invoice')
      assertAddressQuote(decoded, {
        amtMsat,
        assetId,
        assetAmount,
        metadata: discovery.metadata,
        ...(expectedNetwork === undefined ? {} : { network: expectedNetwork }),
        ...(hosted ? { lspPubkey: this.peer.peerPubkey } : {}),
        ...(proof?.paymentHash === undefined ? {} : { paymentHash: proof.paymentHash })
      })
      if (proof) {
        if (discovery.recipientPubkey === undefined) {
          throw new LspQuoteMismatchError('the Lightning Address discovery does not identify the APay recipient')
        }
        if (decoded.payeePubkey === undefined) {
          throw new LspQuoteMismatchError('the APay invoice does not identify its payment recipient')
        }
        verifyApayInvoiceProof(proof, {
          paymentHash: decoded.paymentHash,
          recipientPubkey: discovery.recipientPubkey,
          hostPubkey: hosted ? this.peer.peerPubkey : decoded.payeePubkey
        })
      }
    } else if (requireInvoiceVerification || proof) {
      throw new LspQuoteMismatchError('the wallet cannot decode the Lightning Address invoice for local verification')
    }
    return Object.freeze({
      invoice,
      amtMsat,
      ...(maxTotalRoutingFeeMsat === undefined ? {} : { maxTotalRoutingFeeMsat }),
      ...(assetId === undefined ? {} : { assetId, assetAmount }),
      ...(assetSelection === undefined ? {} : { assetSelection }),
      ...(proof === undefined ? {} : { proof })
    })
  }

  /** Discover the exact payout and accepted assets of a Lightning Address. */
  async discoverAddress (address, opts = {}) {
    const parsed = parseLightningAddress(address, { allowHttp: this.peer.allowHttp === true })
    const localHost = new URL(this.http.baseUrl ?? this.peer.baseUrl).host.toLowerCase()
    if (parsed.host === localHost) {
      return this.http.discoverAddress(parsed.username, opts)
    }
    return fetchDiscovery(parsed.address, {
      allowHttp: this.peer.allowHttp === true,
      timeoutMs: opts.timeoutMs,
      signal: opts.signal
    })
  }

  /**
   * Return the address's payout representation and every exact contract the
   * callback accepts. This information comes from LNURL discovery, not from
   * labels or the LSP-wide channel provisioning list.
   */
  async listPayableAssets (address, opts = {}) {
    const target = address ?? (await this._ownLightningAddress('UtexoLsp.listPayableAssets', opts)).address
    return payableAssets(await this.discoverAddress(target, opts))
  }

  /**
   * Pick one accepted representation with enough spendable balance in a single
   * usable channel. No channel balances are summed because RGB MPP is not part
   * of this protocol.
   */
  async selectPaymentAsset (opts = {}) {
    if (
      typeof opts.address !== 'string' ||
      opts.address.length === 0 ||
      opts.address !== opts.address.trim()
    ) {
      throw new TypeError('UtexoLsp.selectPaymentAsset: address required')
    }
    const assetAmount = positiveSafeNumber(opts.assetAmount, 'UtexoLsp.selectPaymentAsset: assetAmount')
    const amtMsat = opts.amtMsat === undefined
      ? 0
      : positiveSafeNumber(opts.amtMsat, 'UtexoLsp.selectPaymentAsset: amtMsat')
    const discovery = opts.discovery ?? await this.discoverAddress(opts.address, opts)
    const channels = opts.channels ?? await this._listChannels()
    return selectLiquidPaymentAsset(discovery, channels, assetAmount, amtMsat)
  }

  /**
   * Create a hosted BOLT11 for an external payer. By default the quote uses the
   * sole canonical/convertible representation advertised by the address; an
   * ambiguous menu must be resolved explicitly by ticker or contract ID.
   */
  async requestExternalInvoice (opts = {}) {
    const amtMsat = positiveSafeNumber(opts.amtMsat, 'UtexoLsp.requestExternalInvoice: amtMsat')
    const assetAmount = positiveSafeNumber(opts.assetAmount, 'UtexoLsp.requestExternalInvoice: assetAmount')
    if (opts.prefer !== undefined && opts.prefer !== 'convertible' && opts.prefer !== 'payout') {
      throw new TypeError('UtexoLsp.requestExternalInvoice: prefer must be "convertible" or "payout"')
    }
    if (
      opts.asset !== undefined &&
      (
        typeof opts.asset !== 'string' ||
        opts.asset.length === 0 ||
        opts.asset !== opts.asset.trim()
      )
    ) {
      throw new TypeError('UtexoLsp.requestExternalInvoice: asset must be a non-empty canonical string')
    }
    if (
      opts.address !== undefined &&
      (
        typeof opts.address !== 'string' ||
        opts.address.length === 0 ||
        opts.address !== opts.address.trim()
      )
    ) {
      throw new TypeError('UtexoLsp.requestExternalInvoice: address must be a non-empty canonical string')
    }
    const parsed = opts.address !== undefined
      ? parseLightningAddress(opts.address, { allowHttp: this.peer.allowHttp === true })
      : await this._ownLightningAddress('UtexoLsp.requestExternalInvoice', opts)
    const address = parsed.address ?? `${parsed.username}@${parsed.domain}`
    const menu = await this.listPayableAssets(address, opts)
    const selection = pickPayableAsset(
      address,
      menu,
      opts.asset,
      opts.prefer ?? 'convertible'
    )
    const quote = await this.quoteAddress({
      address,
      amtMsat,
      asset: { assetId: selection.asset.assetId, assetAmount },
      requireAddressProof: opts.requireAddressProof ?? true,
      requireInvoiceVerification: true,
      signal: opts.signal
    })
    return Object.freeze({
      ...quote,
      address,
      username: parsed.username,
      domain: parsed.domain ?? parsed.host,
      asset: selection.asset,
      converted: selection.converted,
      ...(quote.proof?.paymentHash === undefined ? {} : { paymentHash: quote.proof.paymentHash })
    })
  }

  /**
   * Ask the LSP for an atomic HODL relay quote, then verify both signed invoice
   * legs locally. This method does not pay.
   */
  async quoteExternalPayment (opts = {}) {
    const targetInvoice = canonicalInvoice(
      opts.invoice,
      'UtexoLsp.quoteExternalPayment: invoice'
    )
    const target = decodedInvoice(
      await this.account.decodeInvoice(targetInvoice),
      'external target invoice'
    )
    if (target.expiresAt <= Math.floor(Date.now() / 1000)) {
      throw new LspQuoteMismatchError('the external target invoice is already expired')
    }
    if (
      opts.payWith !== undefined &&
      (
        typeof opts.payWith !== 'string' ||
        opts.payWith.length === 0 ||
        opts.payWith !== opts.payWith.trim()
      )
    ) {
      throw new TypeError('UtexoLsp.quoteExternalPayment: payWith must be a non-empty string when provided')
    }
    const requested = opts.payWith ?? ''
    const maxFeeMsat = opts.maxFeeMsat === undefined
      ? 0
      : nonNegativeSafeNumber(opts.maxFeeMsat, 'UtexoLsp.quoteExternalPayment: maxFeeMsat')
    const maxTotalRoutingFeeMsat = opts.maxTotalRoutingFeeMsat === undefined
      ? 0
      : nonNegativeSafeNumber(
        opts.maxTotalRoutingFeeMsat,
        'UtexoLsp.quoteExternalPayment: maxTotalRoutingFeeMsat'
      )
    const supportedAssets = this._supportedAssets(
      await this.http.getInfo({ signal: opts.signal }),
      target.network
    )
    const channels = requested === '' ? (opts.channels ?? await this._listChannels()) : []
    const payWithAssetId = resolveRelayFundingAsset(
      target,
      channels,
      opts.payWith,
      supportedAssets
    )
    this._checkAbort(opts.signal)
    const response = await this.http.lightningSend({
      invoice: targetInvoice,
      payWithAssetId,
      timeoutMs: opts.timeoutMs,
      signal: opts.signal
    })
    const quotedFundingAsset = response.inbound?.assetId
    if (
      quotedFundingAsset !== undefined &&
      !supportedAssets.some((asset) => asset.assetId === quotedFundingAsset)
    ) {
      throw new LspQuoteMismatchError('the funding invoice uses an asset not advertised by this LSP')
    }
    if (payWithAssetId !== undefined && quotedFundingAsset !== payWithAssetId) {
      throw new LspQuoteMismatchError('the funding invoice changed the explicitly selected payment asset')
    }
    const hodl = decodedInvoice(
      await this.account.decodeInvoice(response.lnInvoice),
      'LSP funding invoice'
    )
    assertRelayQuote(target, hodl, response, {
      maxFeeMsat,
      lspPubkey: this.peer.peerPubkey
    })
    return Object.freeze({
      targetInvoice,
      invoice: response.lnInvoice,
      paymentHash: response.paymentHash,
      inbound: response.inbound,
      outbound: response.outbound,
      converted: response.converted,
      feeMsat: response.feeMsat,
      maxFeeMsat,
      maxTotalRoutingFeeMsat,
      expiresAt: response.expiresAt,
      verified: true
    })
  }

  /**
   * Re-verify a serialized or previously returned relay quote without paying.
   * Applications with their own durable payment journal use this immediately
   * before crossing their native commit boundary.
   */
  async verifyExternalQuote (quote, opts = {}) {
    this._checkAbort(opts.signal)
    if (!quote || quote.verified !== true) {
      throw new TypeError('UtexoLsp.verifyExternalQuote: a verified quote is required')
    }
    const targetInvoice = typeof quote.targetInvoice === 'string'
      ? quote.targetInvoice.trim()
      : ''
    const invoice = typeof quote.invoice === 'string' ? quote.invoice.trim() : ''
    if (targetInvoice.length === 0 || invoice.length === 0) {
      throw new TypeError('UtexoLsp.verifyExternalQuote: both signed invoices are required')
    }
    if (targetInvoice !== quote.targetInvoice || invoice !== quote.invoice) {
      throw new TypeError('UtexoLsp.verifyExternalQuote: invoice strings must be canonical')
    }
    const authorizedTargetInvoice = canonicalInvoice(
      opts.invoice,
      'UtexoLsp.verifyExternalQuote: authorized invoice'
    )
    if (authorizedTargetInvoice !== targetInvoice) {
      throw new LspQuoteMismatchError('the target invoice differs from the authorized payment intent')
    }
    const authorizedMaxFeeMsat = opts.maxFeeMsat === undefined
      ? 0
      : nonNegativeSafeNumber(
        opts.maxFeeMsat,
        'UtexoLsp.verifyExternalQuote: maxFeeMsat'
      )
    const quotedMaxFeeMsat = nonNegativeSafeNumber(
      quote.maxFeeMsat,
      'UtexoLsp.verifyExternalQuote: quoted maxFeeMsat'
    )
    if (authorizedMaxFeeMsat !== quotedMaxFeeMsat) {
      throw new LspQuoteMismatchError('the LSP fee ceiling differs from the authorized payment intent')
    }
    const authorizedRoutingFeeMsat = opts.maxTotalRoutingFeeMsat === undefined
      ? 0
      : nonNegativeSafeNumber(
        opts.maxTotalRoutingFeeMsat,
        'UtexoLsp.verifyExternalQuote: maxTotalRoutingFeeMsat'
      )
    const quotedRoutingFeeMsat = nonNegativeSafeNumber(
      quote.maxTotalRoutingFeeMsat,
      'UtexoLsp.verifyExternalQuote: quoted maxTotalRoutingFeeMsat'
    )
    if (authorizedRoutingFeeMsat !== quotedRoutingFeeMsat) {
      throw new LspQuoteMismatchError('the routing fee ceiling differs from the authorized payment intent')
    }
    const target = decodedInvoice(
      await this.account.decodeInvoice(targetInvoice),
      'external target invoice'
    )
    const hodl = decodedInvoice(
      await this.account.decodeInvoice(invoice),
      'LSP funding invoice'
    )
    assertRelayQuote(target, hodl, quote, {
      maxFeeMsat: authorizedMaxFeeMsat,
      lspPubkey: this.peer.peerPubkey
    })
    const supportedAssets = this._supportedAssets(
      await this.http.getInfo({ signal: opts.signal }),
      target.network
    )
    if (
      quote.inbound?.assetId !== undefined &&
      !supportedAssets.some((asset) => asset.assetId === quote.inbound.assetId)
    ) {
      throw new LspQuoteMismatchError('the restored funding asset is no longer advertised by this LSP')
    }
    const authorizedFundingAssetId = opts.fundingAssetId === null
      ? undefined
      : canonicalAssetId(
        opts.fundingAssetId,
        'UtexoLsp.verifyExternalQuote: fundingAssetId'
      )
    if (quote.inbound?.assetId !== authorizedFundingAssetId) {
      throw new LspQuoteMismatchError('the funding asset differs from the authorized payment intent')
    }
    this._checkAbort(opts.signal)
    return Object.freeze({ ...quote, targetInvoice, invoice })
  }

  /**
   * Re-verify a previously quoted relay immediately before handing its funding
   * invoice to the native node. This prevents mutable or deserialized quote
   * objects from bypassing the two-leg checks.
   */
  async payExternalQuote (quote, opts = {}) {
    const verifiedQuote = await this.verifyExternalQuote(quote, opts)
    this._checkAbort(opts.signal)
    if (verifiedQuote.inbound?.assetId !== undefined) {
      await this._assertRgbPaymentLiquidity(
        verifiedQuote.inbound.assetId,
        verifiedQuote.inbound.assetAmount,
        verifiedQuote.inbound.amtMsat
      )
    }
    this._checkAbort(opts.signal)
    const sendResult = await this.account.sendPayment({
      invoice: verifiedQuote.invoice,
      max_total_routing_fee_msat: verifiedQuote.maxTotalRoutingFeeMsat
    })
    return { quote: verifiedQuote, sendResult }
  }

  /** Quote and immediately submit an external cross-asset payment. */
  async payExternalInvoice (opts = {}) {
    const quote = await this.quoteExternalPayment(opts)
    return this.payExternalQuote(quote, {
      invoice: opts.invoice,
      fundingAssetId: quote.inbound?.assetId ?? null,
      maxFeeMsat: opts.maxFeeMsat,
      maxTotalRoutingFeeMsat: opts.maxTotalRoutingFeeMsat,
      signal: opts.signal
    })
  }

  /** Read the LSP's durable relay state without touching the native queue. */
  externalPaymentStatus (paymentHash, opts = {}) {
    return this.http.lightningSendStatus(paymentHash, opts)
  }

  // ── 8. Async / offline receive (APay) ─────────────────────────────────────────

  /**
   * Register the async-payment hash pool with this LSP and return the
   * auto-assigned Lightning Address for this wallet's pubkey. Call once after
   * first unlock to enable offline receive.
   *
   * The LSP provisions the address before registration. The production path
   * resolves that address first and registers exactly one signed batch through
   * `apayNewWithAddress`. Calling legacy `apayNew` first can consume the hash
   * pool capacity and leaves the address ownership unattested.
   *
   * @param {object} [opts] - Registration policy.
   * @param {boolean} [opts.requireAddressAttestation=true] - Require the
   *   generated native address-attestation method. Set to `false` only for an
   *   explicit legacy compatibility downgrade.
   * @returns {Promise<{ username:string, domain:string, address:string }>} - Auto-assigned
   *   Lightning Address components and full address.
   * @throws {LspError} - If LSP information or address lookup fails.
   * @throws {Error} - If the wallet is locked, the LSP response is malformed,
   *   or APay registration fails.
   */
  async enableLightningAddress ({ requireAddressAttestation = true, signal } = {}) {
    const addr = await this._ownLightningAddress(
      'UtexoLsp.enableLightningAddress',
      { signal }
    )
    const lspInfo = await this.http.getInfo({ signal })
    const lspPubkey = lspInfo?.pubkey
    if (typeof lspPubkey !== 'string' || lspPubkey.length === 0) {
      throw new Error('UtexoLsp.enableLightningAddress: LSP /get_info returned no pubkey')
    }
    this._supportedAssets(lspInfo)
    this._checkAbort(signal)

    if (requireAddressAttestation) {
      if (typeof this.account.apayNewWithAddress !== 'function') {
        throw new Error(
          'UtexoLsp.enableLightningAddress: address-attested APay is unavailable; ' +
          'install compatible native wrappers or explicitly set ' +
          'requireAddressAttestation to false for legacy registration'
        )
      }
      const pool = await this.account.apayNewWithAddress(lspPubkey, addr.username, addr.domain)
      return {
        username: addr.username,
        domain: addr.domain,
        address: `${addr.username}@${addr.domain}`,
        ...this._hashPoolMetadata(pool)
      }
    } else {
      await this.account.apayNew(lspPubkey)
    }

    return { username: addr.username, domain: addr.domain, address: `${addr.username}@${addr.domain}` }
  }

  /** Register the next address-attested APay hash batch. */
  async refillHashPool (opts = {}) {
    if (typeof this.account.apayNewWithAddress !== 'function') {
      throw new Error('UtexoLsp.refillHashPool: address-attested APay is unavailable')
    }
    const address = await this._ownLightningAddress('UtexoLsp.refillHashPool', opts)
    const info = await this.http.getInfo({ signal: opts.signal })
    this._supportedAssets(info)
    return this.account.apayNewWithAddress(info.pubkey, address.username, address.domain)
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
    const channels = Array.isArray(resp)
      ? resp
      : resp && Array.isArray(resp.channels)
        ? resp.channels
        : null
    if (channels === null) {
      throw new TypeError('UtexoLsp: native listChannels returned a malformed response')
    }
    if (channels.length > MAX_NATIVE_CHANNELS) {
      throw new TypeError(`UtexoLsp: native listChannels exceeds ${MAX_NATIVE_CHANNELS} entries`)
    }
    return channels
  }

  async _assertRgbPaymentLiquidity (assetId, assetAmount, requiredMsat) {
    return assertLiquidPaymentAsset(
      await this._listChannels(),
      assetId,
      assetAmount,
      requiredMsat
    )
  }

  async _listPayments () {
    const resp = await this.account.listPayments()
    if (Array.isArray(resp)) return resp
    if (resp && Array.isArray(resp.payments)) return resp.payments
    return []
  }

  _verifyCreatedReceiveInvoice (decodedLn, opts, expectedNetwork) {
    if (decodedLn.assetId !== opts.assetId || decodedLn.assetAmount !== opts.amountRgb) {
      throw new LspQuoteMismatchError('the receive Lightning invoice does not carry the requested payout asset')
    }
    if (decodedLn.amtMsat !== opts.amountSats * 1000) {
      throw new LspQuoteMismatchError('the receive Lightning invoice does not carry the requested carrier amount')
    }
    if (decodedLn.expiresAt <= Math.floor(Date.now() / 1000)) {
      throw new LspQuoteMismatchError('the receive Lightning invoice is already expired')
    }
    if (decodedLn.expirySeconds !== opts.expirySeconds) {
      throw new LspQuoteMismatchError('the receive Lightning invoice changed the requested expiry')
    }
    if (decodedLn.network !== expectedNetwork) {
      throw new LspQuoteMismatchError('the receive Lightning invoice is for a different LSP network')
    }
  }

  async _verifyRgbReceiveInvoice (response, opts, decodedLn) {
    if (typeof this.account.decodeRgbInvoice !== 'function') {
      throw new LspQuoteMismatchError('the wallet cannot decode the LSP RGB invoice for local verification')
    }
    const decodedRgb = await this.account.decodeRgbInvoice(response.rgbInvoice)
    const rgbAssetId = this._raw(decodedRgb, 'assetId', 'asset_id')
    if (typeof rgbAssetId !== 'string' || rgbAssetId.length === 0) {
      throw new LspQuoteMismatchError('the LSP RGB invoice carries no asset id')
    }
    if (response.rgbAssetId !== undefined && response.rgbAssetId !== rgbAssetId) {
      throw new LspQuoteMismatchError('the LSP response asset differs from its signed RGB invoice')
    }
    const converted = rgbAssetId !== opts.assetId
    if (response.converted !== converted) {
      throw new LspQuoteMismatchError('the LSP conversion flag differs from the signed invoice asset pair')
    }
    const assignment = decodedRgb?.assignment
    const assignmentType = assignment?.type
    const assignmentAmount = assignment?.value
    if (assignmentType !== 'Fungible' || assignmentAmount !== opts.amountRgb) {
      throw new LspQuoteMismatchError('the RGB invoice does not pin the requested fungible amount')
    }

    const rgbExpiry = this._raw(decodedRgb, 'expirationTimestamp', 'expiration_timestamp')
    if (!Number.isSafeInteger(rgbExpiry) || rgbExpiry <= Math.floor(Date.now() / 1000)) {
      throw new LspQuoteMismatchError('the receive RGB invoice has no valid future expiry')
    }
    if (rgbExpiry > decodedLn.expiresAt) {
      throw new LspQuoteMismatchError('the receive RGB invoice outlives its Lightning payout')
    }
    if (decodedLn.expiresAt <= Math.floor(Date.now() / 1000)) {
      throw new LspQuoteMismatchError('the receive Lightning invoice expired while the mapping was created')
    }

    const rgbNetwork = this._raw(decodedRgb, 'network', 'network')
    if (typeof rgbNetwork !== 'string' || rgbNetwork.length === 0) {
      throw new LspQuoteMismatchError('the receive RGB invoice does not identify its Bitcoin network')
    }
    if (rgbNetwork.toLowerCase() !== decodedLn.network) {
      throw new LspQuoteMismatchError('the receive invoices are for different Bitcoin networks')
    }
    return Object.freeze({ assetId: rgbAssetId, converted })
  }

  _verifyRecipientRgbInvoice (decodedRgb) {
    const rgbAssetId = this._raw(decodedRgb, 'assetId', 'asset_id')
    const assignment = decodedRgb?.assignment
    if (typeof rgbAssetId !== 'string' || rgbAssetId.length === 0) {
      throw new LspQuoteMismatchError('the recipient RGB invoice carries no asset id')
    }
    if (assignment?.type !== 'Fungible' || !Number.isSafeInteger(assignment.value) || assignment.value <= 0) {
      throw new LspQuoteMismatchError('the recipient RGB invoice carries no positive fungible amount')
    }

    const rgbNetwork = this._raw(decodedRgb, 'network', 'network')
    if (typeof rgbNetwork !== 'string' || rgbNetwork.length === 0) {
      throw new LspQuoteMismatchError('the recipient RGB invoice does not identify its Bitcoin network')
    }

    const expiresAt = this._raw(decodedRgb, 'expirationTimestamp', 'expiration_timestamp')
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) {
      throw new LspQuoteMismatchError('the recipient RGB invoice has no valid future expiry')
    }
    return rgbNetwork.toLowerCase()
  }

  async _verifyOnchainSendInvoice (response, opts, decodedRgb, supportedAssets) {
    const rgbAssetId = this._raw(decodedRgb, 'assetId', 'asset_id')
    const assignment = decodedRgb.assignment

    const decodedLn = decodedInvoice(
      await this.account.decodeInvoice(response.lnInvoice),
      'on-chain bridge Lightning invoice'
    )
    if (decodedLn.assetId !== rgbAssetId || decodedLn.assetAmount !== assignment.value) {
      throw new LspQuoteMismatchError('the bridge Lightning invoice does not match the recipient RGB asset and amount')
    }
    if (decodedLn.payeePubkey !== String(this.peer.peerPubkey).toLowerCase()) {
      throw new LspQuoteMismatchError('the bridge Lightning invoice is not payable to the configured LSP')
    }
    if (
      decodedLn.assetId !== undefined &&
      !supportedAssets.some((asset) => asset.assetId === decodedLn.assetId)
    ) {
      throw new LspQuoteMismatchError('the bridge Lightning invoice uses an asset not advertised by this LSP')
    }
    if (decodedLn.expiresAt <= Math.floor(Date.now() / 1000)) {
      throw new LspQuoteMismatchError('the bridge Lightning invoice is already expired')
    }

    const rgbNetwork = this._raw(decodedRgb, 'network', 'network')
    const rgbExpiry = this._raw(decodedRgb, 'expirationTimestamp', 'expiration_timestamp')
    if (decodedLn.expiresAt > rgbExpiry) {
      throw new LspQuoteMismatchError('the bridge Lightning invoice outlives the recipient RGB invoice')
    }
    if (rgbNetwork.toLowerCase() !== decodedLn.network) {
      throw new LspQuoteMismatchError('the bridge invoices are for different Bitcoin networks')
    }

    const requested = opts.ln ?? {}
    if (requested.amtMsat !== undefined) {
      const amount = positiveSafeNumber(requested.amtMsat, 'UtexoLsp.sendAsset: ln.amtMsat')
      if (decodedLn.amtMsat !== amount) {
        throw new LspQuoteMismatchError('the bridge Lightning invoice carries a different millisatoshi amount')
      }
    }
    if (requested.assetId !== undefined && decodedLn.assetId !== requested.assetId) {
      throw new LspQuoteMismatchError('the bridge Lightning invoice carries a different requested asset')
    }
    if (requested.assetAmount !== undefined) {
      const assetAmount = positiveSafeNumber(
        requested.assetAmount,
        'UtexoLsp.sendAsset: ln.assetAmount'
      )
      if (decodedLn.assetAmount !== assetAmount) {
        throw new LspQuoteMismatchError('the bridge Lightning invoice carries a different requested asset amount')
      }
    }
    if (requested.paymentHash !== undefined && decodedLn.paymentHash !== String(requested.paymentHash).toLowerCase()) {
      throw new LspQuoteMismatchError('the bridge Lightning invoice carries a different requested payment hash')
    }
    if (
      requested.descriptionHash !== undefined &&
      decodedLn.descriptionHash !== String(requested.descriptionHash).toLowerCase()
    ) {
      throw new LspQuoteMismatchError('the bridge Lightning invoice carries a different requested description hash')
    }
    if (requested.minFinalCltvExpiryDelta !== undefined) {
      const minFinalCltvExpiryDelta = nonNegativeSafeNumber(
        requested.minFinalCltvExpiryDelta,
        'UtexoLsp.sendAsset: ln.minFinalCltvExpiryDelta'
      )
      if (decodedLn.minFinalCltvExpiryDelta !== minFinalCltvExpiryDelta) {
        throw new LspQuoteMismatchError('the bridge Lightning invoice carries a different requested minimum final CLTV delta')
      }
    }
    if (requested.expirySec !== undefined) {
      const expirySeconds = positiveSafeNumber(
        requested.expirySec,
        'UtexoLsp.sendAsset: ln.expirySec'
      )
      if (decodedLn.expirySeconds !== expirySeconds) {
        throw new LspQuoteMismatchError('the bridge Lightning invoice carries a different requested expiry')
      }
    }
    return decodedLn
  }

  _isUsableRgbChannel (c, assetId) {
    return (
      this._raw(c, 'assetId', 'asset_id') === assetId &&
      this._isConfiguredPeer(c) &&
      this._isExplicitlyUsable(c)
    )
  }

  _isConfiguredPeer (c) {
    const actual = this._raw(c, 'peerPubkey', 'peer_pubkey')
    return (
      typeof actual === 'string' &&
      actual.toLowerCase() === String(this.peer.peerPubkey).toLowerCase()
    )
  }

  _isExplicitlyUsable (c) {
    return this._raw(c, 'isUsable', 'is_usable') === true
  }

  _toChannelReadyInfo (c) {
    return {
      channelId: String(this._raw(c, 'channelId', 'channel_id') ?? ''),
      peerPubkey: this.peer.peerPubkey,
      capacitySat: nonNegativeSafeNumber(
        this._raw(c, 'capacitySat', 'capacity_sat') ?? 0,
        'UtexoLsp.waitForChannel: native capacity'
      ),
      outboundBalanceMsat: nonNegativeSafeNumber(
        this._outboundMsat(c),
        'UtexoLsp.waitForChannel: native outbound balance'
      ),
      inboundBalanceMsat: nonNegativeSafeNumber(
        this._raw(c, 'inboundBalanceMsat', 'inbound_balance_msat') ?? 0,
        'UtexoLsp.waitForChannel: native inbound balance'
      )
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

  async _ownLightningAddress (context, opts = {}) {
    this._checkAbort(opts.signal)
    const nodeInfo = await this.account.getNodeInfo()
    const pubkey = String(nodeInfo?.pubkey ?? '')
    if (!pubkey) throw new Error(`${context}: wallet not unlocked (no pubkey)`)

    let lastError
    for (let attempt = 0; attempt < LIGHTNING_ADDRESS_LOOKUP_ATTEMPTS; attempt += 1) {
      this._checkAbort(opts.signal)
      try {
        const lookup = typeof this.http.getLightningAddressByPubkeyVerified === 'function'
          ? this.http.getLightningAddressByPubkeyVerified.bind(this.http)
          : this.http.getLightningAddressByPubkey.bind(this.http)
        const address = opts.signal === undefined
          ? await lookup(pubkey)
          : await lookup(pubkey, { signal: opts.signal })
        if (
          typeof address?.username === 'string' && address.username.length > 0 &&
          typeof address?.domain === 'string' && address.domain.length > 0
        ) {
          if (
            address.recipientPubkey !== undefined &&
            String(address.recipientPubkey).toLowerCase() !== pubkey.toLowerCase()
          ) {
            throw new LspQuoteMismatchError('the Lightning Address belongs to a different wallet node')
          }
          return address
        }
        lastError = new Error('LSP returned an incomplete Lightning Address')
      } catch (error) {
        if (
          error instanceof LspQuoteMismatchError ||
          error instanceof TypeError ||
          error?.name === 'LspProtocolError'
        ) {
          throw error
        }
        lastError = error
      }

      if (attempt + 1 < LIGHTNING_ADDRESS_LOOKUP_ATTEMPTS) {
        await this._sleep(LIGHTNING_ADDRESS_LOOKUP_DELAY_MS, opts.signal)
      }
    }

    throw new Error(
      `${context}: LSP did not provision a Lightning Address for ${pubkey}. ` +
      `Last error: ${String(lastError)}`
    )
  }

  _supportedAssets (info, expectedNetwork) {
    if (String(info?.pubkey ?? '').toLowerCase() !== String(this.peer.peerPubkey).toLowerCase()) {
      throw new LspQuoteMismatchError('the LSP discovery identity differs from the configured peer')
    }
    const discoveredNetwork = String(info?.network ?? '').toLowerCase()
    if (
      this.peer.network !== undefined &&
      discoveredNetwork !== String(this.peer.network).toLowerCase()
    ) {
      throw new LspQuoteMismatchError('the LSP discovery network differs from the configured peer')
    }
    if (
      expectedNetwork !== undefined &&
      discoveredNetwork !== String(expectedNetwork).toLowerCase()
    ) {
      throw new LspQuoteMismatchError('the LSP discovery and target invoice use different Bitcoin networks')
    }
    return (info?.supported_assets ?? info?.supportedAssets ?? []).map((asset) => Object.freeze({
      assetId: asset.asset_id ?? asset.assetId,
      schema: asset.schema,
      ...(asset.ticker === undefined ? {} : { ticker: asset.ticker }),
      name: asset.name,
      precision: asset.precision
    }))
  }

  _hashPoolMetadata (pool) {
    if (!pool || typeof pool !== 'object') return {}
    const unusedHashes = this._raw(pool, 'unusedHashes', 'unused_hashes')
    const nextIndexExpected = this._raw(pool, 'nextIndexExpected', 'next_index_expected')
    const refillBatchSize = this._raw(pool, 'refillBatchSize', 'refill_batch_size')
    return {
      ...(Number.isSafeInteger(unusedHashes) ? { unusedHashes } : {}),
      ...(Number.isSafeInteger(nextIndexExpected) ? { nextIndexExpected } : {}),
      ...(Number.isSafeInteger(refillBatchSize) ? { refillBatchSize } : {})
    }
  }

  _checkAbort (signal) {
    if (signal?.aborted) throw new Error('UtexoLsp: operation aborted')
  }

  _sleep (ms, signal) {
    // Do not unref this timer: it is a deliberate poll-interval wait and
    // must keep the event loop alive until it resolves or aborts.
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        reject(new Error('UtexoLsp: aborted'))
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }, ms)
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }
}

function nonNegativeSafeNumber (value, field) {
  const number = typeof value === 'bigint' || typeof value === 'string' ? Number(value) : value
  if (!Number.isSafeInteger(number) || number < 0 || String(number) !== String(value).replace(/^0+(?=\d)/, '')) {
    throw new TypeError(`${field} must be a non-negative safe integer`)
  }
  return number
}

function positiveSafeNumber (value, field) {
  const number = nonNegativeSafeNumber(value, field)
  if (number === 0) throw new TypeError(`${field} must be positive`)
  return number
}

function futureDeadline (timeoutMs, field) {
  const now = Date.now()
  if (timeoutMs > Number.MAX_SAFE_INTEGER - now) {
    throw new TypeError(`${field} exceeds JavaScript's exact timestamp range`)
  }
  return now + timeoutMs
}
