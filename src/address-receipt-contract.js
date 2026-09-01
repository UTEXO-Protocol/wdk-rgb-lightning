const TXID_PATTERN = /^[0-9a-f]{64}$/i
const DECIMAL_PATTERN = /^(0|[1-9]\d*)$/
const MAX_RECEIPTS = 1_000
const U64_MAX = (1n << 64n) - 1n

function fail (path, expectation) {
  throw new TypeError(`${path} must ${expectation}`)
}

function requireExactKeys (value, expected, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(path, 'be an object')
  }
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(path, `contain exactly: ${wanted.join(', ')}`)
  }
}

export function validateAddressReceipts (value) {
  if (!Array.isArray(value) || value.length > MAX_RECEIPTS) {
    fail('address receipts', `be an array with at most ${MAX_RECEIPTS} entries`)
  }

  const seen = new Set()
  return Object.freeze(value.map((receipt, index) => {
    const path = `address receipts[${index}]`
    requireExactKeys(
      receipt,
      ['txid', 'amount_sat', 'confirmations', 'block_height'],
      path
    )
    if (typeof receipt.txid !== 'string' || !TXID_PATTERN.test(receipt.txid)) {
      fail(`${path}.txid`, 'be a 32-byte transaction id')
    }
    const txid = receipt.txid.toLowerCase()
    if (seen.has(txid)) {
      fail(`${path}.txid`, 'be unique')
    }
    seen.add(txid)
    if (typeof receipt.amount_sat !== 'string' || !DECIMAL_PATTERN.test(receipt.amount_sat)) {
      fail(`${path}.amount_sat`, 'be an unsigned base-10 integer string')
    }
    const amountSat = BigInt(receipt.amount_sat)
    if (amountSat === 0n || amountSat > U64_MAX) {
      fail(`${path}.amount_sat`, 'be between one and the maximum unsigned 64-bit value')
    }
    if (!Number.isSafeInteger(receipt.confirmations) || receipt.confirmations < 0) {
      fail(`${path}.confirmations`, 'be a non-negative safe integer')
    }
    if (
      receipt.block_height !== null &&
      (!Number.isSafeInteger(receipt.block_height) || receipt.block_height < 1)
    ) {
      fail(`${path}.block_height`, 'be null or a positive safe integer')
    }
    if (
      (receipt.confirmations === 0 && receipt.block_height !== null) ||
      (receipt.confirmations > 0 && receipt.block_height === null)
    ) {
      fail(`${path}`, 'have coherent confirmation evidence')
    }
    return Object.freeze({
      txid,
      amount_sat: receipt.amount_sat,
      confirmations: receipt.confirmations,
      block_height: receipt.block_height
    })
  }))
}
