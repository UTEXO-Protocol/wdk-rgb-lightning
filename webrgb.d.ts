import type { RgbProvider, ProviderErrorCode } from '@utexo/webrgb'
import type { WalletAccountRgbLightning } from './index.js'

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
