import type WalletManager from '@tetherto/wdk-wallet'
import type { IWalletAccount, IWalletAccountReadOnly } from '@tetherto/wdk-wallet'

import {
  BareRgbLightningBinding,
  LnurlPayError,
  NodeRgbLightningBinding
} from '../index.js'

import type WalletManagerRgbLightning from '../index.js'
import type {
  IRgbLightningBinding,
  LnurlPayOptions,
  LspLiquidityTimeoutError,
  PayAddressOptions,
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

binding.ensureNode()
// @ts-expect-error IRgbLightningBinding exposes ensureNode(), not a node property.
binding.node

void lnurlOptions
void payAddressOptions
void minimumLiquidity
void nodeHealth
void bareHealth
void lnurlStatus
void lnurlBody
