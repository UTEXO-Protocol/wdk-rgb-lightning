import type WalletManager from '@tetherto/wdk-wallet'
import type { IWalletAccount, IWalletAccountReadOnly } from '@tetherto/wdk-wallet'

import {
  BareRgbLightningBinding,
  isUmaAddress,
  LspAmbiguousPayableAssetError,
  LspClient,
  LspInsufficientAssetLiquidityError,
  LspNoPayableAssetError,
  LspProtocolError,
  LspQuoteMismatchError,
  LspUnknownPayableAssetError,
  LnurlPayError,
  NodeRgbLightningBinding,
  normalizeLightningAddress,
  parseLightningAddress,
  UMA_MAX_USERNAME_LENGTH,
  UMA_PREFIX,
  UtexoLsp,
  verifyApayAddressAttestation,
  verifyApayInvoiceProof,
  verifyLightningMessageSignature
} from '../index.js'

import type WalletManagerRgbLightning from '../index.js'
import type {
  IRgbLightningBinding,
  AssetSelection,
  ExternalInvoiceQuote,
  ExternalPaymentQuote,
  ExternalPaymentResult,
  BtcSendRequest,
  CommitPreparedSendRequest,
  CreateUtxosRequest,
  DecodedLightningInvoice,
  DecodedRgbInvoice,
  AddressReceipt,
  PendingRgbSendPlan,
  PreparedRgbSend,
  PreparedCreateUtxos,
  PreparedSend,
  LnurlPayOptions,
  LspLightningSendStatusResult,
  LspPeer,
  LspRequestOptions,
  LspRgbInvoiceParams,
  LspLiquidityTimeoutError,
  LightningAddressQuote,
  ParsedLightningAddress,
  PayAddressOptions,
  WalletRefreshResult,
  WalletSnapshotOptions,
  WalletAccountReadOnlyRgbLightning,
  WalletAccountRgbLightning
} from '../index.js'

declare const manager: WalletManagerRgbLightning
declare const account: WalletAccountRgbLightning
declare const readOnlyAccount: WalletAccountReadOnlyRgbLightning
declare const binding: IRgbLightningBinding
declare const liquidityError: LspLiquidityTimeoutError
declare const lsp: UtexoLsp
declare const lspClient: LspClient
declare const lightningAddressQuote: LightningAddressQuote

const managerContract: WalletManager = manager
const accountContract: IWalletAccount = account
const readOnlyContract: IWalletAccountReadOnly = readOnlyAccount

void managerContract
void accountContract
void readOnlyContract

const lnurlOptions: LnurlPayOptions = {
  allowCrossHostCallback: true,
  assetAmount: 1n
}
const payAddressOptions: PayAddressOptions = {
  address: 'alice@example.com',
  amtMsat: '1000',
  asset: { assetAmount: 1n },
  allowCrossHostCallback: true,
  requireAddressProof: true,
  signal: new AbortController().signal
}
const requestOptions: LspRequestOptions = { timeoutMs: 5_000, signal: new AbortController().signal }
const selectedAsset: Promise<AssetSelection> = lsp.selectPaymentAsset({
  address: 'alice@example.com',
  assetAmount: 1n
})
const externalInvoice: Promise<ExternalInvoiceQuote> = lsp.requestExternalInvoice({
  amtMsat: 3_000_000,
  assetAmount: 1,
  asset: 'USDT'
})
const externalQuote: Promise<ExternalPaymentQuote> = lsp.quoteExternalPayment({
  invoice: 'lnbc1...',
  payWith: 'LNUSDT',
  maxFeeMsat: 1_000
})
declare const verifiedQuote: ExternalPaymentQuote
const externalPayment: Promise<ExternalPaymentResult> = lsp.payExternalQuote(verifiedQuote, {
  invoice: 'lnbc1...',
  fundingAssetId: 'rgb:funding'
})
const reverifiedQuote: Promise<ExternalPaymentQuote> = lsp.verifyExternalQuote(
  verifiedQuote,
  {
    invoice: 'lnbc1...',
    fundingAssetId: 'rgb:funding',
    signal: new AbortController().signal
  }
)
const addressRoutingFeeCap: number = lightningAddressQuote.maxTotalRoutingFeeMsat
const lspPeer: LspPeer = {
  baseUrl: 'https://lsp.example.com',
  peerPubkey: '02' + '11'.repeat(32),
  peerHost: 'lsp.example.com',
  peerPort: 9735,
  network: 'signet'
}
const rgbInvoiceParams: LspRgbInvoiceParams = { assignment: 'Any' }
lspClient.onchainSend({ rgbInvoice: 'rgb:...' })
const externalStatus: Promise<LspLightningSendStatusResult> =
  lspClient.lightningSendStatus('ab'.repeat(32), requestOptions)
