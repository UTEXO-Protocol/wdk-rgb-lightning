// Copyright 2026 UTEXO. Licensed under the Apache License, Version 2.0.
import { assertNativeRuntime } from './native-runtime-contract.js'

/** Native build evidence plus real facade methods; never constructs a wallet or signer. */
export function nativeBfaCapabilities (native) {
  const info = assertNativeRuntime(native)
  const methods = native.SdkNode?.prototype
  const has = method => typeof methods?.[method] === 'function'
  const consignment = info.capabilities.includes('consignment-export-v1') && has('getConsignment')
  const bfa = has('listAssets') && has('assetBalance') && has('assetMetadata')
  return Object.freeze({
    bfa,
    consignment,
    burn: bfa && consignment && info.capabilities.includes('external-signer-burn-v1') && has('burn')
  })
}
