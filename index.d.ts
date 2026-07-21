// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License").
//
// TypeScript declarations for @utexo/wdk-rgb-lightning.
//
// The package ships as pure ES modules with no compile step; these
// declarations are hand-authored to match the runtime surface of
// index-node.js / index-bare.js (identical public API; only the
// underlying native binding differs). Payloads that forward verbatim
// to rgb-lightning-node (RLN) are typed loosely as `object` /
// `Record<string, unknown>` because their shape is owned upstream;
// shapes this module owns (config, results, errors, LSP DTOs) are
// typed precisely.

import WalletManager, { WalletAccountReadOnly } from '@tetherto/wdk-wallet'

// ───────────────────────────────────────────────────────────────────
// Shared primitives
// ───────────────────────────────────────────────────────────────────

export type Network = 'mainnet' | 'testnet' | 'regtest' | 'signet'

/** Integer encoded as base-10 text so values never cross JS's safe-number boundary. */
export type DecimalString = `${bigint}`

export type WalletSyncMode = 'routine' | 'recovery'

export type WalletSyncKeychainResult =
  | { status: 'succeeded' }
  | { status: 'failed'; error_code: string }

export interface WalletSyncResponse {
  contract_version: 1
  mode: WalletSyncMode
  vanilla: WalletSyncKeychainResult
  colored: WalletSyncKeychainResult
}

export interface WalletSnapshotOptions {
  mode?: WalletSyncMode
  assetIds?: string[]
  maxAssets?: number
  maxChannels?: number
  maxActivityItems?: number
  includeActivity?: boolean
}

export interface WalletSnapshotNetwork {
  network: Network
  height: number
}

export interface WalletSnapshotBalance {
  settled: DecimalString
  future: DecimalString
  spendable: DecimalString
}

export interface WalletSnapshotBtc {
  vanilla: WalletSnapshotBalance
  colored: WalletSnapshotBalance
}

export interface WalletSnapshotAssetBalance extends WalletSnapshotBalance {
  offchain_outbound: DecimalString
  offchain_inbound: DecimalString
}

export interface WalletSnapshotAsset {
  asset_id: string
  ticker: string
  name: string
  precision: number
  balance: WalletSnapshotAssetBalance
}

export interface WalletSnapshotNode {
  pubkey: string
  num_channels: DecimalString
  num_usable_channels: DecimalString
  claimable_onchain_sat: DecimalString
  eventual_close_fees_sat: DecimalString
  pending_outbound_payments_sat: DecimalString
  num_peers: DecimalString
  latest_rgs_snapshot_timestamp: DecimalString | null
}

export interface WalletSnapshotChannel {
  channel_id: string
  peer_pubkey: string
  status: 'Opening' | 'Opened' | 'Closing'
  ready: boolean
  capacity_sat: DecimalString
  claimable_onchain_sat: DecimalString
  outbound_capacity_msat: DecimalString
  inbound_capacity_msat: DecimalString
  next_outbound_htlc_limit_msat: DecimalString
  next_outbound_htlc_minimum_msat: DecimalString
  is_usable: boolean
  public: boolean
  funding_txid: string | null
  peer_alias: string | null
  short_channel_id: DecimalString | null
  asset_id: string | null
  asset_local_amount: DecimalString | null
  asset_remote_amount: DecimalString | null
  virtual_open_mode: string | null
}

export interface WalletSnapshotBlockTime {
  height: number
  timestamp: DecimalString
}

export interface WalletSnapshotTransaction {
  transaction_type: 'RgbSend' | 'Drain' | 'CreateUtxos' | 'SendBtc' | 'Incoming'
  txid: string
  received: DecimalString
  sent: DecimalString
  fee: DecimalString
  confirmation_time: WalletSnapshotBlockTime | null
}

export interface WalletSnapshotPayment {
  amt_msat: DecimalString | null
  asset_amount: DecimalString | null
  asset_id: string | null
  payment_hash: string
  payment_type: 'Outbound' | 'InboundAutoClaim' | 'InboundHodl'
  status: 'Pending' | 'Claimable' | 'Claiming' | 'Succeeded' | 'Cancelled' | 'Failed'
  created_at: DecimalString
  updated_at: DecimalString
  payee_pubkey: string
}

