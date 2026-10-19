// Copyright 2026 UTEXO. Licensed under the Apache License, Version 2.0.
'use strict'

export const VSS_SAFETY_POLICY = Object.freeze({ supported: true, code: null, reason: null })

/** Validate before signer/node creation. Never downgrade invalid VSS to local-only. */
export function assertVssConfigurationSafe (config) {
  for (const key of ['vssAllowHttp', 'vssAllowEmptyRestore']) {
    if (config?.[key] !== undefined && typeof config[key] !== 'boolean') throw new TypeError(`${key} must be a boolean`)
  }
  if (config?.vssUrl === undefined) return
  try {
    if (typeof config.vssUrl !== 'string' || !config.vssUrl || config.vssUrl.trim() !== config.vssUrl) throw new Error()
    const url = new URL(config.vssUrl)
    if (!url.hostname || url.username || url.password || url.search || url.hash ||
        (url.protocol !== 'https:' && !(url.protocol === 'http:' && config.vssAllowHttp === true))) throw new Error()
  } catch (_error) {
    throw new TypeError('vssUrl must be an HTTPS endpoint without credentials, query or fragment; HTTP requires vssAllowHttp: true')
  }
}

export function vssCapabilities (readOnly = false) {
  return {
    ...VSS_SAFETY_POLICY,
    automaticBackup: !readOnly,
    manualBackup: !readOnly,
    restore: !readOnly,
    remoteErasure: false
  }
}

/** Local configuration and last successful RGB upload; never a remote health check. */
export function localVssStatus (config, lastBackupVersion = null) {
  const configured = typeof config?.vssUrl === 'string' && config.vssUrl.length > 0
  return {
    configured,
    url: configured ? config.vssUrl : null,
    allowHttp: configured && config.vssAllowHttp === true,
    lastBackupVersion,
    supported: true,
    enabled: configured,
    disabledReason: null
  }
}

/** Upstream versions identify an RGB upload, not a whole-wallet atomic checkpoint. */
export function validateVssBackup (result) {
  if (!result || typeof result !== 'object' || !Number.isSafeInteger(result.version) || result.version <= 0) {
    throw new Error('VSS returned an invalid RGB backup version')
  }
  return result
}

/** Validate the sanitized native observation; no whole-wallet recovery claim. */
export function validateVssBackupInfo (result) {
  const fields = ['backup_exists', 'version', 'backup_required', 'last_auto_backup_failed']
  if (!result || typeof result !== 'object' || Array.isArray(result) ||
      Object.keys(result).length !== fields.length || fields.some(key => !Object.hasOwn(result, key)) ||
      typeof result.backup_exists !== 'boolean' || typeof result.backup_required !== 'boolean' ||
      typeof result.last_auto_backup_failed !== 'boolean' ||
      !(result.version === null || (Number.isSafeInteger(result.version) && result.version > 0)) ||
      result.backup_exists !== (result.version !== null)) {
    throw new Error('VSS returned invalid backup information')
  }
  return result
}

/** Bind an explicit recovery request to the reviewed account, chain and endpoint. */
export function assertVssRecoveryScope (config, expected, bootstrap) {
  if (expected === undefined) return // Preserve the low-level legacy API.
  const fields = ['network', 'dataDir', 'vssUrl']
  if (!expected || typeof expected !== 'object' || Array.isArray(expected) ||
      Object.keys(expected).length !== fields.length + 1 || fields.some(key =>
    !Object.hasOwn(expected, key) || typeof expected[key] !== 'string' || !expected[key] || expected[key] !== config?.[key]) ||
      !Object.hasOwn(expected, 'nodeId') || typeof expected.nodeId !== 'string' ||
      !/^(02|03)[a-f0-9]{64}$/i.test(expected.nodeId) || expected.nodeId !== bootstrap?.()?.node_id) {
    const error = new Error('The VSS writer recovery context changed. Nothing was cleared.')
    error.code = 'ERR_VSS_RECOVERY_SCOPE_MISMATCH'
    throw error
  }
}

/** A receipt exists only after the native public restore operation downloaded state. */
export function validateVssRestoreReceipt (value, config, bootstrap, info = false) {
  if (info && value === null) return null
  const fields = ['restored', 'status', 'network', 'node_id', 'master_fingerprint', 'version', ...(info ? ['unlocked'] : [])]
  const restored = value?.restored === true
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== fields.length || fields.some(key => !Object.hasOwn(value, key)) ||
      typeof value.restored !== 'boolean' || value.status !== (restored ? 'restored' : 'not_found') ||
      value.network !== config.network || value.node_id !== bootstrap.node_id ||
      value.master_fingerprint !== bootstrap.master_fingerprint ||
      typeof value.master_fingerprint !== 'string' || !/^[a-f0-9]{8}$/i.test(value.master_fingerprint) ||
      typeof value.node_id !== 'string' || !/^(02|03)[a-f0-9]{64}$/i.test(value.node_id) ||
      (restored ? !Number.isSafeInteger(value.version) || value.version <= 0 : value.version !== null) ||
      (info && (!restored || typeof value.unlocked !== 'boolean'))) {
    throw new Error('VSS returned invalid restore provenance')
  }
  return value
}
