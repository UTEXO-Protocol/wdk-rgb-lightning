// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
'use strict'

/** @typedef {import('@tetherto/wdk-wallet').IWalletAccount} IWalletAccount */
/** @typedef {import('@tetherto/wdk-wallet').KeyPair} KeyPair */
/** @typedef {import('@tetherto/wdk-wallet').TransactionResult} TransactionResult */
/** @typedef {import('@tetherto/wdk-wallet').TransferOptions} TransferOptions */
/** @typedef {import('@tetherto/wdk-wallet').TransferResult} TransferResult */
/** @typedef {import('./bare-binding.js').BareRgbLightningBinding} BareRgbLightningBinding */
/** @typedef {import('./lsp-client.js').LspClient} LspClient */

import {
  payLightningAddress as _payLightningAddress,
  requestLspRgbDeposit as _requestLspRgbDeposit,
  payRgbViaLsp as _payRgbViaLsp
} from './lsp-helpers.js'
import { LspClient } from './lsp-client.js'
import { UtexoLsp } from './utexo-lsp.js'
import WalletAccountReadOnlyRgbLightning, {
  createReadOnlyRgbLightningAdapter,
  PENDING_ADDRESS
} from './wallet-account-read-only-rgb-lightning.js'
import {
  UnlockError,
  VssError,
  VssNotConfiguredError,
  ApayError,
  WalletSyncError,
  WalletSnapshotError,
  NotImplementedError,
  wrapError
} from './errors.js'
import {
  WALLET_SNAPSHOT_CONTRACT_VERSION,
  WalletSnapshotContractError,
  isCoherentWalletSnapshot,
  normalizeWalletSnapshotOptions,
  validateWalletSnapshotResponse,
  validateWalletSyncResponse,
  walletSnapshotRequestKey
} from './wallet-snapshot-contract.js'

export { PENDING_ADDRESS }

/**
 * Seed-isolated via RLN's `NativeExternalSigner`: the WDK secret manager
 * owns the BIP-39 mnemonic; the manager derives a 32-byte VLS node
 * entropy from it and attaches a `NativeExternalSigner` to RLN. RLN's
 * on-disk state contains identifying public data only (xpubs, node id,
 * master fingerprint); the seed itself never reaches RLN's persistence
 * layer.
 *
 * @implements {IWalletAccount}
 */
export default class WalletAccountRgbLightning extends WalletAccountReadOnlyRgbLightning {
  /**
   * @param {{ binding: BareRgbLightningBinding }} bindings
   */
  constructor (bindings) {
    if (!bindings || !bindings.binding) {
      throw new Error('WalletAccountRgbLightning requires a BareRgbLightningBinding')
    }
    super(createReadOnlyRgbLightningAdapter(bindings.binding))
    /** @private */ this._binding = bindings.binding
    /** @private @type {WalletAccountReadOnlyRgbLightning | null} */
    this._readOnlyAccount = null
    /** @private @type {Promise<void>} */
    this._walletSnapshotQueue = Promise.resolve()
    /** @private @type {Map<string, Promise<object>>} */
    this._walletSnapshotInFlight = new Map()
  }

