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

/**
 * Sentinel placeholder address returned by `getAddress()` before the
 * node is unlocked. Format-valid testnet bech32 (passes
 * `wdk-react-native-core`'s `isBitcoinAddress` regex) but visibly
 * synthetic so consumers can detect it and mask the display.
 */
export const PENDING_ADDRESS = 'tb1qpendingunlock00000000000000000000000000'

/**
 * Approximate vbyte count for a typical 1-input 2-output P2WPKH spend.
 * Used by `quoteTransfer` / `quoteSendTransaction` since RLN doesn't
 * expose a tx-shape-aware fee estimator. Calibrate against actual
 * sendTransaction telemetry if accuracy ever becomes load-bearing.
 */
const APPROX_BTC_TX_VBYTES = 141

/**
 * Basis points used to approximate LN routing fees in `quoteTransfer`
 * when no probe path is available. ~50 bps (0.5%) is a conservative
 * over-estimate vs typical mainnet routing fees (~0.1-0.3%); favours
 * not under-quoting.
 */
const LN_FEE_BPS = 50

/**
 * Fallback sat/vB rate when `estimateFee` fails (regtest or network
 * hiccup). Picks a moderate value — better to over-quote than to fail.
 */
const DEFAULT_FEE_RATE_SAT_PER_VB = 5

/**
 * Watch-only via RLN's `NativeExternalSigner`: the WDK secret manager
 * owns the BIP-39 mnemonic; the manager derives a 32-byte VLS node
 * entropy from it and attaches a `NativeExternalSigner` to RLN. RLN's
 * on-disk state contains identifying public data only (xpubs, node id,
 * master fingerprint); the seed itself never reaches RLN's persistence
 * layer.
 *
 * Method coverage tracker:
 *
 *   ✅ wired (forwards to SdkNode)
 *   🚧 stub (throws NotImplemented — needs design)
 *
 * @implements {IWalletAccount}
 */
export default class WalletAccountRgbLightning {
  /**
   * @param {{ binding: BareRgbLightningBinding }} bindings
   */
  constructor (bindings) {
    if (!bindings || !bindings.binding) {
      throw new Error('WalletAccountRgbLightning requires a BareRgbLightningBinding')
    }
    /** @private */ this._binding = bindings.binding
    /** @private */ this._index = 0
  }

  /** @private */
  get _node () {
    return this._binding.node
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
    this._binding.unlock(unlockRequest)
    // Return something non-undefined so the worklet's `safeStringify`
    // produces a real string. The RN-side response schema rejects
    // null/undefined results (see wdk-react-native-core schemas).
    return { ok: true }
  }

  /**
   * ✅ Return the external-signer bootstrap dictionary (node id, account
   * xpubs, master fingerprint). Useful for displaying the on-chain
   * receive identity before unlock has completed, and for diagnostics.
   */
  async getBootstrap () {
    return this._binding.bootstrap()
  }

  /** ✅ Idempotent shutdown. */
  async shutdown () {
    this._binding.shutdown()
    return { ok: true }
  }

  // ==========================================================================
  // Node info / network / sync — ✅ wired
  // ==========================================================================

  /** @returns {Object} node info (pubkey, num peers, num channels, etc.) */
  async getNodeInfo () { return this._node.nodeInfo() }

  /** @returns {Object} network info (block height, network) */
  async getNetworkInfo () { return this._node.networkInfo() }

  /** Force a sync of the on-chain wallet. */
  async sync () {
    this._node.sync()
    return { ok: true }
  }

  /**
   * ✅ Returns a fresh on-chain receive address.
   *
   * `useAccount({ network: 'rgb-lightning' })` on the RN side calls this
   * eagerly on mount, *before* the user has entered bitcoind/indexer
   * credentials and called `unlock()`. RLN throws `Rln(NotInitialized)`
   * until unlock — but the RN side's `useAddressLoader` will retry on
   * error every render, blowing the React update-depth limit.
   *
   * To break the loop without breaking the contract:
   *   • If `unlock()` has run, return the real address (string).
   *   • Otherwise return a clearly-fake but format-valid placeholder so
   *     the loader caches it and stops retrying. The LN screen detects
   *     the placeholder and renders "(unlock to view)" instead.
   *
   * Wallet-store schema requires bitcoin format `^(1|3|bc1|m|n|2|tb1)…`,
   * so we use a `tb1q` prefix.
   */
  getAddress () {
    try {
      const addr = this._node.address()
      if (addr && typeof addr === 'object' && addr.address) return addr.address
      if (typeof addr === 'string' && addr.length > 0) return addr
    } catch (_e) {
      // fall through
    }
    return PENDING_ADDRESS
  }

