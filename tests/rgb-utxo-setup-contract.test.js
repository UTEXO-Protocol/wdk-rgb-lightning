import {
  validateCreateUtxosRequest,
  validatePreparedCreateUtxosResponse,
  validateRgbUnspents
} from '../src/rgb-utxo-setup-contract.js'

const PLAN_ID = 'ab'.repeat(32)

describe('RGB UTXO setup contract', () => {
  it('normalizes an exact create request without adding native defaults', () => {
    expect(validateCreateUtxosRequest({
      up_to: true,
      num: 5,
      size: 1_000,
      fee_rate: 2,
      skip_sync: false
    })).toEqual({
      up_to: true,
      num: 5,
      size: 1_000,
      fee_rate: 2,
      skip_sync: false
    })
  })

  it.each([
    [{ up_to: true, fee_rate: 2, skip_sync: false, typo: true }],
    [{ up_to: 'true', fee_rate: 2, skip_sync: false }],
    [{ up_to: true, num: 0, fee_rate: 2, skip_sync: false }],
    [{ up_to: true, num: 256, fee_rate: 2, skip_sync: false }],
    [{ up_to: true, size: 0, fee_rate: 2, skip_sync: false }],
    [{ up_to: true, fee_rate: 0, skip_sync: false }]
  ])('rejects an invalid create request %#', (request) => {
    expect(() => validateCreateUtxosRequest(request)).toThrow(TypeError)
  })

  it('returns an immutable review-safe setup plan', () => {
    const plan = validatePreparedCreateUtxosResponse({
      plan_id: PLAN_ID.toUpperCase(),
      fee_sat: '300',
      total_input_sat: '10300',
      total_output_sat: '10000',
      size_vbytes: '180',
      target_count: 5,
      output_size_sat: 2_000
    })

    expect(plan).toEqual({
      plan_id: PLAN_ID,
      fee_sat: '300',
      total_input_sat: '10300',
      total_output_sat: '10000',
      size_vbytes: '180',
      target_count: 5,
      output_size_sat: 2_000
    })
    expect(Object.isFrozen(plan)).toBe(true)
    expect(plan).not.toHaveProperty('psbt')
  })

  it.each([
    [{ plan_id: PLAN_ID, fee_sat: '1', total_input_sat: '2', total_output_sat: '1', size_vbytes: '1', target_count: 1, output_size_sat: 1, psbt: 'secret' }],
    [{ plan_id: PLAN_ID, fee_sat: '2', total_input_sat: '2', total_output_sat: '1', size_vbytes: '1', target_count: 1, output_size_sat: 1 }],
    [{ plan_id: PLAN_ID, fee_sat: '1', total_input_sat: '2', total_output_sat: '1', size_vbytes: '0', target_count: 1, output_size_sat: 1 }],
    [{ plan_id: PLAN_ID, fee_sat: '1', total_input_sat: '2', total_output_sat: '1', size_vbytes: '1', target_count: 0, output_size_sat: 1 }]
  ])('rejects an invalid prepared response %#', (response) => {
    expect(() => validatePreparedCreateUtxosResponse(response)).toThrow(TypeError)
  })

  it('returns normalized, deeply immutable RGB unspents', () => {
    const txid = 'AB'.repeat(32)
    const unspents = validateRgbUnspents([{
      utxo: {
        outpoint: `${txid}:01`,
        btc_amount: 20_000,
        colorable: true
      },
      rgb_allocations: [{
        asset_id: null,
        assignment: 'Blind',
        settled: false
      }],
      pending_blinded: 1
    }])

    expect(unspents).toEqual([{
      utxo: {
        outpoint: `${txid.toLowerCase()}:1`,
        btc_amount: 20_000,
        colorable: true
      },
      rgb_allocations: [{
        asset_id: null,
        assignment: 'Blind',
        settled: false
      }],
      pending_blinded: 1
    }])
    expect(Object.isFrozen(unspents)).toBe(true)
    expect(Object.isFrozen(unspents[0])).toBe(true)
    expect(Object.isFrozen(unspents[0].utxo)).toBe(true)
    expect(Object.isFrozen(unspents[0].rgb_allocations)).toBe(true)
    expect(Object.isFrozen(unspents[0].rgb_allocations[0])).toBe(true)
  })

  it.each([
    [{ unspents: [] }],
    [[{
      utxo: {
        outpoint: `${'ab'.repeat(32)}:0`,
        btc_amount: 20_000,
        colorable: true
      },
      rgb_allocations: [],
      pending_blinded: 0,
      unexpected: true
    }]],
    [[{
      utxo: {
        outpoint: 'not-an-outpoint',
        btc_amount: 20_000,
        colorable: true
      },
      rgb_allocations: [],
      pending_blinded: 0
    }]],
    [[{
      utxo: {
        outpoint: `${'ab'.repeat(32)}:0`,
        btc_amount: Number.MAX_SAFE_INTEGER + 1,
        colorable: true
      },
      rgb_allocations: [],
      pending_blinded: 0
    }]],
    [[{
      utxo: {
        outpoint: `${'ab'.repeat(32)}:0`,
        btc_amount: 20_000,
        colorable: true
      },
      rgb_allocations: [],
      pending_blinded: -1
    }]]
  ])('rejects invalid RGB unspents %#', (unspents) => {
    expect(() => validateRgbUnspents(unspents)).toThrow(TypeError)
  })
})
