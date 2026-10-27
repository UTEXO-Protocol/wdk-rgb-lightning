// Copyright 2026 UTEXO. Licensed under the Apache License, Version 2.0.
'use strict'

export const RGB_OUTPUT_OPERATIONS_CAPABILITY = 'rgb-output-operations-v1'
const METHODS = ['prepareCreateUtxos', 'commitPreparedCreateUtxos', 'cancelCreateUtxosPlan',
  'getCreateUtxosOperation', 'listCreateUtxosOperations', 'listPendingVanillaTransactions']
const STATUSES = ['preparing', 'prepared', 'submitting', 'broadcast', 'confirmed', 'cancelled', 'failed']
const ACTIVE = ['prepared', 'submitting', 'broadcast', 'confirmed']
const HEX_ID = /^[a-f0-9]{32,64}$/
const TXID = /^[a-f0-9]{64}$/
const U64_MAX = 18446744073709551615n

function object (value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !fields.includes(key))) {
    throw new TypeError(`Invalid ${label}`)
  }
}

function uint (value, maximum, label, positive = false) {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0) || value > maximum) {
    throw new RangeError(`Invalid ${label}`)
  }
  return value
}

function uint64 (value, label, positive = false) {
  if (!((typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) ||
      (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value))) ||
      BigInt(value) > U64_MAX || (positive && BigInt(value) === 0n)) {
    throw new RangeError(`Invalid ${label}`)
  }
  return value
}

export function validateCreateUtxosOperationRequest (request, prepare = false) {
  const fields = prepare
    ? ['operation_id', 'up_to', 'num', 'size', 'fee_rate', 'skip_sync']
    : ['operation_id']
  object(request, fields, 'RGB output operation request')
  if (typeof request.operation_id !== 'string' || !HEX_ID.test(request.operation_id)) {
    throw new TypeError('RGB output operation_id must contain 32 to 64 lowercase hex characters')
  }
  if (prepare) {
    if (typeof request.up_to !== 'boolean' || typeof request.skip_sync !== 'boolean') {
      throw new TypeError('RGB output up_to and skip_sync must be booleans')
    }
    if (request.num != null) uint(request.num, 255, 'RGB output num', true)
    if (request.size != null) uint(request.size, 4294967295, 'RGB output size', true)
    uint64(request.fee_rate, 'RGB output fee_rate', true)
  }
  return { ...request }
}

/** Validate native evidence; a transaction history delta is never operation identity. */
export function validateCreateUtxosOperation (value, operationId) {
  const fields = ['operation_id', 'txid', 'status', 'can_cancel', 'can_commit', 'inputs', 'num_outputs', 'size_sat', 'fee_sat', 'fee_rate']
  object(value, fields, 'native RGB output operation')
  if (Object.keys(value).length !== fields.length || typeof value.operation_id !== 'string' || !HEX_ID.test(value.operation_id) ||
      (operationId !== undefined && value.operation_id !== operationId) || !STATUSES.includes(value.status) ||
      !(value.txid === null || (typeof value.txid === 'string' && TXID.test(value.txid))) ||
      !Array.isArray(value.inputs) || value.inputs.length > 10000) {
    throw new TypeError('Invalid native RGB output operation identity or status')
  }
  if (typeof value.can_cancel !== 'boolean' || typeof value.can_commit !== 'boolean' ||
      (value.can_cancel && value.status !== 'prepared') ||
      value.can_commit !== ['prepared', 'submitting'].includes(value.status)) {
    throw new TypeError('Invalid native RGB output operation permissions')
  }
  const inputs = value.inputs.map(input => {
    object(input, ['txid', 'vout'], 'native RGB output input')
    if (Object.keys(input).length !== 2 || typeof input.txid !== 'string' || !TXID.test(input.txid)) {
      throw new TypeError('Invalid native RGB output input')
    }
    return { txid: input.txid, vout: uint(input.vout, 4294967295, 'native RGB output input vout') }
  })
  if (new Set(inputs.map(input => `${input.txid}:${input.vout}`)).size !== inputs.length) {
    throw new TypeError('Native RGB output operation repeats a reserved input')
  }
  const active = ACTIVE.includes(value.status)
  uint(value.num_outputs, 255, 'native RGB output count', active)
  uint(value.size_sat, 4294967295, 'native RGB output size', true)
  uint64(value.fee_sat, 'native RGB output fee', active)
  uint64(value.fee_rate, 'native RGB output fee rate', true)
  if (active && (value.txid === null || inputs.length === 0)) {
    throw new TypeError('Native RGB output transaction evidence is incomplete')
  }
  return { ...value, inputs }
}

export function validateCreateUtxosOperations (value) {
  if (!Array.isArray(value) || value.length > 10000) throw new TypeError('Invalid native RGB output operations')
  const operations = value.map(item => validateCreateUtxosOperation(item))
  if (new Set(operations.map(item => item.operation_id)).size !== operations.length) {
    throw new TypeError('Native RGB output operations repeat an operation identity')
  }
  return operations
}

export function validatePendingVanillaTransactions (value) {
  if (!Array.isArray(value) || value.length > 10000) throw new TypeError('Invalid pending native transactions')
  const transactions = value.map(item => {
    object(item, ['txid', 'type'], 'pending native transaction')
    if (Object.keys(item).length !== 2 || typeof item.txid !== 'string' || !TXID.test(item.txid) ||
        !['CreateUtxos', 'SendBtc', 'Drain'].includes(item.type)) {
      throw new TypeError('Invalid pending native transaction')
    }
    return { ...item }
  })
  if (new Set(transactions.map(item => item.txid)).size !== transactions.length) {
    throw new TypeError('Pending native transactions repeat a transaction identity')
  }
  return transactions
}

export function nativeRgbOutputSetupCapabilities (native) {
  const info = native.getRuntimeInfo?.()
  return Object.freeze({
    supported: Array.isArray(info?.capabilities) &&
    info.capabilities.includes(RGB_OUTPUT_OPERATIONS_CAPABILITY) &&
    METHODS.every(method => typeof native.SdkNode?.prototype?.[method] === 'function')
  })
}

export function requireRgbOutputSetup (binding) {
  if (binding.getRgbOutputSetupCapabilities?.()?.supported !== true) {
    const error = new Error('The installed native runtime does not support recoverable RGB output operations')
    error.code = 'ERR_RGB_OUTPUT_OPERATIONS_UNAVAILABLE'
    throw error
  }
}