  /** @private */
  get _node () {
    return this._binding.ensureNode()
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * ✅ Bring the node online with an attached external signer. Accepts
   * `JsonSdkExternalUnlockRequest` (bitcoind RPC creds, indexer URL,
   * proxy, announce — no `password`). The signer was attached by
   * the manager at account-construction time.
   * @param {Object} unlockRequest
   */
  async unlock (unlockRequest) {
    try {
      this._binding.unlock(unlockRequest)
    } catch (e) {
      // Wrap into a typed UnlockError so callers can branch on
      // `err.name === 'UnlockError'` / `err.code` instead of
      // substring-matching the RLN message. The original message is
      // preserved verbatim and attached as `cause`.
      throw wrapError(e, UnlockError)
    }
    // Return something non-undefined so the worklet's `safeStringify`
    // produces a real string. The RN-side response schema rejects
    // null/undefined results (see wdk-react-native-core schemas).
    return { ok: true }
  }

  /** ✅ Idempotent shutdown. */
  async shutdown () {
    this._binding.shutdown()
    return { ok: true }
  }

  /**
   * Forcibly take over a stale VSS ownership fence after the previous
   * node died holding it. Authenticates with the wallet password.
   * Throws if VSS isn't configured (no `vssUrl` at construction).
   *
   * Recovery flow only — DO NOT call while another live node may still
   * hold the fence. Doing so corrupts the shared VSS state. See the VSS
   * docs section "Single-writer ownership" for the contract.
   *
   * @param {string} password
   * @throws {VssNotConfiguredError} if the wallet was built without a vssUrl.
   * @throws {VssError} if the takeover is rejected by the VSS server.
   */
  async clearVssFence (password) {
    this._assertVssConfigured()
    try {
      this._binding.clearVssFence(password)
    } catch (e) {
      throw wrapError(e, VssError)
    }
    return { ok: true }
  }

  /**
   * @private
   * @throws {VssNotConfiguredError} if no vssUrl was set at construction.
   */
  _assertVssConfigured () {
    const status = this._binding.vssStatus()
    if (!status || !status.configured) {
      throw new VssNotConfiguredError()
    }
  }

  /**
   * Force an immediate VSS backup flush. Returns `{ version }` where
   * version is the monotonically-increasing snapshot index just
   * persisted. The number is useful for ordering / "is this device
   * caught up with my last known checkpoint" comparisons; it carries
   * no other semantics.
   *
   * Throws if VSS isn't configured (no `vssUrl` at construction) or
   * the flush fails (server unreachable, auth rejected). Backed by
   * upstream `vss_backup()` UniFFI method. Requires the C-FFI patch
   * series at `rgb-lightning-node-bare/patches/` to be applied
   * before the static lib is built (adds `rln_sdk_node_vss_backup`).
   *
   * Use for app-controlled checkpoints (e.g. "save state before app
   * suspend") rather than relying on RLN's implicit on-write flush.
   * RLN already syncs to VSS on every state-changing operation; this
   * method is for the moments your app knows are critical (closing,
   * backgrounding, payment-just-settled) and wants a "fsync now"
   * round-trip with the cloud before potentially being killed.
   *
   * @returns {Promise<{version: number}>}
   * @throws {VssNotConfiguredError} if the wallet was built without a vssUrl.
   * @throws {VssError} if the flush fails (server unreachable, auth rejected).
   */
  async vssBackup () {
    this._assertVssConfigured()
    try {
      return this._binding.vssBackup()
    } catch (e) {
      throw wrapError(e, VssError)
    }
  }

  /**
   * Register this node with an LSP as an async-payments (APay) recipient.
   * Used for offline-receive over Lightning Address — the wallet uploads
   * a batch of pre-allocated payment hashes to the LSP, which then
   * accepts payments addressed to those hashes on the wallet's behalf
   * while this wallet is offline. The LSP later forwards the funds when
   * the wallet comes back online, redeeming the pre-allocated hash.
   *
   * Backed by upstream rgb-lightning-node PR #51 (`apay_new` UniFFI
   * method). Requires bare ≥ v0.1.0-beta.11 / nodejs ≥ v0.1.0-beta.7.
   *
   * @param {string} hostNodeId  - LSP's node_id (hex, 33-byte compressed secp256k1).
   * @returns {Promise<object>}  AsyncOrderNewResponse:
   *   `{ request_id, host_node_id, protocol_version, order_id, status,
   *      accepted_through_index, next_index_expected, unused_hashes,
   *      refill_batch_size, first_hash_index }`
   */
  async apayNew (hostNodeId) {
    try {
      return this._binding.apayNew(hostNodeId)
    } catch (e) {
      throw wrapError(e, ApayError)
    }
  }

  /**
   * One-shot LSP bootstrap. Renat's dev plan (May 27, items 3 + 4)
   * called for `/connectpeer` and `apay/new` to fire automatically as
   * part of SDK init. Rather than coupling them to `unlock()` — where
   * an LSP-handshake hiccup would block the rest of the wallet from
   * coming up — we expose them as one explicit opt-in method the
   * consumer calls after `unlock()` returns.
   *
   * Flow:
   *   1. `connectPeer(peerPubkeyAndAddr)` to dial the LSP's RLN node.
   *   2. Poll `listPeers` until the peer shows up (max `waitForPeerMs`).
   *      Necessary because RLN's `connectPeer` returns once the TCP
   *      handshake completes, but the noise handshake + the LDK peer
   *      table update lag ~5–30 s on real networks (this is the same
   *      race t22 in the E2E suite documents).
   *   3. Optionally `apayNew(hostNodeId)` to register as an async-pay
   *      recipient with the LSP. Skipped if `hostNodeId` is undefined.
   *
   * If any step throws, the partial state is left in place — the
   * consumer can retry, or call `connectPeer` / `apayNew` directly to
   * recover. This avoids the worst case of half-bootstrapping + then
   * failing the whole unlock.
   *
   * @param {object}  opts
   * @param {string}  opts.peerPubkeyAndAddr  LSP peer `pubkey@host:port` for connectPeer.
   * @param {string}  [opts.hostNodeId]       LSP's node_id (hex). When set, apayNew is
   *                                          called once the peer is visible. Omit to
   *                                          skip APay registration.
   * @param {number}  [opts.waitForPeerMs=30000]   How long to wait for the peer to show
   *                                          up in listPeers after connect. The 30s
   *                                          default matches the noise-handshake budget
   *                                          we observe on regtest + signet.
   * @param {number}  [opts.pollIntervalMs=1000]   How often to recheck listPeers.
   * @returns {Promise<{
   *   connect: object,
   *   peerVisible: boolean,
   *   apay?: object
   * }>}  `connect` is the connectPeer response, `peerVisible` is true if
   *      the peer reached listPeers within the window, `apay` is the
   *      AsyncOrderNewResponse from apayNew (omitted if hostNodeId was undefined).
   */
  async bootstrapLsp ({
    peerPubkeyAndAddr,
    hostNodeId,
    waitForPeerMs = 30000,
    pollIntervalMs = 1000
  } = {}) {
    if (typeof peerPubkeyAndAddr !== 'string' || peerPubkeyAndAddr.length === 0) {
      throw new TypeError('bootstrapLsp: peerPubkeyAndAddr (pubkey@host:port) is required')
    }
    // Extract `pubkey` so we can match against listPeers regardless of
    // address-format quirks (DNS vs IP vs trailing slash).
    const atIdx = peerPubkeyAndAddr.indexOf('@')
    const peerPubkey = atIdx > 0 ? peerPubkeyAndAddr.slice(0, atIdx) : peerPubkeyAndAddr
    if (peerPubkey.length === 0) {
      throw new TypeError('bootstrapLsp: peerPubkeyAndAddr must be in pubkey@host:port form')
    }

    const connect = await this.connectPeer(peerPubkeyAndAddr)

    // Wait until listPeers reflects the new peer. RLN's connectPeer
    // returns before LDK fully wires the channel manager; calling
    // apayNew before the peer is "ready" reliably triggers
    // Rln(Conflict): /apay/new timed out waiting for host response.
    //
    // Defensive shape handling: listPeers historically returned a
    // raw Vec<Peer> JSON array, but post-dev-merge the bare/nodejs
    // bindings wrap it as `{ peers: [...] }` to match RLN's HTTP
    // response shape (t22 in the E2E suite reads `.peers`). Accept
    // either.
    const deadline = Date.now() + Math.max(0, Number(waitForPeerMs) || 0)
    const pollMs = Math.max(100, Number(pollIntervalMs) || 1000)
    let peerVisible = false
    while (Date.now() < deadline) {
      const resp = await this.listPeers().catch(() => null)
      const peers = Array.isArray(resp)
        ? resp
        : (resp && Array.isArray(resp.peers) ? resp.peers : [])
      if (peers.some((p) => p && p.pubkey === peerPubkey)) {
        peerVisible = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs))
    }

    /** @type {{connect: object, peerVisible: boolean, apay?: object}} */
    const result = { connect, peerVisible }
    if (typeof hostNodeId === 'string' && hostNodeId.length > 0) {
      if (!peerVisible) {
        throw new ApayError(
          'bootstrapLsp: peer did not appear in listPeers within ' +
          `${waitForPeerMs}ms — refusing to call apayNew because RLN ` +
          'will time out waiting for host response. Retry later or ' +
          'call apayNew directly once the peer is visible.',
          { code: 'APAY_PEER_NOT_VISIBLE' }
        )
      }
      result.apay = await this.apayNew(hostNodeId)
    }
    return result
  }