export interface WalletSnapshotTransferEndpoint {
  endpoint: string
  transport_type: string
  used: boolean
}

export interface WalletSnapshotTransfer {
  idx: number
  created_at: DecimalString
  updated_at: DecimalString
  status: string
  requested_assignment: string | null
  assignments: string[]
  kind: string
  txid: string | null
  recipient_id: string | null
  receive_utxo: string | null
  change_utxo: string | null
  expiration: DecimalString | null
  transport_endpoints: WalletSnapshotTransferEndpoint[]
}

export interface WalletSnapshotAssetTransfers {
  asset_id: string
  transfers: WalletSnapshotTransfer[]
}

export interface WalletSnapshotResponse {
  contract_version: 1
  native_source: 'rgb-lightning-node-v0.9.0-beta.3+utexo-wallet-v1'
  capture_sequence: DecimalString
  started_at_ms: DecimalString
  completed_at_ms: DecimalString
  network_before: WalletSnapshotNetwork
  network_after: WalletSnapshotNetwork
  node: WalletSnapshotNode
  btc: WalletSnapshotBtc
  assets: WalletSnapshotAsset[]
  channels: WalletSnapshotChannel[]
  transactions?: WalletSnapshotTransaction[]
  payments?: WalletSnapshotPayment[]
  transfers?: WalletSnapshotAssetTransfers[]
}

export interface WalletRefreshResult {
  contractVersion: 1
  sync: WalletSyncResponse
  snapshot: WalletSnapshotResponse
}

export interface Transaction {
  to: string
  value: number | bigint
  feeRate?: number | bigint
  confirmationTarget?: number
}

export interface TransactionResult {
  hash: string
  fee: bigint
}

export interface FeeRates {
  /** Economy rate (sat/vB), targets ~1 hour confirmation. */
  normal: bigint
  /** Priority rate (sat/vB), targets next block. */
  fast: bigint
}

export interface KeyPair {
  /** LN node id — 33-byte compressed secp256k1 pubkey. */
  publicKey: Uint8Array
  /** Always null: VLS holds signing material and never exposes it. */
  privateKey: null
}

export interface TransferOptions {
  /** BOLT11 invoice, LN node pubkey (hex), BTC address, or RGB invoice. */
  recipient: string
  /** msats for LN flows, sats for on-chain flows. */
  amount: number | bigint
  /** RGB asset id, when transferring an asset. */
  token?: string
  /** sat/vB override for on-chain flows. */
  feeRate?: number
  confirmationTarget?: number
}

export interface TransferResult {
  /** Payment hash (LN) or txid (on-chain/RGB). */
  hash: string
  /** Fee paid, in msats (LN) or sats (on-chain). */
  fee: bigint
}

export type QuoteResult = Omit<TransferResult, 'hash'>

/** Local-view VSS status (no server round-trip). See `vssStatus()`. */
export interface VssStatus {
  configured: boolean
  url: string | null
  allowHttp: boolean
  /** Snapshot version from the most recent `vssBackup()` this session. */
  lastBackupVersion: number | null
}

export interface BootstrapLspResult {
  /** connectPeer response. */
  connect: object
  /** Whether the peer reached listPeers within the window. */
  peerVisible: boolean
  /** AsyncOrderNewResponse from apayNew — omitted if hostNodeId was undefined. */
  apay?: object
}

export interface CreateLightningInvoiceRequest {
  amountMsat?: number
  expirySec: number
  assetId?: string
  assetAmount?: number
  paymentHash?: string
  descriptionHash?: string
  /**
   * Override the BOLT11 min_final_cltv_expiry. For APay this is set by
   * the LSP policy (`APAY_*_MIN_FINAL_CLTV_EXPIRY_DELTA`): inbound
   * (merchant-offline window, e.g. 864 blocks) and outbound (LDK
   * minimum, 42). Passthrough; RLN default applies when omitted.
   */
  minFinalCltvExpiryDelta?: number
}

export interface CreateHodlInvoiceParams {
  /** 32-byte payment hash (hex). The preimage is released later via claimHodlInvoice. */
  paymentHash: string
  amtMsat?: number
  expirySec: number
  assetId?: string
  assetAmount?: number
  minFinalCltvExpiryDelta?: number
}

