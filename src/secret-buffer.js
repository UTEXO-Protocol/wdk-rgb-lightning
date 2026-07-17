// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
'use strict'

// eslint-disable-next-line camelcase
import { sodium_memcmp, sodium_memzero } from 'sodium-universal'

/** Retain a zeroizable copy instead of keeping an immutable JS string. */
export function retainSecret (value) {
  return value === undefined ? undefined : Buffer.from(value, 'utf8')
}

/** Compare against a temporary copy and erase that copy before returning. */
export function secretMatches (retained, candidate) {
  const candidateBuffer = retainSecret(candidate)
  try {
    return retained.length === candidateBuffer.length && sodium_memcmp(retained, candidateBuffer)
  } finally {
    wipeSecret(candidateBuffer)
  }
}

export function revealSecret (retained) {
  return retained.toString('utf8')
}

export function wipeSecret (retained) {
  if (retained && ArrayBuffer.isView(retained)) sodium_memzero(retained)
}
