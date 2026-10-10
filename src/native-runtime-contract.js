// Copyright 2026 UTEXO. Licensed under the Apache License, Version 2.0.
'use strict'

export const REQUIRED_NATIVE_RUNTIME = Object.freeze({
  abi_version: 1,
  rln_version: '0.15.0-beta.3',
  rln_commit: 'a17b685615750536f0320db1cd3f3ba68a8f1c57',
  lightning_commit: '6d6d061f840264296e7de2b1c64dac6c0dd7eb26',
  adapter_sha256: '93d62bb91c0ab90a7ccc4a1382a9da84498e38506170ce74d3863292f0c9f2f4'
})
const CAPABILITIES = ['canonical-unlock-v1', 'persistent-native-signer', 'refresh-transfers-v1', 'apay-address', 'decoded-invoice-cltv', 'tagged-rgb-assignment', 'pending-blinded-v1', 'rgb-contract-import-v1', 'rgb-transfer-metadata-import-v1', 'consignment-export-v1', 'mainnet-lightning-rejection-v1', 'external-signer-eth-rpc-v1']

export function assertNativeRuntime (native) {
  const info = native.getRuntimeInfo?.()
  if (!info || Object.entries(REQUIRED_NATIVE_RUNTIME).some(([key, value]) => info[key] !== value) ||
      !Array.isArray(info.capabilities) || CAPABILITIES.some(value => !info.capabilities.includes(value))) {
    const error = new Error('Incompatible RGB Lightning native runtime; install the exact 0.2.0-beta.3 candidate peer')
    error.code = 'ERR_RLN_RUNTIME_MISMATCH'
    throw error
  }
  return info
}