/**
 * Channel-open request forwarded verbatim to RLN. Only the fields most
 * relevant to APay are typed here; any other RLN openchannel field may
 * also be passed.
 *
 * NOTE (RGB HTLC minimum): an RGB-routed HTLC has a hard minimum of
 * 3_000_000 msat (the LSP's `MIN_AMT_MSAT`). Invoices/payments below
 * this will fail to route on RGB channels.
 */
export interface OpenChannelRequest {
  peer_pubkey_and_opt_addr: string
  capacity_sat: number
  push_msat?: number
  asset_id?: string
  asset_amount?: number
  public?: boolean
  with_anchors?: boolean
  /**
   * Open as a virtual (non-broadcast) channel. Set to
   * `'trusted_no_broadcast'` for APay against a production LSP. The
   * counterparty must trust this node via its `virtualPeerPubkeys`
   * (and vice-versa). Requires `enableVirtualChannelsV0` at construction.
   */
  virtual_open_mode?: 'trusted_no_broadcast'
  [key: string]: unknown
}

// ───────────────────────────────────────────────────────────────────
// RGB / payment vocabulary (mirrors rgb-lightning-node's C-FFI enums)
// ───────────────────────────────────────────────────────────────────

/**
 * RLN payment-type discriminant for {@link WalletAccountRgbLightning.getPayment}.
 * The C-FFI deserialises this into its `Outbound | InboundAutoClaim |
 * InboundHodl` enum and errors on any other value (the pre-1.0 HTTP API's
 * `sent`/`received` are gone).
 */
export type RgbPaymentType = 'Outbound' | 'InboundAutoClaim' | 'InboundHodl'

/** RGB assignment discriminant accepted by RLN's `parse_assignment_kind`. */
export type RgbAssignmentKind = 'Fungible' | 'NonFungible' | 'InflationRight' | 'ReplaceRight' | 'Any'

export interface RgbSendRecipient {
  /** Recipient id (blinded UTXO or witness) — from `decodeRgbInvoice`. */
  recipient_id: string
  assignment_kind: RgbAssignmentKind
  assignment_amount?: number
  /** Consignment transport endpoints — from `decodeRgbInvoice`. */
  transport_endpoints: string[]
  witness_data?: { amount_sat: number; blinding?: number }
}

/** Native `JsonSendRgbRequest` shape forwarded to RLN by `sendRgbAsset`. */
export interface SendRgbAssetRequest {
  donation: boolean
  /** sat/vB. */
  fee_rate: number
  min_confirmations: number
  recipient_groups: Array<{ asset_id: string; recipients: RgbSendRecipient[] }>
}

/** Native `JsonRgbInvoiceRequest` shape for `createRgbInvoice`. */
export interface CreateRgbInvoiceRequest {
  /** REQUIRED — RLN rejects the request on deserialise if omitted. */
  min_confirmations: number
  /** REQUIRED — true = witness (on-chain) receive, false = blinded. */
  witness: boolean
  asset_id?: string
  assignment_kind?: RgbAssignmentKind
  assignment_amount?: number
  duration_seconds?: number
}

// ───────────────────────────────────────────────────────────────────
// Config
// ───────────────────────────────────────────────────────────────────

export interface RgbLightningBindingConfig {
  network: Network
  /** Persistent, app-private path for RLN's SQLite + LDK state. */
  dataDir: string
  daemonListeningPort?: number
  ldkPeerListeningPort?: number
  maxMediaUploadSizeMb?: number
  /**
   * Enable virtual-channels-v0. REQUIRED (with `virtualPeerPubkeys`)
   * for async-payments against a production LSP — mobile clients reject
   * standard channels and must use `trusted_no_broadcast` virtual channels.
   */
  enableVirtualChannelsV0?: boolean
  /**
   * Trust list of peer node_ids (hex) allowed to open/receive
   * `trusted_no_broadcast` virtual channels with this node. For APay,
   * set to `[lspNodeId]`. Forwarded as `virtual_peer_pubkeys`.
   */
  virtualPeerPubkeys?: string[]
  permissiveSignerPolicy?: boolean
  /** Enables VSS cloud backup. Only https:// (or loopback http) unless `vssAllowHttp`. */
  vssUrl?: string
  vssAllowHttp?: boolean
  vssAllowEmptyRestore?: boolean
  /** LSP base URL for RLN's internal APay client. Required for apayNew/bootstrapLsp. */
  lspBaseUrl?: string
  /** Bearer token for the LSP's /internal/* endpoints. */
  lspBearerToken?: string
}

