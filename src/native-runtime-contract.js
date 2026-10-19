// Copyright 2026 UTEXO. Licensed under the Apache License, Version 2.0.
'use strict'

import { VSS_SAFETY_POLICY } from './vss-policy.js'

export const REQUIRED_NATIVE_RUNTIME = Object.freeze({
  abi_version: 1,
  rln_version: '0.17.0-beta.3',
  rln_commit: 'ecc69f20308231400561f6f060fea88acfa40cc4',
  lightning_commit: '79b9eb5166546c62692d3a672986f385c7fe047d',
  adapter_sha256: '693bed6010a651fa221e70758033ce41b9ce2d76789aeaf44c4c0b4c14dcfe3e'
})
const CAPABILITIES = ['canonical-unlock-v1', 'persistent-native-signer', 'refresh-transfers-v1', 'apay-address', 'decoded-invoice-cltv', 'tagged-rgb-assignment', 'pending-blinded-v1', 'rgb-contract-import-v1', 'rgb-transfer-metadata-import-v1', 'consignment-export-v1', 'mainnet-lightning-rejection-v1', 'external-signer-eth-rpc-v1', 'external-signer-burn-v1', 'native-signer-shutdown-v1', 'owned-session-cleanup-v1', 'vss-backup-v1', 'vss-backup-info-v1', 'vss-restore-v1']

export function assertNativeRuntime (native) {
  const info = native.getRuntimeInfo?.()
  if (!info || Object.entries(REQUIRED_NATIVE_RUNTIME).some(([key, value]) => info[key] !== value) ||
      !Array.isArray(info.capabilities) || CAPABILITIES.some(value => !info.capabilities.includes(value)) ||
      !info.vss_policy || typeof info.vss_policy !== 'object' || Array.isArray(info.vss_policy) ||
      Object.keys(info.vss_policy).length !== 3 ||
      Object.entries(VSS_SAFETY_POLICY).some(([key, value]) =>
        !Object.hasOwn(info.vss_policy, key) || info.vss_policy[key] !== value)) {
    const error = new Error('Incompatible RGB Lightning native runtime; install the exact 0.2.0-beta.4 candidate peer')
    error.code = 'ERR_RLN_RUNTIME_MISMATCH'
    throw error
  }
  return info
}
