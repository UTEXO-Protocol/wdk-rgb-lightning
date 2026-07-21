import type WalletManager from '@tetherto/wdk-wallet'
import type { IWalletAccount, IWalletAccountReadOnly } from '@tetherto/wdk-wallet'

import type WalletManagerRgbLightning from '../index.js'
import type {
  IRgbLightningBinding,
  LnurlPayOptions,
  LspLiquidityTimeoutError,
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
const walletSnapshotOptions: WalletSnapshotOptions = {
  mode: 'recovery',
  assetIds: ['rgb:asset'],
  includeActivity: true
}
const refreshed: Promise<WalletRefreshResult> = account.refreshWalletSnapshot(walletSnapshotOptions)

// @ts-expect-error recovery mode is explicit; arbitrary sync strategies are rejected.
account.refreshWalletSnapshot({ mode: 'fast' })
// @ts-expect-error read-only accounts cannot mutate native sync state.
readOnlyAccount.refreshWalletSnapshot()

binding.ensureNode()
// @ts-expect-error IRgbLightningBinding exposes ensureNode(), not a node property.
binding.node

void lnurlOptions
void payAddressOptions
void minimumLiquidity
void refreshed