  /**
   * Returns the `lspBaseUrl` / `lspBearerToken` this account's node was
   * constructed with (from the wallet-manager config). Useful to confirm
   * APay config matches the {@link createLsp} peer config. Mirrors
   * `@utexo/rgb-sdk-rn`'s `getLspConfig`.
   *
   * @returns {{ baseUrl: string|null, bearerToken: string|null }}
   */
  getLspConfig () {
    const cfg = (this._binding && this._binding._config) || {}
    return {
      baseUrl: cfg.lspBaseUrl ?? null,
      bearerToken: cfg.lspBearerToken ?? null
    }
  }

  /**
   * Build a {@link UtexoLsp} — the composed LSP flow object (connect,
   * wait-for-channel, receive/send asset, pay address, enable Lightning
   * Address, claim pending). Mirrors `@utexo/rgb-sdk-rn`'s
   * `wallet.createLsp(peer?)`.
   *
   * No-arg form auto-discovers the peer from the wallet's `lspBaseUrl`:
   * pubkey via `GET /get_info`, host from the base URL, port from
   * `peerPort` (default 9735).
   *
   * Explicit form takes a full LspPeer
   * (`{ baseUrl, peerPubkey, peerHost, peerPort, bearerToken?, timeoutMs?, allowHttp? }`).
   *
   * @param {object} [peer]
   * @param {number} [peerPort=9735]  Used only by the auto-discover form.
   * @returns {Promise<UtexoLsp>}
   */
  async createLsp (peer, peerPort = 9735) {
    if (peer) return new UtexoLsp(this, peer)

    const { baseUrl, bearerToken } = this.getLspConfig()
    if (!baseUrl) {
      throw new Error('createLsp: lspBaseUrl not set — pass a peer explicitly or construct the wallet with lspBaseUrl')
    }
    const http = new LspClient({
      baseUrl,
      defaultHeaders: bearerToken ? { Authorization: `Bearer ${bearerToken}` } : undefined
    })
    const info = await http.getInfo()
    if (!info || typeof info.pubkey !== 'string' || info.pubkey.length === 0) {
      throw new Error('createLsp: LSP /get_info returned no pubkey')
    }
    return new UtexoLsp(this, {
      baseUrl,
      peerPubkey: info.pubkey,
      peerHost: new URL(baseUrl).hostname,
      peerPort,
      bearerToken: bearerToken ?? undefined
    })
  }

  // ==========================================================================
  // Node lifecycle — read methods are inherited from the read-only account
  // ==========================================================================

  /**
   * Force the legacy Colored-only FastSync.
   * @deprecated Use `refreshWalletSnapshot()` so both keychains are synced.
   */
  async sync () {
    this._node.sync()
    return { ok: true }
  }

  /**
   * Synchronize both native wallet keychains and capture one versioned,
   * bounded snapshot. Identical concurrent requests coalesce, while different
   * requests serialize so FullSync and FullScan cannot race each other.
   *
   * A snapshot whose before/after chain tip differs is captured once more.
   * The method fails closed if the retry is also incoherent.
   *
   * @param {object} [options]
   * @returns {Promise<object>}
   */
  refreshWalletSnapshot (options) {
    const normalized = normalizeWalletSnapshotOptions(options)
    const key = walletSnapshotRequestKey(normalized)
    const current = this._walletSnapshotInFlight.get(key)
    if (current) return current

    const operation = this._walletSnapshotQueue
      .then(() => this._refreshWalletSnapshot(normalized))
    this._walletSnapshotQueue = operation.then(
      () => undefined,
      () => undefined
    )
    this._walletSnapshotInFlight.set(key, operation)
    operation.then(
      () => this._clearWalletSnapshotFlight(key, operation),
      () => this._clearWalletSnapshotFlight(key, operation)
    )
    return operation
  }

