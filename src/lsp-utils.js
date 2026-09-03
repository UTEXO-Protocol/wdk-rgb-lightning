// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
'use strict'

// Pure LSP wire-shape and integer adapters. Keeping these below both the
// HTTP client and composed flows avoids a lsp-client <-> lsp-helpers cycle.

const UINT64_MAX = (1n << 64n) - 1n
const HASH_HEX = /^[0-9a-f]{64}$/i
const MAX_INVOICE_LENGTH = 128 * 1024

/**
 * Convert a JS integer to the JSON representation accepted by uint64 fields.
 * Safe numbers stay numbers; larger bigint values and numeric strings stay
 * strings so JSON serialization cannot lose precision.
 *
 * @param {number|bigint|string} value - Unsigned integer to normalize.
 * @param {string} [field] - Field name included in validation errors. Defaults
 *   to `value`.
 * @returns {number|string} - A JSON-safe uint64 representation.
 * @throws {TypeError} - If `value` is negative, fractional, malformed, unsafe
 *   as a number, or larger than uint64.
 */
export function toUint64 (value, field = 'value') {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) throw uint64TypeError(field)
    return value
  }
  if (typeof value === 'bigint') {
    if (value < 0n || value > UINT64_MAX) throw uint64TypeError(field)
    return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString()
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    if (BigInt(value) > UINT64_MAX) throw uint64TypeError(field)
    return value
  }
  throw uint64TypeError(field)
}

/**
 * Convert a JS integer to a base-10 uint64 string.
 *
 * @param {number|bigint|string} value - Unsigned integer to normalize.
 * @param {string} [field] - Field name included in validation errors. Defaults
 *   to `value`.
 * @returns {string} - Base-10 uint64 text.
 * @throws {TypeError} - If `value` cannot be represented as uint64.
 */
export function toUint64String (value, field = 'value') {
  return String(toUint64(value, field))
}

/**
 * Convert a JS integer to an unsigned 32-bit number.
 *
 * @param {number|bigint|string} value - Unsigned integer to normalize.
 * @param {string} [field] - Field name included in validation errors. Defaults
 *   to `value`.
 * @returns {number} - The normalized uint32 value.
 * @throws {TypeError} - If `value` is malformed, fractional, negative, or
 *   larger than uint32.
 */
export function toUint32 (value, field = 'value') {
  let number
  if (typeof value === 'number' || typeof value === 'bigint') {
    number = Number(value)
  } else if (typeof value === 'string' && /^\d+$/.test(value)) {
    number = Number(value)
  } else {
    throw new TypeError(`${field} must fit in uint32`)
  }
  if (!Number.isInteger(number) || number < 0 || number > 0xffffffff) {
    throw new TypeError(`${field} must fit in uint32`)
  }
  return number
}

/**
 * Map the LSP's snake_case response keys onto the public camelCase shape.
 *
 * @param {*} raw - LSP response value.
 * @returns {*} - The response with known camelCase aliases added.
 */
export function camelCaseLspResponse (raw) {
  if (!raw || typeof raw !== 'object') return raw
  const out = { ...raw }
  if ('rgb_invoice' in raw) out.rgbInvoice = raw.rgb_invoice
  if ('ln_invoice' in raw) out.lnInvoice = raw.ln_invoice
  if ('mapping_id' in raw) out.mappingId = raw.mapping_id
  return out
}

/**
 * Map public Lightning parameters to the LSP wire shape.
 *
 * @param {object} ln - Public camelCase Lightning parameters.
 * @returns {object} - LSP snake_case Lightning parameters.
 * @throws {TypeError} - If an integer field is outside its uint range.
 */
