import type WalletManager from '@tetherto/wdk-wallet'
import type { IWalletAccount, IWalletAccountReadOnly } from '@tetherto/wdk-wallet'

import {
  BareRgbLightningBinding,
  isUmaAddress,
  LnurlPayError,
  NodeRgbLightningBinding,
  normalizeLightningAddress,
  parseLightningAddress,
  UMA_MAX_USERNAME_LENGTH,
  UMA_PREFIX
} from '../index.js'

import type WalletManagerRgbLightning from '../index.js'
import type {
  IRgbLightningBinding,
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
  LspLiquidityTimeoutError,
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
  allowCrossHostCallback: true
}
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