  /** @private */
  _clearWalletSnapshotFlight (key, operation) {
    if (this._walletSnapshotInFlight.get(key) === operation) {
      this._walletSnapshotInFlight.delete(key)
    }
  }

  /** @private */
  async _refreshWalletSnapshot (options) {
    const node = this._node
    if (
      typeof node.syncWallet !== 'function' ||
      typeof node.walletSnapshot !== 'function'
    ) {
      throw new WalletSnapshotError(
        'The installed RGB Lightning native binding does not support wallet snapshot contract v1.',
        { code: 'WALLET_SNAPSHOT_UNSUPPORTED_BINDING' }
      )
    }

    let sync = await this._synchronizeWalletForSnapshot(node, options.mode)

    const first = await this._captureWalletSnapshot(node, options)
    if (isCoherentWalletSnapshot(first)) {
      return Object.freeze({
        contractVersion: WALLET_SNAPSHOT_CONTRACT_VERSION,
        sync,
        snapshot: first
      })
    }

    // A moving chain tip can leave the first wallet sync behind the retry
    // capture. Synchronize both keychains again before accepting new-tip data.
    sync = await this._synchronizeWalletForSnapshot(node, options.mode)
    const retry = await this._captureWalletSnapshot(node, options)
    if (BigInt(retry.capture_sequence) <= BigInt(first.capture_sequence)) {
      throw new WalletSnapshotError(
        'The native wallet snapshot retry did not advance its capture sequence.',
        {
          code: 'WALLET_SNAPSHOT_CONTRACT_MISMATCH',
          details: Object.freeze({
            firstCaptureSequence: first.capture_sequence,
            retryCaptureSequence: retry.capture_sequence
          })
        }
      )
    }
    if (!isCoherentWalletSnapshot(retry)) {
      throw new WalletSnapshotError(
        'The native wallet snapshot changed chain tip during both capture attempts.',
        {
          code: 'WALLET_SNAPSHOT_INCOHERENT',
          details: Object.freeze({
            first: Object.freeze({
              before: first.network_before,
              after: first.network_after,
              captureSequence: first.capture_sequence
            }),
            retry: Object.freeze({
              before: retry.network_before,
              after: retry.network_after,
              captureSequence: retry.capture_sequence
            })
          })
        }
      )
    }

    return Object.freeze({
      contractVersion: WALLET_SNAPSHOT_CONTRACT_VERSION,
      sync,
      snapshot: retry
    })
  }

  /** @private */
  async _synchronizeWalletForSnapshot (node, mode) {
    let sync
    try {
      sync = validateWalletSyncResponse(
        await node.syncWallet({ mode }),
        mode
      )
    } catch (error) {
      const contractFailure = error instanceof WalletSnapshotContractError
      throw new WalletSyncError(
        contractFailure
          ? 'The native wallet sync response does not match contract v1.'
          : 'The native wallet synchronization failed.',
        {
          code: contractFailure
            ? 'WALLET_SYNC_CONTRACT_MISMATCH'
            : 'WALLET_SYNC_NATIVE_FAILURE',
          cause: error,
          details: Object.freeze({ mode })
        }
      )
    }

    if (sync.vanilla.status !== 'succeeded' || sync.colored.status !== 'succeeded') {
      throw new WalletSyncError(
        'The native wallet synchronization did not complete for both keychains.',
        {
          code: 'WALLET_SYNC_PARTIAL_FAILURE',
          details: Object.freeze({
            mode,
            vanilla: sync.vanilla,
            colored: sync.colored
          })
        }
      )
    }

    return sync
  }

  /** @private */
  async _captureWalletSnapshot (node, options) {
    try {
      return validateWalletSnapshotResponse(
        await node.walletSnapshot(options.nativeRequest),
        options
      )
    } catch (error) {
      if (error instanceof WalletSnapshotError) throw error
      const contractFailure = error instanceof WalletSnapshotContractError
      throw new WalletSnapshotError(
        contractFailure
          ? 'The native wallet snapshot does not match contract v1.'
          : 'The native wallet snapshot could not be captured.',
        {
          code: contractFailure
            ? 'WALLET_SNAPSHOT_CONTRACT_MISMATCH'
            : 'WALLET_SNAPSHOT_NATIVE_FAILURE',
          cause: error
        }
      )
    }
  }

  // ==========================================================================
  // Channels — ✅ all wired
  // ==========================================================================

  /**
   * Open a Lightning channel. Request is forwarded verbatim to RLN.
   *
   * For async-payments (APay) against a production LSP, open a virtual
   * channel by passing `virtual_open_mode: 'trusted_no_broadcast'` and
   * constructing the wallet with `enableVirtualChannelsV0: true` +
   * `virtualPeerPubkeys: [lspNodeId]`. Standard (broadcast) channels are
   * rejected by APay mobile clients.
   *
   * Note: RGB-routed HTLCs have a hard minimum of 3_000_000 msat (the
   * LSP's `MIN_AMT_MSAT`); size asset channels accordingly.
   *
   * @param {Object} request - JsonOpenChannelRequest (`peer_pubkey_and_opt_addr`,
   *   `capacity_sat`, `push_msat?`, `asset_id?`, `asset_amount?`, `public?`,
   *   `with_anchors?`, `virtual_open_mode?`).
   */
  async openChannel (request) { return this._node.openChannel(request) }

