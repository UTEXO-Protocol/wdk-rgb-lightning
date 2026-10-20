import type { RgbProvider } from '@utexo/webrgb'
import type { WalletAccountRgbLightning, RgbLightningCapabilities } from '../index.js'
import { LightningDisabledError, VssUnsupportedError } from '../index.js'
import { WebRgbProvider, WebRgbError, type WebRgbMethod } from '@utexo/wdk-rgb-lightning/webrgb'

declare const wallet: WalletAccountRgbLightning
const provider = new WebRgbProvider(wallet, { origin: 'https://example.com', confirm: async () => true })
const compatible: Pick<RgbProvider, WebRgbMethod | 'enabled'> = provider
const caps: RgbLightningCapabilities = wallet.getCapabilities()
const code: 'LIGHTNING_DISABLED_ON_MAINNET' = new LightningDisabledError().code
const vssCode: 'ERR_VSS_UNSAFE_UPSTREAM' = new VssUnsupportedError().code
const vssSupported: true = caps.vss.supported
void [compatible, caps, code, vssCode, vssSupported, new WebRgbError('NOT_ENABLED', 'Disconnected')]
// @ts-expect-error Burn is deliberately not exposed.
provider.burnAsset({})
// @ts-expect-error WebRGB protocol amounts are numbers, not arbitrary precision strings.
provider.blindReceive({ amount: '18446744073709551615' })
