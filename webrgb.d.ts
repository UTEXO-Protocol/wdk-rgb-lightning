import type { RgbProvider, ProviderErrorCode } from '@utexo/webrgb'
import type { WalletAccountRgbLightning } from './index.js'

export interface BurnDestination {
  readonly version: 1
  readonly destinationChainId: number
  readonly dstEid: number
  readonly recipient: `0x${string}`
}
export interface BurnDestinationRoute { readonly chainId: string; readonly dstEid: number }
export declare const MAX_BURN_PROOF_BYTES: number
export declare function validateBurnDestination(value: unknown): BurnDestination
/** Returns 32-byte hashStruct hexadecimal without a 0x prefix. */
export declare function burnDestinationHash(value: unknown): string
/** Explicit EVM/Tron routes only. Tron requires a native Base58Check address. */
export declare function burnDestinationFor(payout: { chainId: string; address: string }, routes: readonly BurnDestinationRoute[]): BurnDestination
export declare function createBurnPackage(proof: Uint8Array, destination: unknown): string

export declare const WEBRGB_READ_METHODS: readonly [
  'enable', 'getInfo', 'getAddress', 'blindReceive', 'listAssets',
  'getAssetBalance', 'listTransfers', 'getTransferStatus', 'decodeRgbInvoice'
]
export type WebRgbMethod = typeof WEBRGB_READ_METHODS[number]

export interface WebRgbApproval {
  /** Origin supplied by the approved transport, never by request params. */
  readonly origin: string
  readonly method: 'enable' | 'blindReceive'
  readonly params: Readonly<Record<string, unknown>>
}

export interface WebRgbOptions {
  origin: string
  confirm: (request: WebRgbApproval) => Promise<boolean>
  /** Set only after the host has approved/restored this transport session. */
  sessionApproved?: boolean
  /** Synchronous check. Throw if the transport session is no longer authorized. */
  assertAuthorized?: () => void
  /** Raised to at least 3. This floor does not provide reorg protection. */
  minConfirmations?: number
}

export type WebRgbWallet = Pick<WalletAccountRgbLightning,
  'getNetwork' | 'isDisposed' | 'getAddress' | 'createRgbInvoice' | 'listAssets' |
  'getAssetBalance' | 'listTransfers' | 'refreshTransfers' | 'decodeRgbInvoice'>

export declare class WebRgbError extends Error {
  constructor(code: ProviderErrorCode, message: string)
  code: ProviderErrorCode
  toJSON(): { name: string; code: ProviderErrorCode; message: string }
}

/** Receiving/read subset. Does not inject a browser provider or establish a transport. */
export declare class WebRgbProvider implements Pick<RgbProvider, WebRgbMethod | 'enabled'> {
  constructor(wallet: WebRgbWallet, options: WebRgbOptions)
  readonly enabled: boolean
  revoke(): void
  enable: RgbProvider['enable']
  getInfo: RgbProvider['getInfo']
  getAddress: RgbProvider['getAddress']
  blindReceive: RgbProvider['blindReceive']
  listAssets: RgbProvider['listAssets']
  getAssetBalance: RgbProvider['getAssetBalance']
  listTransfers: RgbProvider['listTransfers']
  getTransferStatus: RgbProvider['getTransferStatus']
  decodeRgbInvoice: RgbProvider['decodeRgbInvoice']
}