const protocolError = new LspProtocolError('/lightning_send', 'payment_hash')
const quoteError = new LspQuoteMismatchError('mismatch')
const liquidityAssetError = new LspInsufficientAssetLiquidityError(1, [])
const noAssetError = new LspNoPayableAssetError('alice@example.com')
const unknownAssetError = new LspUnknownPayableAssetError('USDT', [])
const ambiguousAssetError = new LspAmbiguousPayableAssetError([], 'convertible')
verifyApayAddressAttestation({
  recipientPubkey: '02' + '11'.repeat(32),
  username: 'alice',
  domain: 'example.com',
  addressSig: 'y'.repeat(104)
})
verifyApayInvoiceProof({
  version: 1,
  recipientPubkey: '02' + '11'.repeat(32),
  hostPubkey: '03' + '22'.repeat(32),
  batchId: '00'.repeat(16),
  hashIndex: 0,
  paymentHash: 'aa'.repeat(32),
  batchRoot: 'bb'.repeat(32),
  batchSize: 1,
  merkleProof: [],
  batchSig: 'y'.repeat(104),
  createdAt: 1,
  expiresAt: 2
})
const messageSignatureValid: boolean = verifyLightningMessageSignature(
  'message',
  'y'.repeat(104),
  '02' + '11'.repeat(32)
)
const minimumLiquidity: number = liquidityError.minMsat
const nodeHealth: string = NodeRgbLightningBinding.healthcheck()
const bareHealth: string = BareRgbLightningBinding.healthcheck()
const lnurlError = new LnurlPayError('request failed', {
  status: 502,
  body: 'bad gateway',
  cause: new Error('connection reset')
})
const lnurlStatus: number | undefined = lnurlError.status
const lnurlBody: string | undefined = lnurlError.body
const walletSnapshotOptions: WalletSnapshotOptions = {
  mode: 'recovery',
  assetIds: ['rgb:asset'],
  includeActivity: true
}
const refreshed: Promise<WalletRefreshResult> = account.refreshWalletSnapshot(walletSnapshotOptions)
const btcSendRequest: BtcSendRequest = {
  amount: 1_000,
  address: 'bcrt1ptest',
  fee_rate: 2,
  skip_sync: false
}
const preparedBtc: Promise<PreparedSend> = account.prepareBtcSend(btcSendRequest)
const preparedCommit: CommitPreparedSendRequest = {
  plan_id: 'ab'.repeat(32)
}
const committedBtc = account.commitPreparedBtcSend(preparedCommit)
const cancelledBtc = account.cancelBtcSendPlan({ plan_id: preparedCommit.plan_id })
const createUtxosRequest: CreateUtxosRequest = {
  up_to: true,
  num: 5,
  size: 2_000,
  fee_rate: 2,
  skip_sync: false
}
const preparedCreateUtxos: Promise<PreparedCreateUtxos> =
  account.prepareCreateUtxos(createUtxosRequest)
const committedCreateUtxos = account.commitPreparedCreateUtxos(preparedCommit)
const cancelledCreateUtxos = account.cancelCreateUtxosPlan(preparedCommit)
const preparedRgb: Promise<PreparedRgbSend> = account.prepareRgbSend({
  donation: false,
  fee_rate: 2,
  min_confirmations: 1,
  recipient_groups: []
})
account.transfer({
  recipient: 'rgb:...',
  amount: 1n,
  witnessData: { amountSats: 1_000, blinding: 7 }
})
const pendingRgb: Promise<readonly PendingRgbSendPlan[]> = account.listPendingRgbSendPlans()
const addressReceipts: Promise<readonly AddressReceipt[]> =
  account.listAddressReceipts('bcrt1ptest')
const decodedLightningInvoice: Promise<DecodedLightningInvoice> =
  account.decodeInvoice('lnbcrt1...')
const decodedRgbInvoice: Promise<DecodedRgbInvoice> =
  account.decodeRgbInvoice('rgb:...')

// @ts-expect-error recovery mode is explicit; arbitrary sync strategies are rejected.
account.refreshWalletSnapshot({ mode: 'fast' })
// @ts-expect-error read-only accounts cannot mutate native sync state.
readOnlyAccount.refreshWalletSnapshot()
const umaPrefix: '$' = UMA_PREFIX
const umaMaxUsernameLength: 64 = UMA_MAX_USERNAME_LENGTH
const normalizedAddress: string = normalizeLightningAddress('$alice@example.com')
const umaAddress: boolean = isUmaAddress('$alice@example.com')
const nonStringUmaAddress: boolean = isUmaAddress(42)
const parsedAddress: ParsedLightningAddress = parseLightningAddress('$alice@example.com')
const parsedDomain: string = parsedAddress.domain

binding.ensureNode()
// @ts-expect-error IRgbLightningBinding exposes ensureNode(), not a node property.
binding.node

void lnurlOptions
void preparedBtc
void committedBtc
void cancelledBtc
void preparedCreateUtxos
void committedCreateUtxos
void cancelledCreateUtxos
void preparedRgb
void pendingRgb
void addressReceipts
void decodedLightningInvoice
void decodedRgbInvoice
void payAddressOptions
void selectedAsset
void externalInvoice
void externalQuote
void externalPayment
void reverifiedQuote
void addressRoutingFeeCap
void lspPeer
void rgbInvoiceParams
void externalStatus
void protocolError
void quoteError
void liquidityAssetError
void noAssetError
void unknownAssetError
void ambiguousAssetError
void messageSignatureValid
void minimumLiquidity
void nodeHealth
void bareHealth
void lnurlStatus
void lnurlBody
void refreshed
void umaPrefix
void umaMaxUsernameLength
void normalizedAddress
void umaAddress
void nonStringUmaAddress
void parsedAddress
void parsedDomain