  // ==========================================================================
  // Channels — ✅ all wired
  // ==========================================================================

  /** @param {Object} request - JsonOpenChannelRequest */
  async openChannel (request) { return this._node.openChannel(request) }

  /** @param {Object} request - JsonCloseChannelRequest */
  async closeChannel (request) {
    this._node.closeChannel(request)
    return { ok: true }
  }

  async listChannels () { return this._node.listChannels() }

  /** @param {string} temporaryChannelIdHex */
  async getChannelId (temporaryChannelIdHex) {
    return this._node.getChannelId(temporaryChannelIdHex)
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

  async listPeers () { return this._node.listPeers() }

  // ==========================================================================
  // BOLT11 invoices — ✅ wired
  // ==========================================================================

  /** @param {Object} request - JsonLnInvoiceRequest (amount_msat, expiry_sec, asset_id, asset_amount, ...) */
  async createInvoice (request) { return this._node.lnInvoice(request) }

  /** @param {string} invoice */
  async decodeInvoice (invoice) { return this._node.decodeLnInvoice(invoice) }

  /** @param {string} invoice */
  async getInvoiceStatus (invoice) { return this._node.invoiceStatus(invoice) }

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

  /** @param {Object} request - JsonSendPaymentRequest (invoice, amount_msat, ...) */
  async sendPayment (request) { return this._node.sendPayment(request) }

  /** @param {Object} request - JsonKeysendRequest (dest_pubkey, amount_msat, asset_id, ...) */
  async keysend (request) { return this._node.keysend(request) }

  async listPayments () { return this._node.listPayments() }

  /** @param {string} paymentHashHex
   *  @param {'sent'|'received'} paymentType */
  async getPayment (paymentHashHex, paymentType) {
    return this._node.getPayment(paymentHashHex, paymentType)
  }

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

  /** @param {string[]} [filterAssetSchemas] */
  async listAssets (filterAssetSchemas) {
    return this._node.listAssets(filterAssetSchemas)
  }

  /** @param {string} assetId */
  async getAssetBalance (assetId) { return this._node.assetBalance(assetId) }

  /** @param {string} assetId */
  async getAssetMetadata (assetId) { return this._node.assetMetadata(assetId) }

  /** @param {string} [assetId] */
  async listTransfers (assetId) { return this._node.listTransfers(assetId) }

  /** @param {Object} request */
  async refreshTransfers (request) {
    this._node.refreshTransfers(request)
    return { ok: true }
  }

  /** @param {Object} request */
  async failTransfers (request) { return this._node.failTransfers(request) }

  /** @param {Object} request - JsonRgbInvoiceRequest */
  async createRgbInvoice (request) { return this._node.rgbInvoice(request) }

  /** @param {string} invoice */
  async decodeRgbInvoice (invoice) { return this._node.decodeRgbInvoice(invoice) }

  /** @param {Object} request - JsonSendAssetRequest */
  async sendRgbAsset (request) { return this._node.sendRgb(request) }

  /** @param {Object} request - JsonInflateRequest */
  async inflate (request) { return this._node.inflate(request) }

  /** @param {string} digest */
  async getAssetMedia (digest) { return this._node.getAssetMedia(digest) }
  /** @param {Object} request */
  async postAssetMedia (request) { return this._node.postAssetMedia(request) }

  // ==========================================================================
  // BTC ops — ✅ wired
  // ==========================================================================

  /**
   * IWalletAccount contract: return the on-chain spendable balance as a
   * numeric satoshi string. `useBalance` (TanStack Query) auto-calls
   * this on mount and `AccountService.callAccountMethod` validates the
   * result against `^\d+$` — anything else throws "Invalid balance
   * format" and retries on a tight loop.
   *
   * Pre-unlock the node throws `Rln(NotInitialized)`; we swallow that
   * into "0" so the schema accepts and the loop stops. Post-unlock the
   * caller can pull the full breakdown via `getBalanceDetails`.
   *
   * @param {boolean} [skipSync]
   * @returns {Promise<string>}
   */
  async getBalance (skipSync = false) {
    try {
      const r = this._node.btcBalance(!!skipSync)
      const sats = r?.vanilla?.spendable ?? r?.vanilla?.settled ?? 0
      return String(sats)
    } catch (_e) {
      return '0'
    }
  }

  /**
   * Full on-chain balance breakdown — `{ vanilla: { settled, future,
   * spendable }, colored: {...} }`. Used by the LN screen for the
   * detailed view; not part of the standard IWalletAccount contract.
   * @param {boolean} [skipSync]
   */
  async getBalanceDetails (skipSync = false) {
    return this._node.btcBalance(!!skipSync)
  }

  /** ✅ External signer signs the on-chain spend in-process via VLS;
   *  RLN never sees the seed.
   *  @param {Object} request - JsonSendBtcRequest */
  async sendTransaction (request) { return this._node.sendBtc(request) }

  /** @param {boolean} [skipSync] */
  async getTransactions (skipSync = false) {
    return this._node.listTransactions(skipSync)
  }

  /** @param {boolean} [skipSync] */
  async listUnspents (skipSync = false) {
    return this._node.listUnspents(skipSync)
  }

  /** @param {Object} request - JsonCreateUtxosRequest */
  async createUtxos (request) {
    this._node.createUtxos(request)
    return { ok: true }
  }

  /** @param {number} blocks - target confirmation in blocks (1..=65535) */
  async estimateFee (blocks) {
    return this._node.estimateFee(blocks)
  }

  // ==========================================================================
  // Onion messages / signing / diagnostics — ✅ wired
  // ==========================================================================

  /** @param {Object} request - JsonSendOnionMessageRequest */
  async sendOnionMessage (request) {
    this._node.sendOnionMessage(request)
    return { ok: true }
  }

  /** @param {string} message
   *  @returns {Promise<{ signature: string }>} */
  async sign (message) { return this._node.signMessage(message) }

  /** @param {string} indexerUrl */
  async checkIndexerUrl (indexerUrl) { return this._node.checkIndexerUrl(indexerUrl) }

  /** @param {string} proxyEndpoint */
  async checkProxyEndpoint (proxyEndpoint) {
    this._node.checkProxyEndpoint(proxyEndpoint)
    return { ok: true }
  }

  // ==========================================================================
  // IWalletAccount surface — generic operations routed onto RLN
  // ==========================================================================

  /**
   * Identifies the recipient form so `transfer()` / `quoteTransfer()`
   * can dispatch to the right backing RLN method.
   * @private
   * @param {string} recipient
   * @returns {'bolt11'|'rgb-invoice'|'ln-pubkey'|'btc-address'}
   */
  static _classifyRecipient (recipient) {
    if (typeof recipient !== 'string' || recipient.length === 0) {
      throw new Error('transfer: recipient must be a non-empty string')
    }
    const r = recipient.trim()
    // BOLT11 — bech32-encoded; case is normalised to lowercase here. The
    // human-readable prefix is `lnbc`/`lntb`/`lnbcrt`/`lnsb` (mainnet /
    // testnet / regtest / signet) followed by an amount + payload.
    if (/^ln(bc|tb|bcrt|sb)/i.test(r)) return 'bolt11'
    // RGB invoice — defined by the rgb-rs invoice URI scheme.
    if (r.toLowerCase().startsWith('rgb:') || r.toLowerCase().startsWith('utxob:')) return 'rgb-invoice'
    // 33-byte compressed secp256k1 pubkey in hex (LN node id form).
    if (/^[0-9a-fA-F]{66}$/.test(r)) return 'ln-pubkey'
    // Default: assume bitcoin address; let RLN's address parser reject
    // malformed values rather than re-implementing the bech32/base58
    // bitcoin-address grammar here.
    return 'btc-address'
  }

  /**
   * Verify a message signature.
   *
   * RLN's `sign_message` produces a recoverable LN-style signature
   * (zbase32-encoded over `"Lightning Signed Message:" + msg`).
   * The c-ffi does NOT currently expose a matching `verify_message`,
   * so we cannot round-trip the signature without either:
   *   a) wiring `lightning::util::message_signing::verify` into c-ffi
   *      (upstream change), or
   *   b) reimplementing the zbase32 + ecdsa-recover path in JS.
   *
   * Both are out of scope for this iteration; verify stays a documented
   * gap. Track upstream + bump when c-ffi exposes verify_message.
   *
   * @param {string} _message
   * @param {string} _signature
   * @returns {Promise<boolean>}
   */
  async verify (_message, _signature) {
    throw new Error(
      'verify() requires upstream c-ffi support for rln_verify_message — ' +
      'pending: expose lightning::util::message_signing::verify in rgb-lightning-node/bindings/c-ffi.'
    )
  }

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
    throw new Error(
      'signTransaction() is not exposed on RGB Lightning accounts — ' +
      'use sendTransaction(request) for on-chain spends (VLS signs in-process), ' +
      'sendPayment/keysend for LN, or sendRgbAsset for RGB transfers.'
    )
  }

