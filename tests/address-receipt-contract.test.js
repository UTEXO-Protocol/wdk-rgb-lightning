import { describe, expect, it } from '@jest/globals'

import { validateAddressReceipts } from '../src/address-receipt-contract.js'

const receipt = {
  txid: 'ab'.repeat(32),
  amount_sat: '125000',
  confirmations: 2,
  block_height: 200
}

describe('address receipt contract', () => {
  it('normalizes and freezes authoritative receipt evidence', () => {
    const result = validateAddressReceipts([receipt])
    expect(result).toEqual([receipt])
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result[0])).toBe(true)
  })

  it.each([
    [{ ...receipt, txid: 'bad' }],
    [{ ...receipt, amount_sat: 1 }],
    [{ ...receipt, amount_sat: '0' }],
    [{ ...receipt, amount_sat: (1n << 64n).toString() }],
    [{ ...receipt, confirmations: -1 }],
    [{ ...receipt, confirmations: 0, block_height: 200 }],
    [{ ...receipt, confirmations: 1, block_height: null }],
    [{ ...receipt, unexpected: true }],
    [receipt, receipt]
  ])('rejects malformed or ambiguous evidence %#', (...entries) => {
    expect(() => validateAddressReceipts(entries)).toThrow()
  })
})
