// Copyright 2026 UTEXO. Licensed under the Apache License, Version 2.0.
'use strict'

export const REQUIRED_NATIVE_RUNTIME = Object.freeze({
  abi_version: 1,
  rln_version: '0.13.0-beta.3',
  rln_commit: 'af03c7f1a65135a429f05a5820600338215954dc',
  lightning_commit: '38d73bc918f27956590585d2bb83c86f059679b0',
  adapter_sha256: 'aedd173294d3583b20cce36889c153f8b18aada794e4a7c32f1135266a28df00'
})
const CAPABILITIES = ['canonical-unlock-v1', 'persistent-native-signer', 'refresh-transfers-v1', 'apay-address', 'decoded-invoice-cltv', 'tagged-rgb-assignment']

export function assertNativeRuntime (native) {
  const info = native.getRuntimeInfo?.()
  if (!info || Object.entries(REQUIRED_NATIVE_RUNTIME).some(([key, value]) => info[key] !== value) ||
      !Array.isArray(info.capabilities) || CAPABILITIES.some(value => !info.capabilities.includes(value))) {
    const error = new Error('Incompatible RGB Lightning native runtime; install the exact 0.2.0-beta.1 candidate peer')
    error.code = 'ERR_RLN_RUNTIME_MISMATCH'
    throw error
  }
  return info
}