export function snakeCaseLnParams (ln) {
  if (ln === null || typeof ln !== 'object' || Array.isArray(ln)) {
    throw new TypeError('ln must be an object')
  }

  const out = {}
  if (ln.amtMsat !== undefined) {
    out.amt_msat = toUint64(ln.amtMsat, 'ln.amtMsat')
    if (BigInt(out.amt_msat) === 0n) throw new TypeError('ln.amtMsat must be positive')
  }
  if (ln.expirySec !== undefined) out.expiry_sec = toUint32(ln.expirySec, 'ln.expirySec')
  if (ln.assetId !== undefined) {
    out.asset_id = canonicalAssetId(ln.assetId, 'ln.assetId')
  }
  if (ln.assetAmount !== undefined) {
    out.asset_amount = toUint64(ln.assetAmount, 'ln.assetAmount')
    if (BigInt(out.asset_amount) === 0n) throw new TypeError('ln.assetAmount must be positive')
  }
  if (ln.descriptionHash !== undefined) {
    out.description_hash = requiredHash(ln.descriptionHash, 'ln.descriptionHash')
  }
  if (ln.paymentHash !== undefined) {
    out.payment_hash = requiredHash(ln.paymentHash, 'ln.paymentHash')
  }
  if (ln.minFinalCltvExpiryDelta !== undefined) {
    const delta = toUint32(ln.minFinalCltvExpiryDelta, 'ln.minFinalCltvExpiryDelta')
    if (delta > 0xffff) throw new TypeError('ln.minFinalCltvExpiryDelta must fit in uint16')
    out.min_final_cltv_expiry_delta = delta
  }
  return out
}

/**
 * Map public RGB parameters to the LSP wire shape.
 *
 * @param {object} rgb - Public camelCase RGB parameters.
 * @returns {object} - LSP snake_case RGB parameters.
 * @throws {TypeError} - If an integer field is outside uint32.
 */
export function snakeCaseRgbParams (rgb) {
  if (rgb === null || typeof rgb !== 'object' || Array.isArray(rgb)) {
    throw new TypeError('rgb must be an object')
  }
  const rawAssignment = rgb.assignment ?? 'Any'
  if (typeof rawAssignment !== 'string') {
    throw new TypeError('rgb.assignment must be "Any" or "Value"')
  }
  const normalizedAssignment = rawAssignment.trim().toLowerCase()
  const assignment = normalizedAssignment === '' || normalizedAssignment === 'any'
    ? 'Any'
    : normalizedAssignment === 'value'
      ? 'Value'
      : undefined
  if (assignment === undefined) {
    throw new TypeError('rgb.assignment must be "Any" or "Value"')
  }
  if (rgb.witness !== undefined && typeof rgb.witness !== 'boolean') {
    throw new TypeError('rgb.witness must be a boolean')
  }
  const minConfirmations = rgb.minConfirmations === undefined
    ? 1
    : toUint32(rgb.minConfirmations, 'rgb.minConfirmations')
  if (minConfirmations > 0xff) throw new TypeError('rgb.minConfirmations must fit in uint8')

  const out = {
    assignment,
    min_confirmations: minConfirmations,
    witness: rgb.witness ?? false
  }
  if (rgb.assetId !== undefined) out.asset_id = canonicalAssetId(rgb.assetId, 'rgb.assetId')
  if (rgb.durationSeconds !== undefined) out.duration_seconds = toUint32(rgb.durationSeconds, 'rgb.durationSeconds')
  return out
}

/**
 * Require an exact, transport-safe RGB asset identifier.
 *
 * @param {unknown} value - Candidate asset identifier.
 * @param {string} [field] - Field name included in validation errors.
 * @returns {string} - The unchanged canonical identifier.
 */
export function canonicalAssetId (value, field = 'assetId') {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 512 ||
    value !== value.trim() ||
    /\s/.test(value)
  ) {
    throw new TypeError(`${field} must be a non-empty whitespace-free string`)
  }
  return value
}

/**
 * Require an exact invoice string without silently changing signed input.
 *
 * @param {unknown} value - Candidate BOLT11 or RGB invoice.
 * @param {string} [field] - Field name included in validation errors.
 * @returns {string} - The unchanged canonical invoice.
 */
export function canonicalInvoice (value, field = 'invoice') {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_INVOICE_LENGTH ||
    value !== value.trim() ||
    /\s/.test(value)
  ) {
    throw new TypeError(`${field} required`)
  }
  return value
}

function requiredHash (value, field) {
  if (typeof value !== 'string' || !HASH_HEX.test(value)) {
    throw new TypeError(`${field} must be 32-byte hexadecimal`)
  }
  return value.toLowerCase()
}

function uint64TypeError (field) {
  return new TypeError(`${field} must be a non-negative integer that fits in uint64`)
}