export interface RgbLightningWalletConfig extends RgbLightningBindingConfig {
  /**
   * `auto` uses the corrected WDK seed derivation for new nodes and retries
   * the legacy beta derivation only for an existing signer-identity mismatch.
   */
  nodeSeedDerivation?: 'auto' | 'wdk-seed-v2' | 'legacy-v1'
  bitcoindRpcUsername?: string
  bitcoindRpcPassword?: string
  bitcoindRpcHost?: string
  bitcoindRpcPort?: number
  indexerUrl?: string
  proxyEndpoint?: string
  announceAddresses?: string[]
  announceAlias?: string
}

// ───────────────────────────────────────────────────────────────────
// Bindings (low-level; usually not constructed directly)
// ───────────────────────────────────────────────────────────────────

export interface IRgbLightningBinding {
  ensureNode(): unknown
  attachExternalSigner(seedHex: string, fallbackSeedHex?: string): void
  unlock(unlockRequest: object): void
  bootstrap(): object
  clearVssFence(password: string): void
  vssBackup(): { version: number }
  vssStatus(): VssStatus
  apayNew(hostNodeId: string): object
  shutdown(): void
}

export class NodeRgbLightningBinding implements IRgbLightningBinding {
  constructor(config: RgbLightningBindingConfig)
  ensureNode(): unknown
  attachExternalSigner(seedHex: string, fallbackSeedHex?: string): void
  unlock(unlockRequest: object): void
  bootstrap(): object
  clearVssFence(password: string): void
  vssBackup(): { version: number }
  vssStatus(): VssStatus
  apayNew(hostNodeId: string): object
  shutdown(): void
  static healthcheck(): unknown
  static isInitialized(): boolean
  static initialize(request: object): void
  static shutdownGlobal(): void
}

export class BareRgbLightningBinding implements IRgbLightningBinding {
  constructor(config: RgbLightningBindingConfig)
  ensureNode(): unknown
  attachExternalSigner(seedHex: string, fallbackSeedHex?: string): void
  unlock(unlockRequest: object): void
  bootstrap(): object
  clearVssFence(password: string): void
  vssBackup(): { version: number }
  vssStatus(): VssStatus
  apayNew(hostNodeId: string): object
  shutdown(): void
  static healthcheck(): unknown
  static isInitialized(): boolean
  static initialize(request: object): void
  static shutdownGlobal(): void
}

// ───────────────────────────────────────────────────────────────────
// Account
// ───────────────────────────────────────────────────────────────────

export class WalletAccountReadOnlyRgbLightning extends WalletAccountReadOnly {
  protected constructor(reader: object)
  getBootstrap(): Promise<object>
  vssStatus(): Promise<VssStatus>
  getNodeInfo(): Promise<object>
  getNetworkInfo(): Promise<object>
  getAddress(): Promise<string>
  getAddressState(): Promise<{ status: 'ready'; address: string } | { status: 'locked'; address: null }>
  listChannels(): Promise<object>
  getChannelId(temporaryChannelIdHex: string): Promise<object>
  listPeers(): Promise<object>
  decodeInvoice(invoice: string): Promise<object>
  getInvoiceStatus(invoice: string): Promise<object>
  listPayments(): Promise<object>
  getPayment(paymentHashHex: string, paymentType: RgbPaymentType): Promise<object>
  listAssets(filterAssetSchemas?: string[]): Promise<object>
  getAssetBalance(assetId: string): Promise<object>
  getAssetMetadata(assetId: string): Promise<object>
  listTransfers(assetId: string): Promise<object>
  listTransfersByTxid(txid: string): Promise<object>
  decodeRgbInvoice(invoice: string): Promise<object>
  getAssetMedia(digest: string): Promise<object>
  getBalance(skipSync?: boolean): Promise<bigint>
  getBalanceDetails(skipSync?: boolean): Promise<object>
  getTokenBalance(assetId: string): Promise<bigint>
  getTransactions(skipSync?: boolean): Promise<object>
  getTransactionsByTxid(txid: string, skipSync?: boolean): Promise<object>
  listUnspents(skipSync?: boolean): Promise<object>
  estimateFee(blocks: number): Promise<object>
  verify(message: string, signature: string): Promise<boolean>
  checkIndexerUrl(indexerUrl: string): Promise<object>
  checkProxyEndpoint(proxyEndpoint: string): Promise<object>
  quoteTransfer(options: TransferOptions): Promise<QuoteResult>
  quoteSendTransaction(tx: Transaction): Promise<QuoteResult>
  getTransactionReceipt(hash: string): Promise<unknown | null>
}

