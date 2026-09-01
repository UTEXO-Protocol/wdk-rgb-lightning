import {
  validateCancelBtcSendPlanResponse,
  validateCommittedBtcSendResponse,
  validateCommittedRgbSendResponse,
  validatePendingRgbSendPlans,
  validatePendingVanillaTransactions,
  validatePreparedRgbSendResponse,
  validatePreparedSendResponse,
  validateSendPlanRequest
} from '../src/send-plan-contract.js'

const TXID = 'ab'.repeat(32)

function plan (overrides = {}) {
  return {
    plan_id: TXID,
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
    ['native commit material', { unsigned_psbt: 'must-not-cross-the-JS-boundary' }],
    ['JSON number fee', { fee_sat: 100 }],
    ['negative decimal', { fee_sat: '-1' }],
    ['fee mismatch', { fee_sat: '99' }],
    ['zero vsize', { size_vbytes: '0' }]
  ])('rejects %s', (_label, overrides) => {
    expect(() => validatePreparedSendResponse(plan(overrides))).toThrow()
  })

  it('validates exact commit and cancellation responses', () => {
    expect(validateSendPlanRequest({ plan_id: TXID.toUpperCase() })).toEqual({
      plan_id: TXID
    })
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
    expect(validatePreparedRgbSendResponse({
      ...plan(),
      batch_transfer_idx: 7
    })).toEqual({
      ...plan(),
      batch_transfer_idx: 7
    })
    expect(validatePendingRgbSendPlans([{
      plan_id: TXID,
      batch_transfer_idx: 7
    }])).toEqual([{
      plan_id: TXID,
      batch_transfer_idx: 7
    }])
  })

  it('rejects commit material and duplicate pending native identities', () => {
    expect(() => validateSendPlanRequest({
      plan_id: TXID,
      unsigned_psbt: 'must-not-cross-the-WDK-boundary'
    })).toThrow()
    expect(() => validatePendingVanillaTransactions([
      { txid: TXID, operation_type: 'SendBtc' },
      { txid: TXID.toUpperCase(), operation_type: 'SendBtc' }
    ])).toThrow()
    expect(() => validatePendingRgbSendPlans([
      { plan_id: TXID, batch_transfer_idx: 7 },
      { plan_id: TXID.toUpperCase(), batch_transfer_idx: 7 }
    ])).toThrow()
  })
})