  /**
   * Generic transfer router. Inspects the recipient form and dispatches:
   *   - BOLT11 invoice → `sendPayment({ invoice, amt_msat?, asset_id? })`
   *   - LN node pubkey  → `keysend({ dest_pubkey, amt_msat, asset_id? })`
   *   - BTC address     → `sendTransaction({ address, amount, fee_rate, skip_sync })`
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
        const req = {
          address: recipient,
          amount: Number(amount),
          fee_rate: Number(feeRate),
          skip_sync: false
        }
        const r = await this.sendTransaction(req)
        const fee = BigInt(Math.round(Number(feeRate) * APPROX_BTC_TX_VBYTES))
        return { hash: r?.txid ?? '', fee }
      }
      case 'rgb-invoice': {
        // RGB on-chain transfer: recipient IS the rgb invoice. Asset id
        // is encoded in it; RLN parses it server-side.
        const req = { recipient_id: recipient }
        if (amount !== undefined && amount !== null) req.amount = Number(amount)
        if (assetId) req.asset_id = assetId
        const r = await this.sendRgbAsset(req)
        return { hash: r?.txid ?? '', fee: BigInt(0) }
      }
      default:
        throw new Error(`transfer: unhandled recipient kind "${kind}"`)
    }
  }

  /**
   * Approximate quote for a transfer without actually sending. Per
   * Renat: accept the approximation while RLN does not expose a probe
   * endpoint.
   *
   *   - on-chain → `estimateFee(blocks) × APPROX_BTC_TX_VBYTES`
   *   - LN       → flat percentage of amount (`LN_FEE_BPS` basis points)
   *   - RGB invoice → on-chain quote (RGB transfers settle on-chain)
   *
   * Returns `{ fee }` (no `hash`), matching `Omit<TransferResult, 'hash'>`.
   *
   * @param {TransferOptions} options
   * @returns {Promise<Omit<TransferResult, 'hash'>>}
   */
  async quoteTransfer (options) {
    if (!options || typeof options !== 'object') {
      throw new Error('quoteTransfer: options must be { recipient, amount, token? }')
    }
    const kind = WalletAccountRgbLightning._classifyRecipient(options.recipient)
    if (kind === 'bolt11' || kind === 'ln-pubkey') {
      const amt = Number(options.amount ?? 0)
      const fee = BigInt(Math.max(1, Math.ceil(amt * LN_FEE_BPS / 10000)))
      return { fee }
    }
    // on-chain (BTC or RGB)
    const rate = await this._defaultFeeRate(6)
    return { fee: BigInt(Math.round(Number(rate) * APPROX_BTC_TX_VBYTES)) }
  }