export class WalletAccountRgbLightning extends WalletAccountReadOnlyRgbLightning {
  constructor(bindings: { binding: IRgbLightningBinding })

  readonly index: 0
  readonly path: 'm'
  readonly keyPair: KeyPair

  // Lifecycle
  unlock(unlockRequest: object): Promise<{ ok: true }>
  getBootstrap(): Promise<object>
  shutdown(): Promise<{ ok: true }>

  // VSS
  /** @throws {VssNotConfiguredError} if built without a vssUrl. @throws {VssError} on server rejection. */
  clearVssFence(password: string): Promise<{ ok: true }>
  /** @throws {VssNotConfiguredError} if built without a vssUrl. @throws {VssError} on failure. */
  vssBackup(): Promise<{ version: number }>
  /** Local-view status; does not hit the server. */
  vssStatus(): Promise<VssStatus>

  // APay / LSP bootstrap
  /** @throws {ApayError} on LSP failure. */
  apayNew(hostNodeId: string): Promise<object>
  bootstrapLsp(opts: {
    peerPubkeyAndAddr: string
    hostNodeId?: string
    waitForPeerMs?: number
    pollIntervalMs?: number
  }): Promise<BootstrapLspResult>
  /** The lspBaseUrl / lspBearerToken this node was constructed with. */
  getLspConfig(): { baseUrl: string | null; bearerToken: string | null }
  /**
   * Build the composed {@link UtexoLsp} flow object. No-arg form
   * auto-discovers the peer from the wallet's lspBaseUrl.
   */
  createLsp(peer?: LspPeer, peerPort?: number): Promise<UtexoLsp>

  // Node info / network / sync
  getNodeInfo(): Promise<object>
  getNetworkInfo(): Promise<object>
  /** @deprecated Uses the legacy Colored-only FastSync. */
  sync(): Promise<{ ok: true }>
  refreshWalletSnapshot(options?: WalletSnapshotOptions): Promise<WalletRefreshResult>

  // Channels
  openChannel(request: OpenChannelRequest | object): Promise<object>
  closeChannel(request: object): Promise<{ ok: true }>

  // Peers
  connectPeer(peerPubkeyAndAddr: string): Promise<{ ok: true }>
  disconnectPeer(request: object): Promise<{ ok: true }>

  // BOLT11 invoices
  createInvoice(request: object): Promise<object>
  /** Cross-SDK alias for createInvoice; accepts native snake_case or camelCase. */
  createLightningInvoice(request: CreateLightningInvoiceRequest | object): Promise<object>
  /** Create a HODL invoice bound to a caller-supplied payment hash. */
  createHodlInvoice(params: CreateHodlInvoiceParams): Promise<{ bolt11: string; paymentHash: string }>
  cancelHodlInvoice(request: object): Promise<{ ok: true }>
  claimHodlInvoice(request: object): Promise<object>

  // Payments
  sendPayment(request: object): Promise<object>
  keysend(request: object): Promise<object>

  // RGB assets
  refreshTransfers(request: object): Promise<{ ok: true }>
  failTransfers(request: object): Promise<object>
  createRgbInvoice(request: CreateRgbInvoiceRequest | object): Promise<object>
  sendRgbAsset(request: SendRgbAssetRequest | object): Promise<object>
  postAssetMedia(request: object): Promise<object>

