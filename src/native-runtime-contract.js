// Copyright 2026 UTEXO. Licensed under the Apache License, Version 2.0.
'use strict'

export const REQUIRED_NATIVE_RUNTIME = Object.freeze({
  abi_version: 1,
  rln_version: '0.15.0-beta.3',
  rln_commit: 'e2b39d5ae8da74525eafb58bc39b9a614c756a73',
  lightning_commit: '6d6d061f840264296e7de2b1c64dac6c0dd7eb26',
  adapter_sha256: '1e73269080a7a4e62026b72358175be15c1d7f31b1e3004cc09b7e3062da06b7'
})
const CAPABILITIES = ['canonical-unlock-v1', 'persistent-native-signer', 'refresh-transfers-v1', 'apay-address', 'decoded-invoice-cltv', 'tagged-rgb-assignment', 'pending-blinded-v1', 'rgb-contract-import-v1', 'rgb-transfer-metadata-import-v1', 'consignment-export-v1', 'mainnet-lightning-rejection-v1']

export function assertNativeRuntime (native) {
  const info = native.getRuntimeInfo?.()
  if (!info || Object.entries(REQUIRED_NATIVE_RUNTIME).some(([key, value]) => info[key] !== value) ||
      !Array.isArray(info.capabilities) || CAPABILITIES.some(value => !info.capabilities.includes(value))) {
    const error = new Error('Incompatible RGB Lightning native runtime; install the exact 0.2.0-beta.2 candidate peer')
    error.code = 'ERR_RLN_RUNTIME_MISMATCH'
    throw error
  }
  return info
}
