// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
'use strict'

// Pure LSP wire-shape and integer adapters. Keeping these below both the
// HTTP client and composed flows avoids a lsp-client <-> lsp-helpers cycle.

const UINT64_MAX = (1n << 64n) - 1n

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
  const out = {}
  if (ln.amtMsat !== undefined) out.amt_msat = toUint64(ln.amtMsat, 'ln.amtMsat')
  if (ln.expirySec !== undefined) out.expiry_sec = toUint32(ln.expirySec, 'ln.expirySec')
  if (ln.assetId !== undefined) out.asset_id = String(ln.assetId)
  if (ln.assetAmount !== undefined) out.asset_amount = toUint64(ln.assetAmount, 'ln.assetAmount')
  if (ln.descriptionHash !== undefined) out.description_hash = String(ln.descriptionHash)
  if (ln.paymentHash !== undefined) out.payment_hash = String(ln.paymentHash)
  if (ln.minFinalCltvExpiryDelta !== undefined) {
    out.min_final_cltv_expiry_delta = toUint32(ln.minFinalCltvExpiryDelta, 'ln.minFinalCltvExpiryDelta')
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
  const out = {
    asset_id: rgb.assetId,
    assignment: String(rgb.assignment ?? 'Any'),
    min_confirmations: rgb.minConfirmations !== undefined ? toUint32(rgb.minConfirmations, 'rgb.minConfirmations') : 1,
    witness: !!rgb.witness
  }
  if (rgb.durationSeconds !== undefined) out.duration_seconds = toUint32(rgb.durationSeconds, 'rgb.durationSeconds')
  return out
}

function uint64TypeError (field) {
  return new TypeError(`${field} must be a non-negative integer that fits in uint64`)
}
