// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
'use strict'

// Node entry — wires the napi binding. Resolved through the `node`
// conditional export in package.json when the consumer is running on
// plain Node.js (server, CLI, tests). The napi addon ships separately
// as @utexo/rgb-lightning-node-nodejs (peer dep) and provides the same
// SdkNode + NativeExternalSigner surface the bare addon exposes.

import WalletManagerBase from './src/wallet-manager-rgb-lightning.js'
import { NodeRgbLightningBinding } from './src/node-binding.js'

export default class WalletManagerRgbLightning extends WalletManagerBase {
  static get Binding () { return NodeRgbLightningBinding }
}

export { default as WalletAccountRgbLightning } from './src/wallet-account-rgb-lightning.js'
export { default as WalletAccountReadOnlyRgbLightning } from './src/wallet-account-read-only-rgb-lightning.js'
export { NodeRgbLightningBinding } from './src/node-binding.js'

// Typed error hierarchy — see ./src/errors.js. Lets callers branch on
// `err.name` / `err.code` instead of substring-matching RLN messages.
export {
  RgbLightningError,
  AccountLockedError,
  UnlockError,
  VssError,
  VssNotConfiguredError,
  ApayError,
  NotImplementedError
} from './src/errors.js'

// LSP client surface — see ./src/lsp-client.js, lnurl-pay.js, lsp-helpers.js.
// Pure-fetch implementations; identical module under Bare (./index-bare.js).
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
// Composed LSP flows — connect → wait-for-channel → receive/send →
// settle → pay-address → enable-Lightning-Address → claim. API parity
// with @utexo/rgb-sdk-rn's UtexoLsp. See ./src/utexo-lsp.js.
export {
  UtexoLsp,
  LspChannelTimeoutError,
  LspSettlementError,
  peerUri,
  normalizeReceiveStatus
} from './src/utexo-lsp.js'