  // BTC on-chain
  sendBtc(request: object): Promise<object>
  sendTransaction(tx: Transaction | object): Promise<TransactionResult>
  rotateAddress(): Promise<string>
  createUtxos(request: object): Promise<{ ok: true }>

  // Onion / signing / diagnostics
  sendOnionMessage(request: object): Promise<{ ok: true }>
  sign(message: string): Promise<string>

  // Generic IWalletAccount surface
  transfer(options: TransferOptions): Promise<TransferResult>
  getKeyPair(): KeyPair
  toReadOnlyAccount(): Promise<WalletAccountReadOnlyRgbLightning>
  /** @throws {NotImplementedError} — use sendTransaction/sendPayment/sendRgbAsset. */
  signTransaction(tx: object): Promise<never>

  // LSP integration (thin pass-throughs to lsp-helpers)
  payLightningAddress(addr: string, amountMsat: bigint | number, opts?: PayLightningAddressOptions): Promise<PayLightningAddressResult>
  requestLspRgbDeposit(args: RequestLspRgbDepositArgs): Promise<LspRgbDepositResult>
  payRgbViaLsp(args: PayRgbViaLspArgs): Promise<PayRgbViaLspResult>

  dispose(): void
}

export type IWalletAccountReadOnlyRgbLightning = WalletAccountReadOnlyRgbLightning

// ───────────────────────────────────────────────────────────────────
// Manager (default export)
// ───────────────────────────────────────────────────────────────────

export default class WalletManagerRgbLightning extends WalletManager {
  constructor(seed: string | Uint8Array, config: RgbLightningWalletConfig)
  getAccount(index?: number, options?: { signerName?: string }): Promise<WalletAccountRgbLightning>
  getAccount(signerName: string): Promise<WalletAccountRgbLightning>
  getAccountByPath(path: string, options?: { signerName?: string }): Promise<WalletAccountRgbLightning>
  getFeeRates(): Promise<FeeRates>
  dispose(): void
  static readonly Binding: new (config: RgbLightningBindingConfig) => IRgbLightningBinding
}

// ───────────────────────────────────────────────────────────────────
// Error hierarchy
// ───────────────────────────────────────────────────────────────────

export class RgbLightningError extends Error {
  constructor(message: string, opts?: { code?: string; cause?: unknown; details?: unknown })
  code: string
  cause?: unknown
  details?: unknown
  toJSON(): { name: string; code: string; message: string; details: unknown; cause: unknown }
}
export class UnlockError extends RgbLightningError {}
export class AccountLockedError extends RgbLightningError {}
export class VssError extends RgbLightningError {}
export class VssNotConfiguredError extends VssError {}
export class ApayError extends RgbLightningError {}
export class WalletSyncError extends RgbLightningError {}
export class WalletSnapshotError extends RgbLightningError {}
export class NotImplementedError extends RgbLightningError {}

// ───────────────────────────────────────────────────────────────────
// LSP client
// ───────────────────────────────────────────────────────────────────

export interface LspClientOptions {
  baseUrl: string
  timeoutMs?: number
  fetch?: typeof fetch
  defaultHeaders?: Record<string, string>
  allowHttp?: boolean
  maxRetries?: number
}

export interface LnurlPayDiscovery {
  tag: 'payRequest'
  callback: string
  minSendable: number | string
  maxSendable: number | string
  metadata: string
  commentAllowed?: number | string
}

export interface LspBridgeResult {
  lnInvoice: string
  rgbInvoice: string
  /**
   * The LSP's bridge mapping id. The raw `LspClient` / helper paths return
   * it as the LSP sends it (a number); the composed `UtexoLsp` flows coerce
   * it to a string. Typed as the union to reflect both call paths.
   */
  mappingId: string | number
}

