// Copyright 2026 UTEXO. Licensed under the Apache License, Version 2.0.
'use strict'

export const REQUIRED_NATIVE_RUNTIME = Object.freeze({
  abi_version: 1,
  rln_version: '0.15.0-beta.3',
  rln_commit: '8777d71d7781b408fcce89c9c965ae29e8ad2300',
  lightning_commit: 'fc5c4c64db36a9b6aa8cd878ca1225a977e67106',
  adapter_sha256: 'f6d2959e1ceff0400cbd372759c4957cd5a52964f4ec646a79ee15c21b2291c0'
})
const CAPABILITIES = ['canonical-unlock-v1', 'persistent-native-signer', 'refresh-transfers-v1', 'apay-address', 'decoded-invoice-cltv', 'tagged-rgb-assignment', 'pending-blinded-v1', 'rgb-contract-import-v1', 'rgb-transfer-metadata-import-v1', 'consignment-export-v1', 'mainnet-lightning-rejection-v1', 'external-signer-eth-rpc-v1', 'external-signer-burn-v1']

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
