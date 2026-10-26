// Copyright 2026 UTEXO. Licensed under the Apache License, Version 2.0.
'use strict'

import { VSS_SAFETY_POLICY } from './vss-policy.js'

export const REQUIRED_NATIVE_RUNTIME = Object.freeze({
  abi_version: 1,
  rln_version: '0.17.0-beta.3',
  rln_commit: '7cced3aa3c2c904a88d8f8a7832981d25a5ea871',
  lightning_commit: 'bbe68189872c26088e351d034b05c58769cb996a',
  rgb_lib_commit: '89c37086a68ef792da75c62bce59b58b1d7952a0',
  adapter_sha256: 'b70bb70610ff1b47eb55ea2bdf67a65af85e89fbabc006f2345302cbe74f1082'
})
const CAPABILITIES = ['rgb-output-operations-v1', 'invoice-first-send-v1', 'rgb-proxy-v1', 'canonical-unlock-v1', 'persistent-native-signer', 'refresh-transfers-v1', 'apay-address', 'decoded-invoice-cltv', 'tagged-rgb-assignment', 'pending-blinded-v1', 'rgb-contract-import-v1', 'rgb-transfer-metadata-import-v1', 'consignment-export-v1', 'mainnet-lightning-rejection-v1', 'external-signer-eth-rpc-v1', 'external-signer-burn-v1', 'native-signer-shutdown-v1', 'owned-session-cleanup-v1', 'vss-backup-v1', 'vss-backup-info-v1', 'vss-restore-v1', 'vss-automatic-backup-v1', 'vss-backup-metadata-v1']

export function assertNativeRuntime (native) {
  const info = native.getRuntimeInfo?.()
  if (!info || Object.entries(REQUIRED_NATIVE_RUNTIME).some(([key, value]) => info[key] !== value) ||
      !Array.isArray(info.capabilities) || CAPABILITIES.some(value => !info.capabilities.includes(value)) ||
      !info.vss_policy || typeof info.vss_policy !== 'object' || Array.isArray(info.vss_policy) ||
      Object.keys(info.vss_policy).length !== 3 ||
      Object.entries(VSS_SAFETY_POLICY).some(([key, value]) =>
        !Object.hasOwn(info.vss_policy, key) || info.vss_policy[key] !== value)) {
    const error = new Error('Incompatible RGB Lightning native runtime; install the exact 0.2.0-bfa.1 candidate peer')
    error.code = 'ERR_RLN_RUNTIME_MISMATCH'
    throw error
  }
  return info
}
