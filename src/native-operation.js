// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
'use strict'

const POLL_INTERVAL_MS = 100
const TERMINAL_STATES = new Set(['succeeded', 'failed', 'cancelled'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UNSIGNED_DECIMAL = /^(0|[1-9][0-9]*)$/
const REQUIRED_FIELDS = new Set([
  'contract_version',
  'operation_id',
  'kind',
  'state',
  'created_at_ms',
  'updated_at_ms',
  'cancellation_requested',
  'can_cancel_immediately',
  'adoption_count'
])
const OPTIONAL_FIELDS = new Set([
  'started_at_ms',
  'finished_at_ms',
  'error',
  'adopted_existing'
])
const KNOWN_STATES = new Set([
  'queued',
  'running',
  'cancel_requested',
  ...TERMINAL_STATES
])

function sleep (durationMs) {
  return new Promise(resolve => setTimeout(resolve, durationMs))
}

function decimal (value, field) {
  if (typeof value !== 'string' || !UNSIGNED_DECIMAL.test(value)) {
    throw new Error(`Native operation status has invalid ${field}`)
  }
  return BigInt(value)
}

function assertStatus (status, expected) {
  if (!status || typeof status !== 'object' || Array.isArray(status)) {
    throw new Error('Native operation status must be an object')
  }
  for (const field of REQUIRED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(status, field)) {
      throw new Error(`Native operation status is missing ${field}`)
    }
  }
  for (const field of Object.keys(status)) {
    if (!REQUIRED_FIELDS.has(field) && !OPTIONAL_FIELDS.has(field)) {
      throw new Error(`Native operation status has unknown field ${field}`)
    }
  }
  if (status.contract_version !== 1) {
    throw new Error('Unsupported native operation contract version')
  }
  if (typeof status.operation_id !== 'string' || !UUID.test(status.operation_id)) {
    throw new Error('Native operation status has invalid operation_id')
  }
  if (status.kind !== 'unlock_with_native_external_signer') {
    throw new Error('Native operation status has an unknown operation kind')
  }
  if (!KNOWN_STATES.has(status.state)) {
    throw new Error(`Unknown native operation state: ${String(status.state)}`)
  }
  if (
    typeof status.cancellation_requested !== 'boolean' ||
    typeof status.can_cancel_immediately !== 'boolean' ||
    !Number.isSafeInteger(status.adoption_count) ||
    status.adoption_count < 0
  ) {
    throw new Error('Native operation status has invalid lifecycle metadata')
  }
  if (
    Object.prototype.hasOwnProperty.call(status, 'adopted_existing') &&
    typeof status.adopted_existing !== 'boolean'
  ) {
    throw new Error('Native operation status has invalid adoption metadata')
  }

  const createdAt = decimal(status.created_at_ms, 'created_at_ms')
  const updatedAt = decimal(status.updated_at_ms, 'updated_at_ms')
  const startedAt = status.started_at_ms === undefined
    ? null
    : decimal(status.started_at_ms, 'started_at_ms')
  const finishedAt = status.finished_at_ms === undefined
    ? null
    : decimal(status.finished_at_ms, 'finished_at_ms')
  if (
    updatedAt < createdAt ||
    (startedAt !== null && (startedAt < createdAt || startedAt > updatedAt)) ||
    (finishedAt !== null && (
      finishedAt < (startedAt ?? createdAt) ||
      finishedAt > updatedAt
    ))
  ) {
    throw new Error('Native operation status has inconsistent timestamps')
  }

  const terminal = TERMINAL_STATES.has(status.state)
  if (
    (status.state !== 'queued' && startedAt === null && status.state !== 'cancelled') ||
    (terminal !== (finishedAt !== null)) ||
    (status.can_cancel_immediately !== (status.state === 'queued')) ||
    (['queued', 'running'].includes(status.state) && status.cancellation_requested) ||
    (['cancel_requested', 'cancelled'].includes(status.state) &&
      !status.cancellation_requested) ||
    (status.state === 'failed') !== (
      typeof status.error === 'string' && status.error.length > 0
    )
  ) {
    throw new Error('Native operation status has inconsistent state metadata')
  }

  if (expected) {
    if (
      status.operation_id !== expected.operationId ||
      status.kind !== expected.kind ||
      status.created_at_ms !== expected.createdAt
    ) {
      throw new Error('Native operation identity changed while polling')
    }
    if (
      updatedAt < expected.updatedAt ||
      status.adoption_count < expected.adoptionCount
    ) {
      throw new Error('Native operation lifecycle regressed while polling')
    }
  }
  return status
}

function canTransition (from, to) {
  if (from === to) return true
  if (from === 'queued') return true
  if (from === 'running') {
    return to === 'cancel_requested' || TERMINAL_STATES.has(to)
  }
  if (from === 'cancel_requested') return TERMINAL_STATES.has(to)
  return false
}

function nextStatus (previous, candidate) {
  const current = assertStatus(candidate, {
    operationId: previous.operation_id,
    kind: previous.kind,
    createdAt: previous.created_at_ms,
    updatedAt: BigInt(previous.updated_at_ms),
    adoptionCount: previous.adoption_count
  })
  if (!canTransition(previous.state, current.state)) {
    throw new Error('Native operation state regressed while polling')
  }
  return current
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
      status = nextStatus(
        status,
        node.cancelNativeOperation(status.operation_id)
      )
    }
    if (!TERMINAL_STATES.has(status.state)) {
      await sleep(POLL_INTERVAL_MS)
      status = nextStatus(
        status,
        node.nativeOperationStatus(status.operation_id)
      )
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
