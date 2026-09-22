// Copyright 2026 UTEXO. Licensed under the Apache License, Version 2.0.
'use strict'

const TRANSFER_STATUSES = new Set(['Initiated', 'WaitingCounterparty', 'WaitingSafeHeight', 'WaitingConfirmations', 'WaitingBroadcast', 'Settled', 'Failed'])

export function exactUnsignedNumber (value, field) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value
  if ((typeof value === 'bigint' && value >= 0n) || (typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value))) {
    const integer = BigInt(value)
    if (integer <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(integer)
  }
  throw new TypeError(`${field} must be an exact non-negative safe integer`)
}

export function validatePaymentRequest (request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new TypeError('Payment request must be an object')
  const allowed = new Set(['invoice', 'amt_msat', 'asset_id', 'asset_amount'])
  if (Object.keys(request).some(key => !allowed.has(key))) {
    const error = new Error('RLN 0.13 does not support this payment field; routing fee caps are unavailable')
    error.code = 'ERR_RLN_UNSUPPORTED_CAPABILITY'
    throw error
  }
  return request
}

export function validateRefreshResult (value) {
  if (!value?.transfers || typeof value.transfers !== 'object' || Array.isArray(value.transfers)) {
    throw new TypeError('Invalid refresh transfer result')
  }
  for (const [index, transfer] of Object.entries(value.transfers)) {
    if (!/^-?\d+$/.test(index) || !Number.isSafeInteger(Number(index)) || Number(index) < -2147483648 || Number(index) > 2147483647 ||
        !transfer || typeof transfer !== 'object' ||
        (transfer.updated_status !== null && !TRANSFER_STATUSES.has(transfer.updated_status)) ||
        (transfer.failure !== null && (typeof transfer.failure?.name !== 'string' || typeof transfer.failure?.message !== 'string'))) {
      throw new TypeError('Invalid or unknown refresh transfer status/failure')
    }
  }
  return value
}

export function validateUnspents (value) {
  if (!Array.isArray(value) || value.length > 10000) throw new TypeError('Invalid native unspent list')
  for (const entry of value) {
    const utxo = entry?.utxo
    if (!utxo || !/^[a-f\d]{64}:\d+$/i.test(utxo.outpoint) ||
        Number(utxo.outpoint.split(':')[1]) > 0xffffffff ||
        typeof utxo.exists !== 'boolean' || typeof utxo.colorable !== 'boolean') {
      throw new TypeError('Invalid native unspent output')
    }
    exactUnsignedNumber(utxo.btc_amount, 'utxo.btc_amount')
    if (!Array.isArray(entry.rgb_allocations) || entry.rgb_allocations.length > 255) throw new TypeError('Invalid native RGB allocations')
    for (const allocation of entry.rgb_allocations) {
      if ((allocation.asset_id !== null && (typeof allocation.asset_id !== 'string' || allocation.asset_id.length === 0 || allocation.asset_id.length > 512)) ||
          typeof allocation.assignment !== 'string' || allocation.assignment.length === 0 || allocation.assignment.length > 512 || typeof allocation.settled !== 'boolean') {
        throw new TypeError('Invalid native RGB allocation')
      }
    }
  }
  // exists=false entries are preserved, never silently classified as spendable.
  return value
}
