// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
'use strict'

const PRIMARY_SIGNER_DIRECTORY = 'vls-signer'
const LEGACY_SIGNER_DIRECTORY = 'vls-signer-legacy'

/**
 * Resolve a stable signer store below the account's persistent native data
 * directory without importing Node's `path` module into React Native.
 *
 * @param {string} dataDir
 * @param {'primary'|'legacy'} [identity]
 * @returns {string}
 */
export function signerStoragePath (dataDir, identity = 'primary') {
  if (typeof dataDir !== 'string' || dataDir.trim().length === 0) {
    throw new Error('A persistent dataDir is required for VLS signer storage')
  }
  if (identity !== 'primary' && identity !== 'legacy') {
    throw new Error("Signer storage identity must be 'primary' or 'legacy'")
  }

  const root = dataDir.replace(/[\\/]+$/, '')
  const directory = identity === 'legacy'
    ? LEGACY_SIGNER_DIRECTORY
    : PRIMARY_SIGNER_DIRECTORY
  return `${root}/${directory}`
}
