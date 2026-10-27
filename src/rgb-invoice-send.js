// Copyright 2026 UTEXO. Licensed under the Apache License, Version 2.0.
const FIELDS = new Set(['invoice', 'asset_id', 'amount', 'donation', 'fee_rate', 'min_confirmations', 'witness_data'])
const U64_MAX = 18446744073709551615n

function positive (value, field) {
  if (Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value) && BigInt(value) <= U64_MAX) return value
  throw new TypeError(`${field} must be an exact positive u64`)
}

/** Preserve the complete invoice for Rust's protocol-1.0 recipient construction. */
export function validateRgbInvoiceSend (value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !FIELDS.has(key)) ||
      typeof value.invoice !== 'string' || !/^rgb:[^\s\0]+$/.test(value.invoice) || value.invoice.length > 16384 ||
      typeof value.asset_id !== 'string' || !/^rgb:[^\s\0]+$/.test(value.asset_id) || value.asset_id.length > 512 ||
      typeof value.donation !== 'boolean' || !Number.isInteger(value.min_confirmations) ||
      value.min_confirmations < 0 || value.min_confirmations > 255) {
    throw new TypeError('Invalid RGB invoice send request')
  }
  const request = {
    invoice: value.invoice,
    asset_id: value.asset_id,
    amount: positive(value.amount, 'amount'),
    donation: value.donation,
    fee_rate: positive(value.fee_rate, 'fee_rate'),
    min_confirmations: value.min_confirmations
  }
  if (value.witness_data != null) {
    const witness = value.witness_data
    if (typeof witness !== 'object' || Array.isArray(witness) ||
        Object.keys(witness).some(key => key !== 'amount_sat')) {
      throw new TypeError('Protocol-1.0 witness blinding must be derived by the native wallet')
    }
    request.witness_data = Object.freeze({ amount_sat: positive(witness.amount_sat, 'witness_data.amount_sat') })
  }
  return Object.freeze(request)
}