  /** @param {Object} request - JsonCloseChannelRequest */
  async closeChannel (request) {
    this._node.closeChannel(request)
    return { ok: true }
  }

  // ==========================================================================
  // Peers — ✅ all wired
  // ==========================================================================

  /** @param {string} peerPubkeyAndAddr - "<pubkey>@<host>:<port>" */
  async connectPeer (peerPubkeyAndAddr) {
    try {
      this._node.connectPeer(peerPubkeyAndAddr)
    } catch (e) {
      // RLN stores peers in its `channel_peer` table and reconnects
      // automatically on SDK restart. A second connect attempt to
      // an already-known peer returns `Rln(Conflict)` — that's the
      // desired end state, so swallow it. Anything else propagates.
      const msg = String(e && e.message ? e.message : e)
      if (!msg.includes('Conflict')) throw e
    }
    // RLN's `connectpeer` returns `()` → JSON `null`. The RN-side
    // `AccountService.callAccountMethod` rejects null/undefined
    // results with "Parsed result is null or undefined", so return a
    // non-null sentinel.
    return { ok: true }
  }

  /** @param {Object} request - JsonDisconnectPeerRequest */
  async disconnectPeer (request) {
    this._node.disconnectPeer(request)
    return { ok: true }
  }

  // ==========================================================================
  // BOLT11 invoices — ✅ wired
  // ==========================================================================

  /**
   * Create a BOLT11 invoice (BTC or RGB-asset-bound).
   *
   * @param {Object}  request
   * @param {number}  [request.amt_msat]            Optional fixed amount.
   * @param {number}   request.expiry_sec           Invoice expiry, seconds.
   * @param {string}  [request.asset_id]            RGB contract id for an asset-bound invoice.
   * @param {number}  [request.asset_amount]        RGB units (with asset_id).
   * @param {string}  [request.payment_hash]        Pre-image hash for HODL invoices.
   * @param {string}  [request.description_hash]    LUD-06 description hash (hex).
   * @param {number}  [request.min_final_cltv_expiry_delta]
   *   Override the min_final_cltv_expiry on the BOLT11. Required for APay
   *   outbound flows where the LSP needs the wallet's outbound invoice to
   *   honor a tunable claim-deadline policy. Passthrough — RLN-side default
   *   applies when omitted.
   */
  async createInvoice (request) { return this._node.lnInvoice(request) }

  /**
   * Cross-SDK alias for {@link createInvoice}. The reference on-chain
   * SDK (`@utexo/rgb-sdk-rn`) names the receive-side entry
   * `createLightningInvoice`; we expose the same name here for
   * discoverability, accepting either the native RLN snake_case request
   * (forwarded verbatim) or a camelCase convenience shape
   * `{ amountMsat?, expirySec, assetId?, assetAmount?, paymentHash?,
   *    descriptionHash?, minFinalCltvExpiryDelta? }`.
   *
   * Unlike the reference SDK's stub (which throws "not implemented"),
   * this is fully backed by a local LDK node.
   *
   * @param {Object} request
   * @returns {Promise<object>}  RLN's lnInvoice response (invoice, payment_hash, ...).
   */
  async createLightningInvoice (request) {
    return this.createInvoice(WalletAccountRgbLightning._toLnInvoiceRequest(request))
  }

  /**
   * Normalise a camelCase convenience invoice request to RLN's
   * snake_case shape. Passes through snake_case keys untouched so a
   * native request object still works verbatim.
   * @private
   * @param {Object} [req]
   * @returns {Object}
   */
  static _toLnInvoiceRequest (req) {
    if (!req || typeof req !== 'object') return req
    const out = { ...req }
    const map = {
      amountMsat: 'amt_msat',
      expirySec: 'expiry_sec',
      assetId: 'asset_id',
      assetAmount: 'asset_amount',
      paymentHash: 'payment_hash',
      descriptionHash: 'description_hash',
      minFinalCltvExpiryDelta: 'min_final_cltv_expiry_delta'
    }
    for (const [camel, snake] of Object.entries(map)) {
      if (camel in out && !(snake in out)) {
        out[snake] = out[camel]
        delete out[camel]
      }
    }
    return out
  }

  /**
   * Create a HODL (hold) invoice — a BOLT11 bound to a caller-supplied
   * `paymentHash` whose preimage the receiver releases later via
   * {@link claimHodlInvoice}. Convenience wrapper over
   * {@link createInvoice} (which already accepts `payment_hash`); named
   * for parity with `@utexo/rgb-sdk-rn`'s `createHodlInvoice`.
   *
   * @param {object} params
   * @param {string}  params.paymentHash             32-byte payment hash (hex).
   * @param {number} [params.amtMsat]
   * @param {number}  params.expirySec
   * @param {string} [params.assetId]
   * @param {number} [params.assetAmount]
   * @param {number} [params.minFinalCltvExpiryDelta]
   * @returns {Promise<{ bolt11:string, paymentHash:string }>}
   */
  async createHodlInvoice (params = {}) {
    if (!params || typeof params.paymentHash !== 'string' || params.paymentHash.length === 0) {
      throw new TypeError('createHodlInvoice: params.paymentHash (hex) is required')
    }
    const res = await this.createLightningInvoice({
      paymentHash: params.paymentHash,
      amountMsat: params.amtMsat ?? undefined,
      expirySec: params.expirySec,
      assetId: params.assetId ?? undefined,
      assetAmount: params.assetAmount ?? undefined,
      minFinalCltvExpiryDelta: params.minFinalCltvExpiryDelta ?? undefined
    })
    return {
      bolt11: res?.invoice ?? res?.bolt11 ?? '',
      paymentHash: res?.payment_hash ?? params.paymentHash
    }
  }