  /**
   * Approximate quote for a single on-chain spend. Sizes the tx as a
   * typical 1-input 2-output P2WPKH spend (~141 vbytes) and multiplies
   * by the current sat/vB rate.
   *
   * @param {Transaction} _tx
   * @returns {Promise<Omit<TransactionResult, 'hash'>>}
   */
  async quoteSendTransaction (_tx) {
    const rate = await this._defaultFeeRate(6)
    return { fee: BigInt(Math.round(Number(rate) * APPROX_BTC_TX_VBYTES)) }
  }

  /**
   * Look up a transaction by hash by filtering `listTransactions` (BTC)
   * then falling back to `listPayments` (LN). Returns the raw entry, or
   * `null` if not found.
   *
   * @param {string} hash
   * @returns {Promise<unknown | null>}
   */
  async getTransactionReceipt (hash) {
    if (typeof hash !== 'string' || hash.length === 0) {
      throw new Error('getTransactionReceipt: hash is required')
    }
    try {
      const txs = await this.getTransactions(false)
      const onchain = Array.isArray(txs?.transactions) ? txs.transactions : (Array.isArray(txs) ? txs : [])
      const hit = onchain.find((t) => t?.txid === hash)
      if (hit) return hit
    } catch (_e) { /* fall through to LN lookup */ }
    try {
      const sent = await this.getPayment(hash, 'sent')
      if (sent && sent.payment_hash) return sent
    } catch (_e) { /* not a sent payment */ }
    try {
      const recv = await this.getPayment(hash, 'received')
      if (recv && recv.payment_hash) return recv
    } catch (_e) { /* not a received payment either */ }
    return null
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
  getKeyPair () {
    const b = this._binding.bootstrap()
    if (!b || typeof b.node_id !== 'string') {
      throw new Error('getKeyPair: bootstrap did not return a node_id')
    }
    const publicKey = Buffer.from(b.node_id, 'hex')
    return { publicKey, privateKey: null }
  }

  /**
   * Read-only façade — exposes the safe (non-mutating) IWalletAccount
   * methods and throws on anything that would broadcast.
   *
   * The underlying account is already watch-only at the signer level
   * (VLS holds keys, RLN never sees seed); this just enforces the
   * `IWalletAccountReadOnly` *type* contract.
   *
   * @returns {Promise<IWalletAccountReadOnly>}
   */
  async toReadOnlyAccount () {
    return new ReadOnlyRgbLightningAccount(this)
  }

  /**
   * @private
   * @param {number} blocks
   * @returns {Promise<number>}
   */
  async _defaultFeeRate (blocks) {
    try {
      const r = await this.estimateFee(blocks)
      const rate = r?.fee_rate ?? r?.feerate ?? r
      const n = Number(rate)
      return Number.isFinite(n) && n > 0 ? n : DEFAULT_FEE_RATE_SAT_PER_VB
    } catch (_e) {
      return DEFAULT_FEE_RATE_SAT_PER_VB
    }
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

/**
 * Read-only façade returned by `WalletAccountRgbLightning.toReadOnlyAccount`.
 * Implements the `IWalletAccountReadOnly` shape over the same underlying
 * account but rejects any mutating call. We don't subclass
 * `WalletAccountReadOnly` from `@tetherto/wdk-wallet` because the abstract
 * surface there assumes ERC-20 semantics (token addresses, native
 * balances as bigints) that don't translate to LN; we provide the same
 * method names and let duck-typing handle the contract.
 */
class ReadOnlyRgbLightningAccount {
  /** @param {WalletAccountRgbLightning} account */
  constructor (account) {
    this._account = account
  }

  /** @returns {Promise<string>} */
  async getAddress () {
    const a = this._account.getAddress()
    return a instanceof Promise ? a : Promise.resolve(a)
  }

  /** @param {string} message @param {string} signature @returns {Promise<boolean>} */
  async verify (message, signature) { return this._account.verify(message, signature) }

  /** @returns {Promise<bigint>} balance in sats */
  async getBalance () {
    const s = await this._account.getBalance(false)
    return BigInt(s ?? 0)
  }

  /** Per-asset balance — `tokenAddress` is interpreted as an RGB asset id. */
  async getTokenBalance (tokenAddress) {
    const r = await this._account.getAssetBalance(tokenAddress)
    const settled = r?.settled ?? r?.spendable ?? 0
    return BigInt(settled)
  }

  /** @param {Transaction} tx */
  async quoteSendTransaction (tx) { return this._account.quoteSendTransaction(tx) }

  /** @param {TransferOptions} options */
  async quoteTransfer (options) { return this._account.quoteTransfer(options) }

  /** @param {string} hash */
  async getTransactionReceipt (hash) { return this._account.getTransactionReceipt(hash) }
}
