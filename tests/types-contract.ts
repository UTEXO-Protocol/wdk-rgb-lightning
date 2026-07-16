import type WalletManager from '@tetherto/wdk-wallet'
import type { IWalletAccount, IWalletAccountReadOnly } from '@tetherto/wdk-wallet'

import type WalletManagerRgbLightning from '../index.js'
import type {
  IRgbLightningBinding,
  LnurlPayOptions,
  LspLiquidityTimeoutError,
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
const minimumLiquidity: number = liquidityError.minMsat

binding.ensureNode()
// @ts-expect-error The review removed the inconsistent node getter.
binding.node

void lnurlOptions
void minimumLiquidity
