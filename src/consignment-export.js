// Copyright 2026 UTEXO. Licensed under the Apache License, Version 2.0.

export function consignmentLookup (assetId, txid) {
  if (typeof assetId !== 'string' || !assetId.startsWith('rgb:') ||
      assetId.length <= 4 || assetId.length > 512 || /[\s\0]/.test(assetId)) {
    throw new TypeError('assetId must be an RGB contract id')
  }
  if (typeof txid !== 'string' || !/^[a-f\d]{64}$/i.test(txid)) {
    throw new TypeError('txid must be a 32-byte transaction id')
  }
  return [assetId, txid.toLowerCase()]
}

export function consignmentBytes (response) {
  const hex = response?.bytes_hex
  if (typeof hex !== 'string' || hex.length === 0 || hex.length % 2 !== 0 || !/^[a-f\d]+$/.test(hex)) {
    throw new TypeError('Invalid native consignment: expected non-empty lowercase hexadecimal bytes')
  }
  const bytes = new Uint8Array(hex.length / 2)
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}