  // Hodl invoices — 🚧 (request shape is upstream-defined; passthrough kept simple)
  /** @param {Object} request */
  async cancelHodlInvoice (request) {
    this._node.cancelHodlInvoice(request)
    return { ok: true }
  }

  /** @param {Object} request */
  async claimHodlInvoice (request) { return this._node.claimHodlInvoice(request) }

  // ==========================================================================
  // Payments — ✅ wired
  // ==========================================================================

  /** @param {Object} request - JsonSendPaymentRequest (invoice, amt_msat?, asset_id?, ...) */
  async sendPayment (request) { return this._node.sendPayment(request) }

  /** @param {Object} request - JsonKeysendRequest (dest_pubkey, amt_msat, asset_id?, ...) */
  async keysend (request) { return this._node.keysend(request) }

  // Atomic-swap surface (`makerInit` / `makerExecute` / `taker` /
  // `listSwaps` / `getSwap`) is intentionally NOT exposed at the WDK
  // layer — Renat scoped it out for this module (2026-04-30). The
  // bare addon still passes through to the C-FFI for any other
  // consumer that wants it.

  // ==========================================================================
  // RGB asset issuance + transfers — ✅ wired
  // ==========================================================================

  /** @param {Object} request */
  async issueAssetNia (request) { return this._node.issueAssetNia(request) }
  async issueAssetUda (request) { return this._node.issueAssetUda(request) }
  async issueAssetCfa (request) { return this._node.issueAssetCfa(request) }
  async issueAssetIfa (request) { return this._node.issueAssetIfa(request) }

  /** @param {Object} request */
  async refreshTransfers (request) {
    this._node.refreshTransfers(request)
    return { ok: true }
  }

  /** @param {Object} request */
  async failTransfers (request) { return this._node.failTransfers(request) }

  /**
   * Create an RGB invoice. Forwarded verbatim to RLN's `rgbInvoice`
   * (`JsonRgbInvoiceRequest`). REQUIRED fields — RLN rejects the request on
   * deserialise if either is omitted:
   *   - `min_confirmations` {number}
   *   - `witness` {boolean}  true = witness (on-chain) receive, false = blinded
   * Optional: `asset_id`, `assignment_kind`
   * (`'Fungible'|'NonFungible'|'InflationRight'|'ReplaceRight'|'Any'`),
   * `assignment_amount`, `duration_seconds`.
   * @param {Object} request - JsonRgbInvoiceRequest (see above).
   */
  async createRgbInvoice (request) { return this._node.rgbInvoice(request) }

  /**
   * Send an RGB asset. Forwarded verbatim to RLN's `sendRgb`
   * (`JsonSendRgbRequest`):
   *   {
   *     donation: boolean,
   *     fee_rate: number,            // sat/vB
   *     min_confirmations: number,
   *     recipient_groups: [{
   *       asset_id: string,
   *       recipients: [{
   *         recipient_id: string,           // from decodeRgbInvoice
   *         assignment_kind: 'Fungible' | 'NonFungible' | 'InflationRight' | 'ReplaceRight' | 'Any',
   *         assignment_amount?: number,
   *         transport_endpoints: string[],  // from decodeRgbInvoice
   *         witness_data?: { amount_sat: number, blinding?: number }
   *       }]
   *     }]
   *   }
   * RLN rejects the old flat `{ recipient_id, amount, asset_id }` shape on
   * deserialise. For a simple amount-based fungible send, prefer the generic
   * `transfer({ recipient: <rgbInvoice>, amount, token })`, which decodes the
   * invoice and assembles this request for you.
   * @param {Object} request - JsonSendRgbRequest (see above).
   */
  async sendRgbAsset (request) { return this._node.sendRgb(request) }

  /** @param {Object} request - JsonInflateRequest */
  async inflate (request) { return this._node.inflate(request) }

  /** @param {Object} request */
  async postAssetMedia (request) { return this._node.postAssetMedia(request) }

  // ==========================================================================
  // BTC ops — ✅ wired
  // ==========================================================================

  /** Raw RLN send-btc escape hatch for callers that already own the native request shape. */
  async sendBtc (request) { return this._node.sendBtc(request) }

  /**
   * WDK-standard on-chain send. Accepts `{ to, value, feeRate?,
   * confirmationTarget? }`; the former RLN `{ address, amount, fee_rate,
   * skip_sync? }` shape remains accepted during the beta migration.
   */
  async sendTransaction (tx) {
    if (!tx || typeof tx !== 'object') {
      throw new TypeError('sendTransaction(tx) requires a transaction object')
    }
    const to = tx.to ?? tx.address
    const value = tx.value ?? tx.amount
    if (typeof to !== 'string' || to.length === 0) {
      throw new TypeError('sendTransaction(tx) requires a non-empty to address')
    }
    const amount = Number(value)
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new TypeError('sendTransaction(tx) value must be a non-negative safe integer in satoshis')
    }