export class LspClient {
  constructor(opts: LspClientOptions)
  health(opts?: { timeoutMs?: number }): Promise<object>
  getInfo(opts?: { timeoutMs?: number }): Promise<object>
  lnurlDiscovery(username: string, opts?: { timeoutMs?: number }): Promise<LnurlPayDiscovery>
  lnurlCallback(username: string, amountMsat: bigint | number | string, opts?: { assetId?: string; assetAmount?: bigint | number | string; timeoutMs?: number }): Promise<{ pr: string; routes?: unknown[] }>
  /** Full LUD-06 resolution routed through this LSP's baseUrl (discovery + callback). */
  resolveAddress(username: string, amountMsat: bigint | number | string, opts?: { assetId?: string; assetAmount?: bigint | number | string; timeoutMs?: number }): Promise<{ pr: string; routes?: unknown[]; status?: string; reason?: string }>
  /** Resolve the auto-assigned Lightning Address for a node pubkey (post-apayNew). */
  getLightningAddressByPubkey(peerPubkey: string, opts?: { timeoutMs?: number }): Promise<{ username: string; domain: string }>
  onchainSend(params: {
    rgbInvoice: string
    ln: { amtMsat: bigint | number | string; expirySec: number; assetId?: string; assetAmount?: bigint | number | string; descriptionHash?: string; paymentHash?: string; minFinalCltvExpiryDelta?: number }
    timeoutMs?: number
  }): Promise<LspBridgeResult>
  lightningReceive(params: {
    lnInvoice: string
    rgb: { assetId: string; assignment?: string; durationSeconds?: number; minConfirmations?: number; witness?: boolean }
    timeoutMs?: number
  }): Promise<LspBridgeResult>
}

export class LspError extends Error {
  constructor(endpoint: string, status: number, body: string, cause?: unknown)
  endpoint: string
  status: number
  body: string
  errorBody: object | null
  errorCode: number | string | null
  errorTag: string | null
  cause?: unknown
}

// ───────────────────────────────────────────────────────────────────
// LNURL-pay (LUD-06 / LUD-16)
// ───────────────────────────────────────────────────────────────────

export function parseLightningAddress(addr: string, opts?: { allowHttp?: boolean }): { username: string; host: string; discoveryUrl: string }
export interface LnurlPayOptions {
  fetch?: typeof fetch
  timeoutMs?: number
  allowHttp?: boolean
  /** Opt in to following a callback on a different host than discovery. */
  allowCrossHostCallback?: boolean
  comment?: string
  assetId?: string
  assetAmount?: bigint | number | string
}

export function fetchDiscovery(addr: string, opts?: Pick<LnurlPayOptions, 'fetch' | 'timeoutMs' | 'allowHttp'>): Promise<LnurlPayDiscovery>
export function resolveAddressToInvoice(addr: string, amountMsat: bigint | number | string, opts?: LnurlPayOptions): Promise<{ pr: string; routes?: unknown[]; discovery: LnurlPayDiscovery; callbackUrl: string }>

export class LnurlPayError extends Error {
  status?: number
  body?: string
}

// ───────────────────────────────────────────────────────────────────
// LSP helpers (account + LSP combined flows)
// ───────────────────────────────────────────────────────────────────

export interface PayLightningAddressOptions extends LnurlPayOptions {
  skipAmount?: boolean
  beforePay?: (invoice: string, discovery: LnurlPayDiscovery) => void | Promise<void>
}

export interface PayLightningAddressResult {
  invoice: string
  sendResult: object
  discovery: LnurlPayDiscovery
  callbackUrl: string
}

export interface RequestLspRgbDepositArgs {
  lsp: string | LspClient
  lnInvoice?: string
  lnInvoiceRequest?: object
  rgb: { assetId: string; assignment?: unknown; durationSeconds?: number; minConfirmations?: number; witness?: boolean }
  lspOpts?: { timeoutMs?: number }
}

export type LspRgbDepositResult = LspBridgeResult

export interface PayRgbViaLspArgs {
  lsp: string | LspClient
  rgbInvoice: string
  ln: { amtMsat: bigint | number | string; expirySec: number; assetId?: string; assetAmount?: bigint | number | string; descriptionHash?: string; paymentHash?: string; minFinalCltvExpiryDelta?: number }
  lspOpts?: { timeoutMs?: number }
}

export interface PayRgbViaLspResult extends LspBridgeResult {
  sendResult: object
}

