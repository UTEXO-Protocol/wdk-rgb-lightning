// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
'use strict'

const POLL_INTERVAL_MS = 100
const TERMINAL_STATES = new Set(['succeeded', 'failed', 'cancelled'])
const KNOWN_STATES = new Set([
  'queued',
  'running',
  'cancel_requested',
  ...TERMINAL_STATES
])

function sleep (durationMs) {
  return new Promise(resolve => setTimeout(resolve, durationMs))
}

function assertStatus (status) {
  if (!status || typeof status !== 'object') {
    throw new Error('Native operation status must be an object')
  }
  if (status.contract_version !== 1) {
    throw new Error('Unsupported native operation contract version')
  }
  if (typeof status.operation_id !== 'string' || status.operation_id.length === 0) {
    throw new Error('Native operation status is missing operation_id')
  }
  if (!KNOWN_STATES.has(status.state)) {
    throw new Error(`Unknown native operation state: ${String(status.state)}`)
  }
  return status
}

/**
 * Poll an adoptable native operation until its native terminal state is known.
 * Cancellation never invents an early terminal result: a running operation
 * remains `cancel_requested` until the native worker actually exits.
 */
export async function waitForNativeOperation (node, initialStatus, signal) {
  let status = assertStatus(initialStatus)

  while (!TERMINAL_STATES.has(status.state)) {
    if (signal?.aborted && !status.cancellation_requested) {
      status = assertStatus(node.cancelNativeOperation(status.operation_id))
    }
    if (!TERMINAL_STATES.has(status.state)) {
      await sleep(POLL_INTERVAL_MS)
      status = assertStatus(node.nativeOperationStatus(status.operation_id))
    }
  }

  if (status.state === 'succeeded') return status
  if (status.state === 'cancelled') {
    throw new Error('Native operation was cancelled before it started')
  }
  throw new Error(status.error || 'Native operation failed without an error')
}

export function validateNativeOperationStatus (status) {
  return Object.freeze({ ...assertStatus(status) })
}
