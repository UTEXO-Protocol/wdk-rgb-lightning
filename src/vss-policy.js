// Copyright 2026 UTEXO. Licensed under the Apache License, Version 2.0.
'use strict'

import { VssUnsupportedError, VSS_UNSUPPORTED_CODE, VSS_UNSUPPORTED_REASON } from './errors.js'

export const VSS_SAFETY_POLICY = Object.freeze({
  supported: false,
  code: VSS_UNSUPPORTED_CODE,
  reason: VSS_UNSUPPORTED_REASON
})

/** Reject configuration before native creation; never silently run local-only. */
export function assertVssConfigurationSafe (config) {
  if (config?.vssUrl !== undefined) throw new VssUnsupportedError()
}

export function vssCapabilities () {
  return {
    ...VSS_SAFETY_POLICY,
    automaticBackup: false,
    manualBackup: false,
    restore: false,
    remoteErasure: false
  }
}

/** Local policy only: no network query, checkpoint, or recovery assertion. */
export function disabledVssStatus () {
  return {
    configured: false,
    url: null,
    allowHttp: false,
    lastBackupVersion: null,
    supported: false,
    enabled: false,
    disabledReason: 'unsafe-upstream-vss'
  }
}
