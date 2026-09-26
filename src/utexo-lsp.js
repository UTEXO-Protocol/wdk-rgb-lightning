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
import { exactUnsignedNumber } from './released-native-contract.js'
import { canonicalAssetId, canonicalInvoice } from './lsp-utils.js'
import { rejectRoutingFeeCap, paymentExpectation, requireInvoiceDecoder, verifyPaymentInvoice } from './lsp-payment-verification.js'
import { assertAddressRequest, assertAddressQuote, decodedInvoice, verifyApayAddressAttestation, verifyApayInvoiceProof, LspQuoteMismatchError } from './lsp-linked-assets.js'

function positiveAmount (value, field) {
  const amount = exactUnsignedNumber(value, field)
  if (amount === 0) throw new TypeError(`${field} must be positive`)
  return amount
}

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
 * @returns {'Pending'|'Succeeded'|'Failed'|'Expired'|'Cancelled'} - Canonical receive
 *   status.
 */
export function normalizeReceiveStatus (raw) {
  const s = (typeof raw === 'object' && raw !== null ? raw.status : raw) ?? ''
  const up = String(s).toUpperCase()
  if (up === 'SUCCEEDED' || up === 'SETTLED') return 'Succeeded'
  if (up === 'FAILED') return 'Failed'
  if (up === 'EXPIRED') return 'Expired'
  if (up === 'CANCELLED') return 'Cancelled'
  return 'Pending'
}

