import {
  validateCancelBtcSendPlanResponse,
  validateCommittedBtcSendResponse,
  validateCommittedRgbSendResponse,
  validatePendingVanillaTransactions,
  validatePreparedSendResponse
} from '../src/send-plan-contract.js'

const TXID = 'ab'.repeat(32)

function plan (overrides = {}) {
  return {
    plan_id: TXID,
    unsigned_psbt: 'cHNidP8BAAoCAAAAAQ',
    fee_sat: '100',
    total_input_sat: '10000',
    total_output_sat: '9900',
    size_vbytes: '140',
    ...overrides
  }
}

describe('prepared send contract', () => {
  it('accepts and freezes a coherent lossless plan', () => {
    const result = validatePreparedSendResponse(plan())

    expect(result).toEqual(plan())
    expect(Object.isFrozen(result)).toBe(true)
  })

  it.each([
    ['unknown keys', { extra: true }],
    ['invalid txid', { plan_id: 'abc' }],
    ['empty PSBT', { unsigned_psbt: '' }],
    ['JSON number fee', { fee_sat: 100 }],
    ['negative decimal', { fee_sat: '-1' }],
    ['fee mismatch', { fee_sat: '99' }],
    ['zero vsize', { size_vbytes: '0' }]
  ])('rejects %s', (_label, overrides) => {
    expect(() => validatePreparedSendResponse(plan(overrides))).toThrow()
  })

  it('validates exact commit and cancellation responses', () => {
    expect(validateCommittedBtcSendResponse({ txid: TXID })).toEqual({ txid: TXID })
    expect(validateCommittedRgbSendResponse({
      txid: TXID,
      batch_transfer_idx: 7
    })).toEqual({
      txid: TXID,
      batch_transfer_idx: 7
    })
    expect(validateCancelBtcSendPlanResponse({ cancelled: true }))
      .toEqual({ cancelled: true })
    expect(validatePendingVanillaTransactions([{
      txid: TXID,
      operation_type: 'SendBtc'
    }])).toEqual([{
      txid: TXID,
      operation_type: 'SendBtc'
    }])
  })
})