    const confirmationTarget = tx.confirmationTarget ?? 6
    const feeRate = tx.feeRate ?? tx.fee_rate ?? await this._defaultFeeRate(confirmationTarget)
    const quote = await this.quoteSendTransaction({ to, value, feeRate, confirmationTarget })
    const response = await this.sendBtc({
      address: to,
      amount,
      fee_rate: Number(feeRate),
      skip_sync: Boolean(tx.skipSync ?? tx.skip_sync ?? false)
    })
    return { hash: response?.txid ?? response?.hash ?? '', fee: quote.fee }
  }

  /** Rotate to a new receive address. Read-only accounts expose only the stable current address. */
  async rotateAddress () {
    if (typeof this._node.rotateAddress !== 'function') {
      throw new Error('The installed RGB Lightning native binding does not expose rotateAddress()')
    }
    const response = await this._node.rotateAddress()
    const address = typeof response === 'string' ? response : response?.address
    if (typeof address !== 'string' || address.length === 0) {
      throw new Error('RGB Lightning node returned an invalid rotated address')
    }
    return address
  }

  /** @param {Object} request - JsonCreateUtxosRequest */
  async createUtxos (request) {
    this._node.createUtxos(request)
    return { ok: true }
  }

  // ==========================================================================
  // Onion messages / signing / diagnostics — ✅ wired
  // ==========================================================================

  /** @param {Object} request - JsonSendOnionMessageRequest */
  async sendOnionMessage (request) {
    this._node.sendOnionMessage(request)
    return { ok: true }
  }

  /** @returns {Promise<string>} Lightning zbase32 message signature. */
  async sign (message) {
    const response = await this._node.signMessage(message)
    const signature = response?.signed_message ?? response?.signature ?? response
    if (typeof signature !== 'string' || signature.length === 0) {
      throw new Error('RGB Lightning node returned an invalid message signature')
    }
    return signature
  }

  // ==========================================================================
  // IWalletAccount surface — generic operations routed onto RLN
  // ==========================================================================

  /**
   * Sign an arbitrary tx. RLN's external signer signs the LN+RGB tx
   * shapes it constructs internally; raw PSBT signing is not exposed
   * via the c-ffi surface (VLS policy filter would reject anything it
   * didn't construct itself anyway). Callers should use
   * `sendTransaction` (auto-signs an on-chain spend) or the LN /
   * RGB-specific methods instead.
   *
   * @returns {Promise<never>}
   */
  async signTransaction (_tx) {
    throw new NotImplementedError(
      'signTransaction() is not exposed on RGB Lightning accounts — ' +
      'use sendTransaction(request) for on-chain spends (VLS signs in-process), ' +
      'sendPayment/keysend for LN, or sendRgbAsset for RGB transfers.'
    )
  }

  /**
   * Generic transfer router. Inspects the recipient form and dispatches:
   *   - BOLT11 invoice → `sendPayment({ invoice, amt_msat?, asset_id? })`
   *   - LN node pubkey  → `keysend({ dest_pubkey, amt_msat, asset_id? })`
   *   - BTC address     → `sendTransaction({ to, value, feeRate })`
   *   - RGB invoice     → `sendRgbAsset` (asset_id picked from invoice)
   *
   * `options.token` is interpreted as an RGB asset_id when present.
   * `options.amount` is treated as **msats** for LN flows and **sats**
   * for on-chain flows — callers using `transfer()` for on-chain need to
   * pass sats, not msats. For finer control, call the underlying method
   * directly.
   *
   * @param {TransferOptions} options
   * @returns {Promise<TransferResult>}
   */
  async transfer (options) {
    if (!options || typeof options !== 'object') {
      throw new Error('transfer: options must be { recipient, amount, token? }')
    }
    const recipient = options.recipient
    const amount = options.amount
    const assetId = options.token && options.token.length > 0 ? options.token : null
    const kind = WalletAccountRgbLightning._classifyRecipient(recipient)

    switch (kind) {
      case 'bolt11': {
        const req = { invoice: recipient }
        if (amount !== undefined && amount !== null) req.amt_msat = Number(amount)
        if (assetId) req.asset_id = assetId
        const r = await this.sendPayment(req)
        return { hash: r?.payment_hash ?? '', fee: BigInt(r?.fee_msat ?? 0n) }
      }
      case 'ln-pubkey': {
        if (amount === undefined || amount === null) {
          throw new Error('transfer(keysend): amount (msats) is required')
        }
        const req = { dest_pubkey: recipient, amt_msat: Number(amount) }
        if (assetId) req.asset_id = assetId
        const r = await this.keysend(req)
        return { hash: r?.payment_hash ?? '', fee: BigInt(r?.fee_msat ?? 0n) }
      }
      case 'btc-address': {
        if (amount === undefined || amount === null) {
          throw new Error('transfer(on-chain): amount (sats) is required')
        }
        const feeRate = options.feeRate ?? await this._defaultFeeRate(6)
        return this.sendTransaction({
          to: recipient,
          value: amount,
          feeRate,
          confirmationTarget: 6
        })
      }
      case 'rgb-invoice': {
        // RGB send. The recipient IS the rgb invoice, which encodes the
        // recipient_id, the asset, and — crucially — the receiver's
        // consignment transport endpoints. RLN's `sendRgb` does NOT
        // re-derive any of these: it requires a nested `recipient_groups`
        // request with explicit `transport_endpoints` (the flat
        // `{ recipient_id, amount, asset_id }` shape this used to build is
        // rejected on deserialise). So decode the invoice and assemble the
        // request from it, mirroring the working rgb-sdk-rn / wdk-wallet-rgb
        // sends. transfer() assumes a Fungible assignment (the natural case
        // for an amount-based transfer); non-fungible or multi-recipient
        // sends should call sendRgbAsset() with a full SendRgbAssetRequest.
        if (amount === undefined || amount === null) {
          throw new Error('transfer(rgb): amount (asset units) is required')
        }
        const decoded = await this.decodeRgbInvoice(recipient)
        const recipientId = decoded?.recipient_id
        if (!recipientId) {
          throw new Error('transfer(rgb): could not decode a recipient_id from the RGB invoice')
        }
        const contractId = assetId ?? decoded?.asset_id
        if (!contractId) {
          throw new Error('transfer(rgb): asset_id missing — pass options.token or use an invoice that encodes the asset')
        }
        const endpoints = (Array.isArray(decoded?.transport_endpoints) && decoded.transport_endpoints.length > 0)
          ? decoded.transport_endpoints
          : this._defaultTransportEndpoints()
        if (endpoints.length === 0) {
          throw new Error('transfer(rgb): the RGB invoice carries no transport endpoints and the wallet has no proxyEndpoint configured')
        }
        const feeRate = options.feeRate ?? await this._defaultFeeRate(6)
        const req = {
          donation: false,
          fee_rate: Number(feeRate),
          min_confirmations: 1,
          recipient_groups: [{
            asset_id: contractId,
            recipients: [{
              recipient_id: recipientId,
              assignment_kind: 'Fungible',
              assignment_amount: Number(amount),
              transport_endpoints: endpoints
            }]
          }]
        }
        const r = await this.sendRgbAsset(req)
        // RLN's send response carries the txid; the on-chain fee for an RGB
        // transfer isn't surfaced separately, so report 0 (unchanged).
        return { hash: r?.txid ?? '', fee: BigInt(0) }
      }
      default:
        throw new Error(`transfer: unhandled recipient kind "${kind}"`)
    }
  }

  /**
   * Returns the LN node identity as the account's key pair.
   *
   * Rationale: the account's "identity" on the LN network is the
   * node_id (33-byte compressed secp256k1 pubkey). For on-chain
   * receive addresses we use the account xpub (also in bootstrap) but
   * the IWalletAccount contract asks for a single `KeyPair`. The
   * privateKey is always `null` — VLS owns the signing material and
   * never exposes it.
   *
   * @returns {KeyPair}
   */
  get index () { return 0 }

  /** VLS derives the node identity directly from root entropy, not a BIP-44 child. */
  get path () { return 'm' }

  get keyPair () {
    const b = this._binding.bootstrap()
    if (!b || typeof b.node_id !== 'string') {
      throw new Error('keyPair: bootstrap did not return a node_id')
    }
    const publicKey = Uint8Array.from(Buffer.from(b.node_id, 'hex'))
    return { publicKey, privateKey: null }
  }

  /** @deprecated Use the WDK-standard `keyPair` getter. */
  getKeyPair () { return this.keyPair }

  /**
   * Return the cached WDK read-only account backed by the immutable query
   * adapter created during construction.
   *
   * @returns {Promise<IWalletAccountReadOnly>}
   */
  async toReadOnlyAccount () {
    if (!this._readOnlyAccount) {
      this._readOnlyAccount = new WalletAccountReadOnlyRgbLightning(this._reader)
    }
    return this._readOnlyAccount
  }

  /**
   * Wallet's configured RGB consignment proxy as a single-element
   * `transport_endpoints` list — the fallback `transfer()` uses for an RGB
   * send when the decoded invoice carries no endpoints of its own (a
   * well-formed invoice always does, so this is defensive). Returns `[]`
   * when no `proxyEndpoint` was set at construction.
   * @private
   * @returns {string[]}
   */
  _defaultTransportEndpoints () {
    const cfg = (this._binding && this._binding._config) || {}
    return cfg.proxyEndpoint ? [cfg.proxyEndpoint] : []
  }

  // ==========================================================================
  // LSP integration — utexo-lsp (or any LUD-06 / utexo-lsp-compatible server)
  // ==========================================================================
  // Thin pass-throughs to ./lsp-helpers.js so callers can do
  //   await account.payLightningAddress('alice@lsp.example', 5_000_000n)
  // without importing the helpers module. The helpers are also
  // exported standalone for advanced callers that prefer functional
  // composition over instance methods (e.g. for read-only accounts).

  /**
   * Pay a Lightning Address (LUD-06). Works against any LNURL-pay
   * server, including but not limited to utexo-lsp.
   * @see ./lsp-helpers.js#payLightningAddress
   */
  payLightningAddress (addr, amountMsat, opts) {
    return _payLightningAddress(this, addr, amountMsat, opts)
  }

  /**
   * Ask an LSP to broker an RGB→LN deposit: wallet supplies (or mints)
   * a BOLT11 invoice; LSP returns an RGB invoice for the sender.
   * @see ./lsp-helpers.js#requestLspRgbDeposit
   */
  requestLspRgbDeposit (args) { return _requestLspRgbDeposit(this, args) }

  /**
   * Pay an RGB invoice via an LSP-mediated LN payment.
   * @see ./lsp-helpers.js#payRgbViaLsp
   */
  payRgbViaLsp (args) { return _payRgbViaLsp(this, args) }

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  dispose () {
    // The binding owns the signer (created from the WDK seed) and is
    // shut down by the manager's dispose(); the account itself holds
    // no sensitive state.
  }
}
