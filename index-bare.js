// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
'use strict'

// Bare worklet entry — wires the bare-runtime binding. Resolved through
// the `bare` conditional export in package.json when the consumer is
// running inside a bare worklet (RN via @tetherto/wdk-react-native-core).

import WalletManagerBase from './src/wallet-manager-rgb-lightning.js'
import { BareRgbLightningBinding } from './src/bare-binding.js'

export default class WalletManagerRgbLightning extends WalletManagerBase {
  static get Binding () { return BareRgbLightningBinding }
}

export { default as WalletAccountRgbLightning } from './src/wallet-account-rgb-lightning.js'
export { BareRgbLightningBinding } from './src/bare-binding.js'

// LSP client surface — see ./src/lsp-client.js, lnurl-pay.js, lsp-helpers.js.
// Pure-fetch implementations; work in Bare (via bare-fetch/global, already
// installed by ./bare.js) and Node ≥18 (native fetch) without per-runtime
// branches.
export { LspClient, LspError } from './src/lsp-client.js'
export {
  LnurlPayError,
  parseLightningAddress,
  fetchDiscovery,
  resolveAddressToInvoice
} from './src/lnurl-pay.js'
export {
  payLightningAddress,
  requestLspRgbDeposit,
  payRgbViaLsp
} from './src/lsp-helpers.js'
