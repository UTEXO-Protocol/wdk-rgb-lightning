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

export function toUint64String (value, field = 'value') {
  return String(toUint64(value, field))
}

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

/** Map the LSP's snake_case response keys onto the public camelCase shape. */
export function camelCaseLspResponse (raw) {
  if (!raw || typeof raw !== 'object') return raw
  const out = { ...raw }
  if ('rgb_invoice' in raw) out.rgbInvoice = raw.rgb_invoice
  if ('ln_invoice' in raw) out.lnInvoice = raw.ln_invoice
  if ('mapping_id' in raw) out.mappingId = raw.mapping_id
  return out
}

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
