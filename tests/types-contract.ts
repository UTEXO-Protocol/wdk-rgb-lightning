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
  BurnAssetRequest,
  BurnAssetResponse,
  IRgbLightningBinding,
  LnurlPayOptions,
  LspLiquidityTimeoutError,
  ParsedLightningAddress,
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

const exportedConsignment: Promise<Uint8Array> = account.getConsignment('rgb:asset', '00'.repeat(32))
const readOnlyConsignment: Promise<Uint8Array> = readOnlyAccount.getConsignment('rgb:asset', '00'.repeat(32))
void exportedConsignment
void readOnlyConsignment

const signingAddress: Promise<string> = account.getMessageSigningAddress()
const bip322Signature: Promise<string> = account.signMessageBip322('exact message\n', 'bcrt1paddress')
const bip322Verified: Promise<boolean> = readOnlyAccount.verifyMessageBip322('exact message\n', 'bcrt1paddress', 'smpAA==')
void signingAddress
void bip322Signature
void bip322Verified
// @ts-expect-error A proof cannot be signed without an explicitly reviewed address.
account.signMessageBip322('message')
// @ts-expect-error Read-only accounts cannot sign BIP-322 proofs.
readOnlyAccount.signMessageBip322('message', 'bcrt1paddress')
// @ts-expect-error Read-only accounts cannot retrieve private-signer capabilities.
readOnlyAccount.getMessageSigningAddress()

const burnRequest: BurnAssetRequest = {
  asset_id: 'rgb:asset',
  amount: '18446744073709551615',
  fee_rate: 1,
  min_confirmations: 3,
  burn_recipient: 'ab'.repeat(32)
}
const burned: Promise<BurnAssetResponse> = account.burnAsset(burnRequest)
void burned
// @ts-expect-error Burn is not available to read-only accounts.
readOnlyAccount.burnAsset(burnRequest)
// @ts-expect-error Use the native snake_case request, not a WebRGB request.
account.burnAsset({ assetId: 'rgb:asset', amount: 1, feeRate: 1, minConfirmations: 3 })
// @ts-expect-error min_confirmations is required.
account.burnAsset({ asset_id: 'rgb:asset', amount: 1, fee_rate: 1 })
// @ts-expect-error BigInt is not a JSON request integer; use a decimal string.
account.burnAsset({ ...burnRequest, amount: 1n })

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
void payAddressOptions
void minimumLiquidity
void nodeHealth
void bareHealth
void lnurlStatus
void lnurlBody
void umaPrefix
void umaMaxUsernameLength
void normalizedAddress
void umaAddress
void nonStringUmaAddress
void parsedAddress
void parsedDomain
