// Copyright 2026 UTEXO. Licensed under the Apache License, Version 2.0.
'use strict'

import { VSS_SAFETY_POLICY } from './vss-policy.js'

export const REQUIRED_NATIVE_RUNTIME = Object.freeze({
  abi_version: 1,
  rln_version: '0.17.0-beta.3',
  rln_commit: 'c29d1b2dfe43ba95c25ced8984f09e42c789d6af',
  lightning_commit: '510189d5700a6d1406229ce7523e181c3838715e',
  rgb_lib_commit: '962730a211f0f7569d7ad8ae777052f433d87655',
  adapter_sha256: 'ae0b1f29d2f81b8b5d219b9e749f97238ce1cc86777cb07a9c01d5e7fdfd88f9'
})
const CAPABILITIES = ['invoice-first-send-v1', 'rgb-proxy-v1', 'canonical-unlock-v1', 'persistent-native-signer', 'refresh-transfers-v1', 'apay-address', 'decoded-invoice-cltv', 'tagged-rgb-assignment', 'pending-blinded-v1', 'rgb-contract-import-v1', 'rgb-transfer-metadata-import-v1', 'consignment-export-v1', 'mainnet-lightning-rejection-v1', 'external-signer-eth-rpc-v1', 'external-signer-burn-v1', 'native-signer-shutdown-v1', 'owned-session-cleanup-v1', 'vss-backup-v1', 'vss-backup-info-v1', 'vss-restore-v1', 'vss-automatic-backup-v1', 'vss-backup-metadata-v1']

export function assertNativeRuntime (native) {
  const info = native.getRuntimeInfo?.()
  if (!info || Object.entries(REQUIRED_NATIVE_RUNTIME).some(([key, value]) => info[key] !== value) ||
      !Array.isArray(info.capabilities) || CAPABILITIES.some(value => !info.capabilities.includes(value)) ||
      !info.vss_policy || typeof info.vss_policy !== 'object' || Array.isArray(info.vss_policy) ||
      Object.keys(info.vss_policy).length !== 3 ||
      Object.entries(VSS_SAFETY_POLICY).some(([key, value]) =>
        !Object.hasOwn(info.vss_policy, key) || info.vss_policy[key] !== value)) {
    const error = new Error('Incompatible RGB Lightning native runtime; install the exact 0.2.0-bfa.0 candidate peer')
    error.code = 'ERR_RLN_RUNTIME_MISMATCH'
    throw error
  }
  return info
}