export function payLightningAddress(account: WalletAccountRgbLightning, addr: string, amountMsat: bigint | number | string, opts?: PayLightningAddressOptions): Promise<PayLightningAddressResult>
export function requestLspRgbDeposit(account: WalletAccountRgbLightning, args: RequestLspRgbDepositArgs): Promise<LspRgbDepositResult>
export function payRgbViaLsp(account: WalletAccountRgbLightning, args: PayRgbViaLspArgs): Promise<PayRgbViaLspResult>

// ───────────────────────────────────────────────────────────────────
// UtexoLsp — composed LSP flows (parity with @utexo/rgb-sdk-rn)
// ───────────────────────────────────────────────────────────────────

/** Canonical receive state (4 terminal-or-pending values). */
export type ReceiveStatus = 'Pending' | 'Succeeded' | 'Failed' | 'Expired'

/** Single config object describing the LSP peer for composed flows. */
export interface LspPeer {
  baseUrl: string
  peerPubkey: string
  peerHost: string
  peerPort: number
  bearerToken?: string
  timeoutMs?: number
  allowHttp?: boolean
}

/** Shared polling options for the wait/await flows. */
export interface WaitOptions {
  timeoutMs?: number
  pollIntervalMs?: number
  signal?: AbortSignal
  onProgress?: (msg: string) => void
  /** Run at the start of each poll iteration — e.g. mine a regtest block. */
  onEachPoll?: () => Promise<void>
}

export interface ChannelReadyInfo {
  channelId: string
  peerPubkey: string
  capacitySat: number
  outboundBalanceMsat: number
  inboundBalanceMsat: number
}

export interface ReceiveAssetOptions {
  assetId: string
  amountSats?: number
  amountRgb?: number
  expirySeconds?: number
}

export interface ReceiveAssetResult {
  lnInvoice: string
  rgbInvoice: string
  mappingId: string
}

export interface SendAssetOptions {
  rgbInvoice: string
  ln?: { amtMsat?: bigint | number | string; expirySec?: number; assetId?: string; assetAmount?: bigint | number | string; descriptionHash?: string; paymentHash?: string; minFinalCltvExpiryDelta?: number }
}

export interface SendAssetResult extends LspBridgeResult {
  sendResult: object
}

export interface PayAddressOptions {
  address: string
  amtMsat: bigint | number | string
  asset?: { assetId: string; assetAmount: bigint | number | string }
  /** Opt in to following a delegated LNURL callback on a different host. */
  allowCrossHostCallback?: boolean
}

export interface LightningAddressInfo {
  username: string
  domain: string
  /** Convenience: `username@domain`. */
  address: string
}

export interface ClaimResult {
  paymentHash: string
  claimed: boolean
  error?: string
}

export class UtexoLsp {
  constructor(account: WalletAccountRgbLightning, peer: LspPeer)
  readonly http: LspClient
  readonly peer: LspPeer
  connect(): Promise<{ ok: true }>
  waitForChannel(assetId: string, opts?: WaitOptions): Promise<ChannelReadyInfo>
  receiveAsset(opts: ReceiveAssetOptions): Promise<ReceiveAssetResult>
  awaitReceiveSettlement(lnInvoice: string, opts?: WaitOptions): Promise<'settled' | 'timed_out'>
  waitForOutboundLiquidity(minMsat: number, opts?: WaitOptions): Promise<void>
  sendAsset(opts: SendAssetOptions): Promise<SendAssetResult>
  payAddress(opts: PayAddressOptions): Promise<{ invoice: string; sendResult: object }>
  enableLightningAddress(): Promise<LightningAddressInfo>
  claimPendingPayments(): Promise<ClaimResult[]>
}

export function peerUri(peer: LspPeer): string
export function normalizeReceiveStatus(raw: string | { status?: string } | null | undefined): ReceiveStatus

export class LspChannelTimeoutError extends Error {
  constructor(assetId: string, elapsedMs: number)
  assetId: string
  elapsedMs: number
}

export class LspLiquidityTimeoutError extends Error {
  constructor(minMsat: number, elapsedMs: number, peerPubkey: string)
  minMsat: number
  elapsedMs: number
  peerPubkey: string
}

export class LspSettlementError extends Error {
  constructor(step: 'ln_invoice', status: 'Failed' | 'Expired')
  step: 'ln_invoice'
  /** Only the terminal-failure states ever reach this error. */
  status: 'Failed' | 'Expired'
}
