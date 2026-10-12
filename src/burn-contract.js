// Copyright 2026 UTEXO. Licensed under the Apache License, Version 2.0.
'use strict'

const U64_MAX = 18446744073709551615n
const FIELDS = new Set(['asset_id', 'amount', 'burn_recipient', 'fee_rate', 'min_confirmations'])

function positiveU64 (value, field) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value) && BigInt(value) <= U64_MAX) return value
  throw new TypeError(`${field} must be a positive safe integer or exact u64 decimal string`)
}

export function validateBurnRequest (request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new TypeError('Burn request must be an object')
  }
  if (Object.keys(request).some(key => !FIELDS.has(key))) {
    throw new TypeError('Burn request accepts only asset_id, amount, burn_recipient, fee_rate and min_confirmations')
  }
  const { asset_id: assetId, amount, burn_recipient: recipient, fee_rate: feeRate, min_confirmations: confirmations } = request
  if (typeof assetId !== 'string' || !/^rgb:[^\s\0]+$/.test(assetId) || assetId.length > 512) {
    throw new TypeError('asset_id must be an RGB contract id')
  }
  if (!Number.isInteger(confirmations) || confirmations < 0 || confirmations > 255) {
    throw new TypeError('min_confirmations must be a u8 integer')
  }
  if (recipient != null && (typeof recipient !== 'string' || !/^[a-f\d]{64}$/i.test(recipient))) {
    throw new TypeError('burn_recipient must be 32 bytes of hexadecimal without a 0x prefix')
  }
  const result = {
    asset_id: assetId,
    amount: positiveU64(amount, 'amount'),
    fee_rate: positiveU64(feeRate, 'fee_rate'),
    min_confirmations: confirmations
  }
  if (recipient !== undefined) result.burn_recipient = recipient
  return Object.freeze(result)
}

export function validateBurnResponse (result) {
  if (!result || typeof result !== 'object' || Array.isArray(result) ||
      typeof result.txid !== 'string' || !/^[a-f\d]{64}$/i.test(result.txid) ||
      !Number.isInteger(result.batch_transfer_idx) || result.batch_transfer_idx < -2147483648 || result.batch_transfer_idx > 2147483647) {
    throw new TypeError('Invalid native burn response; reconcile wallet history before requesting another burn')
  }
  return result
}