const DEFAULT_CHANNEL_TIMEOUT_MS = 120_000
const DEFAULT_SETTLEMENT_TIMEOUT_MS = 60_000
const DEFAULT_POLL_INTERVAL_MS = 2_000
const LIGHTNING_ADDRESS_LOOKUP_ATTEMPTS = 8
const LIGHTNING_ADDRESS_LOOKUP_DELAY_MS = 2_000

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
    const expirySeconds = positiveAmount(opts.expirySeconds ?? 3600, 'expirySeconds')
    const amountMsat = opts.amountSats == null
      ? undefined
      : exactUnsignedNumber(BigInt(positiveAmount(opts.amountSats, 'amountSats')) * 1000n, 'amountMsat')
    const assetAmount = opts.amountRgb == null ? undefined : positiveAmount(opts.amountRgb, 'amountRgb')

    const createdAtMs = Date.now()
    const created = await this.account.createLightningInvoice({
      amountMsat,
      expirySec: expirySeconds,
      assetId: opts.assetId,
      assetAmount
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
   *   `Expired` or `Cancelled`.
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
      if (status === 'Failed' || status === 'Expired' || status === 'Cancelled') {
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
    minMsat = exactUnsignedNumber(minMsat, 'minMsat')
    const timeoutMs = opts.timeoutMs ?? DEFAULT_CHANNEL_TIMEOUT_MS
    const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    const deadline = Date.now() + timeoutMs

    while (Date.now() < deadline) {
      this._checkAbort(opts.signal)
      await this.account.sync()
      const channels = await this._listChannels()
      const lspChannels = channels.filter((c) =>
        this._raw(c, 'peerPubkey', 'peer_pubkey') === this.peer.peerPubkey &&
        this._raw(c, 'isUsable', 'is_usable') === true
      )
      const outbound = lspChannels.reduce((maximum, channel) => Math.max(maximum,
        exactUnsignedNumber(this._outboundMsat(channel), 'native outbound balance')), 0)
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
    rejectRoutingFeeCap(opts)
    const expected = paymentExpectation(opts.ln)
    requireInvoiceDecoder(this.account)
    const issued = await this.http.onchainSend({ rgbInvoice: opts.rgbInvoice, ln: opts.ln })
    await verifyPaymentInvoice(this.account, issued.lnInvoice, {
      ...expected,
      lspPubkey: this.peer.peerPubkey,
      network: this.peer.network
    })
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
   * use verified LSP resolution without fallback after an ambiguous callback.
   * External hosts go directly
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
    const sendResult = await this.account.sendPayment({ invoice: quote.invoice })
    return { invoice: quote.invoice, sendResult }
  }

  async quoteAddress (opts = {}) {
    rejectRoutingFeeCap(opts)
    const address = opts.address
    let parsed
    try {
      parsed = parseLightningAddress(address, { allowHttp: this.peer.allowHttp === true })
    } catch {
      throw new TypeError(`UtexoLsp.quoteAddress: invalid Lightning Address "${address}"`)
    }

    const amtMsat = positiveAmount(opts.amtMsat, 'UtexoLsp.quoteAddress: amtMsat')
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
      : positiveAmount(requestedAssetAmount, 'UtexoLsp.quoteAddress: asset.assetAmount')

    const localHost = new URL(this.http.baseUrl ?? this.peer.baseUrl).host.toLowerCase()
    const hosted = parsed.host === localHost
    let expectedNetwork = this.peer.network
    if (hosted || expectedNetwork === undefined) {
      const info = await this.http.getInfo({ signal: opts.signal })
      if (info.pubkey !== this.peer.peerPubkey || (this.peer.network !== undefined && info.network !== this.peer.network)) {
        throw new LspQuoteMismatchError('discovered LSP identity or network does not match the configured peer')
      }
      expectedNetwork = info.network
    }
    const assetId = opts.asset?.assetId === undefined
      ? undefined
      : canonicalAssetId(opts.asset.assetId, 'UtexoLsp.quoteAddress: asset.assetId')
    if (opts.asset && assetId === undefined) throw new TypeError('An explicit asset.assetId is required')

    let resolved
    if (hosted) {
      const resolve = this.http.resolveAddressVerified.bind(this.http)
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

    const discovery = resolved.discovery
    if (!discovery) throw new LspQuoteMismatchError('missing discovery evidence')
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
    const requireInvoiceVerification = true
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
      ...(assetId === undefined ? {} : { assetId, assetAmount }),
      ...(proof === undefined ? {} : { proof })
    })
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
  async enableLightningAddress ({ requireAddressAttestation = true } = {}) {
    const addr = await this._ownLightningAddress('UtexoLsp.enableLightningAddress')
    const lspInfo = await this.http.getInfo()
    const lspPubkey = lspInfo?.pubkey
    if (typeof lspPubkey !== 'string' || lspPubkey.length === 0) {
      throw new Error('UtexoLsp.enableLightningAddress: LSP /get_info returned no pubkey')
    }

    if (requireAddressAttestation) {
      if (typeof this.account.apayNewWithAddress !== 'function') {
        throw new Error(
          'UtexoLsp.enableLightningAddress: address-attested APay is unavailable; ' +
          'install compatible native wrappers or explicitly set ' +
          'requireAddressAttestation to false for legacy registration'
        )
      }
      await this.account.apayNewWithAddress(lspPubkey, addr.username, addr.domain)
    } else {
      await this.account.apayNew(lspPubkey)
    }

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
    throw new TypeError('Invalid native channel list')
  }

  async _listPayments () {
    const resp = await this.account.listPayments()
    if (Array.isArray(resp)) return resp
    if (resp && Array.isArray(resp.payments)) return resp.payments
    return []
  }

  _isUsableRgbChannel (c, assetId) {
    return (
      this._raw(c, 'peerPubkey', 'peer_pubkey') === this.peer.peerPubkey &&
      this._raw(c, 'assetId', 'asset_id') === assetId &&
      (this._raw(c, 'isUsable', 'is_usable') ?? this._raw(c, 'ready', 'ready')) === true
    )
  }

  _toChannelReadyInfo (c) {
    return {
      channelId: String(this._raw(c, 'channelId', 'channel_id') ?? ''),
      peerPubkey: this.peer.peerPubkey,
      capacitySat: exactUnsignedNumber(this._raw(c, 'capacitySat', 'capacity_sat') ?? 0, 'native capacity'),
      outboundBalanceMsat: exactUnsignedNumber(this._outboundMsat(c), 'native outbound balance'),
      inboundBalanceMsat: exactUnsignedNumber(this._raw(c, 'inboundBalanceMsat', 'inbound_balance_msat') ?? 0, 'native inbound balance')
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

  async _ownLightningAddress (context) {
    const nodeInfo = await this.account.getNodeInfo()
    const pubkey = String(nodeInfo?.pubkey ?? '')
    if (!pubkey) throw new Error(`${context}: wallet not unlocked (no pubkey)`)

    let lastError
    for (let attempt = 0; attempt < LIGHTNING_ADDRESS_LOOKUP_ATTEMPTS; attempt += 1) {
      try {
        const address = await this.http.getLightningAddressByPubkey(pubkey)
        if (
          typeof address?.username === 'string' && address.username.length > 0 &&
          typeof address?.domain === 'string' && address.domain.length > 0
        ) {
          return address
        }
        lastError = new Error('LSP returned an incomplete Lightning Address')
      } catch (error) {
        lastError = error
      }

      if (attempt + 1 < LIGHTNING_ADDRESS_LOOKUP_ATTEMPTS) {
        await this._sleep(LIGHTNING_ADDRESS_LOOKUP_DELAY_MS)
      }
    }

    throw new Error(
      `${context}: LSP did not provision a Lightning Address for ${pubkey}. ` +
      `Last error: ${String(lastError)}`
    )
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
