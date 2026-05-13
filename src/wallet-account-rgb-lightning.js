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

/**
 * Sentinel placeholder address returned by `getAddress()` before the
 * node is unlocked. Format-valid testnet bech32 (passes
 * `wdk-react-native-core`'s `isBitcoinAddress` regex) but visibly
 * synthetic so consumers can detect it and mask the display.
 */
export const PENDING_ADDRESS = 'tb1qpendingunlock00000000000000000000000000'

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
  // IWalletAccount surface that doesn't map cleanly onto LN — 🚧 stubs
  // ==========================================================================

  /** 🚧 RLN exposes `signMessage` (BIP-322 style) but not the inverse
   *  verify-by-pubkey. We have the account xpub from
   *  `getBootstrap().account_xpub_vanilla` and can do BIP-322 verification
   *  locally — wire that up when a consumer actually needs it.
   *  @returns {Promise<never>} */
  async verify (_message, _signature) {
    throw new Error('verify() not yet implemented — needs local BIP-322 verifier against account xpub')
  }

  /** 🚧 `transfer` is the generic ERC-20-style entry on IWalletAccount.
   *  The LN equivalent is `keysend` / `sendPayment`. Once a higher-level
   *  router exists that picks between LN and on-chain RGB based on the
   *  recipient form, wire it through here.
   *  @param {TransferOptions} _options @returns {Promise<never>} */
  async transfer (_options) {
    throw new Error('transfer() not yet implemented — use sendPayment / keysend / sendRgbAsset directly')
  }

  /** 🚧 Quote requires a probe path. RLN doesn't currently expose one;
   *  estimate client-side from `decodeInvoice`'s amount + a configurable
   *  fee bps when this is needed.
   *  @param {TransferOptions} _options @returns {Promise<never>} */
  async quoteTransfer (_options) {
    throw new Error('quoteTransfer() not yet implemented')
  }

  /** 🚧 On-chain fee estimate. RLN has `estimateFee(blocks)` for a sat/vB
   *  rate; deriving a fee for a specific tx shape needs us to size the
   *  PSBT first. Punt until a caller actually needs the per-tx number. */
  async quoteSendTransaction (_tx) {
    throw new Error('quoteSendTransaction() not yet implemented — use estimateFee(blocks) for sat/vB')
  }

  /** 🚧 RLN doesn't expose a transaction-by-hash lookup. Could stitch by
   *  calling `listTransactions` + filtering. Wire when needed. */
  async getTransactionReceipt (_hash) {
    throw new Error('getTransactionReceipt() not yet implemented')
  }

  /** 🚧 Derive on-chain pubkey for the IWalletAccount.getKeyPair contract.
   *  We have the account xpub via bootstrap; derive child as needed when
   *  a consumer requires this. */
  getKeyPair () {
    throw new Error('getKeyPair() not yet implemented — derive via account_xpub_vanilla from bootstrap()')
  }

  /** 🚧 Read-only view of the account. We already run "watch-only" via
   *  the external signer (RLN never has the seed), but the WDK
   *  `IWalletAccountReadOnly` contract is a distinct type. Wire it as a
   *  thin façade exposing only the read methods when needed. */
  toReadOnlyAccount () {
    throw new Error('toReadOnlyAccount() not yet implemented')
  }

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  dispose () {
    // The binding owns the signer (created from the WDK seed) and is
    // shut down by the manager's dispose(); the account itself holds
    // no sensitive state.
  }
}
