const TXID_PATTERN = /^[0-9a-f]{64}$/i
const DECIMAL_PATTERN = /^(0|[1-9]\d*)$/

function fail (path, expectation) {
  throw new TypeError(`${path} must ${expectation}`)
}

function requireObject (value, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(path, 'be an object')
  }
  return value
}

function requireExactKeys (value, expected, path) {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(path, `contain exactly: ${wanted.join(', ')}`)
  }
}

function requireDecimal (value, path) {
  if (typeof value !== 'string' || !DECIMAL_PATTERN.test(value)) {
    fail(path, 'be an unsigned base-10 integer string')
  }
  return value
}

export function validatePreparedSendResponse (value) {
  const response = requireObject(value, 'prepared send response')
  requireExactKeys(response, [
    'plan_id',
    'fee_sat',
    'total_input_sat',
    'total_output_sat',
    'size_vbytes'
  ], 'prepared send response')

  if (typeof response.plan_id !== 'string' || !TXID_PATTERN.test(response.plan_id)) {
    fail('prepared send response.plan_id', 'be a 32-byte transaction id')
  }
  const fee = BigInt(requireDecimal(response.fee_sat, 'prepared send response.fee_sat'))
  const totalInput = BigInt(
    requireDecimal(response.total_input_sat, 'prepared send response.total_input_sat')
  )
  const totalOutput = BigInt(
    requireDecimal(response.total_output_sat, 'prepared send response.total_output_sat')
  )
  const sizeVbytes = BigInt(
    requireDecimal(response.size_vbytes, 'prepared send response.size_vbytes')
  )

  if (totalOutput > totalInput) {
    fail('prepared send response', 'not spend more than its inputs')
  }
  if (totalInput - totalOutput !== fee) {
    fail('prepared send response.fee_sat', 'equal total_input_sat minus total_output_sat')
  }
  if (sizeVbytes === 0n) {
    fail('prepared send response.size_vbytes', 'be greater than zero')
  }

  return Object.freeze({
    plan_id: response.plan_id.toLowerCase(),
    fee_sat: response.fee_sat,
    total_input_sat: response.total_input_sat,
    total_output_sat: response.total_output_sat,
    size_vbytes: response.size_vbytes
  })
}

export function validatePreparedRgbSendResponse (value) {
  const response = requireObject(value, 'prepared RGB send response')
  requireExactKeys(response, [
    'plan_id',
    'batch_transfer_idx',
    'fee_sat',
    'total_input_sat',
    'total_output_sat',
    'size_vbytes'
  ], 'prepared RGB send response')
  if (!Number.isSafeInteger(response.batch_transfer_idx) || response.batch_transfer_idx < 0) {
    fail(
      'prepared RGB send response.batch_transfer_idx',
      'be a non-negative safe integer'
    )
  }
  const prepared = validatePreparedSendResponse({
    plan_id: response.plan_id,
    fee_sat: response.fee_sat,
    total_input_sat: response.total_input_sat,
    total_output_sat: response.total_output_sat,
    size_vbytes: response.size_vbytes
  })
  return Object.freeze({
    ...prepared,
    batch_transfer_idx: response.batch_transfer_idx
  })
}

function requireTxid (value, path) {
  if (typeof value !== 'string' || !TXID_PATTERN.test(value)) {
    fail(path, 'be a 32-byte transaction id')
  }
  return value.toLowerCase()
}

export function validateSendPlanRequest (value) {
  const request = requireObject(value, 'send plan request')
  requireExactKeys(request, ['plan_id'], 'send plan request')
  return Object.freeze({
    plan_id: requireTxid(request.plan_id, 'send plan request.plan_id')
  })
}

export function validateCommittedBtcSendResponse (value) {
  const response = requireObject(value, 'committed BTC send response')
  requireExactKeys(response, ['txid'], 'committed BTC send response')
  return Object.freeze({
    txid: requireTxid(response.txid, 'committed BTC send response.txid')
  })
}

export function validateCommittedRgbSendResponse (value) {
  const response = requireObject(value, 'committed RGB send response')
  requireExactKeys(
    response,
    ['txid', 'batch_transfer_idx'],
    'committed RGB send response'
  )
  if (!Number.isSafeInteger(response.batch_transfer_idx) || response.batch_transfer_idx < 0) {
    fail(
      'committed RGB send response.batch_transfer_idx',
      'be a non-negative safe integer'
    )
  }
  return Object.freeze({
    txid: requireTxid(response.txid, 'committed RGB send response.txid'),
    batch_transfer_idx: response.batch_transfer_idx
  })
}

export function validateCancelBtcSendPlanResponse (value) {
  const response = requireObject(value, 'cancel BTC send plan response')
  requireExactKeys(response, ['cancelled'], 'cancel BTC send plan response')
  if (response.cancelled !== true) {
    fail('cancel BTC send plan response.cancelled', 'be true')
  }
  return Object.freeze({ cancelled: true })
}

export function validatePendingVanillaTransactions (value) {
  if (!Array.isArray(value) || value.length > 10_000) {
    fail('pending vanilla transactions', 'be a bounded array')
  }
  const transactionIds = new Set()
  return Object.freeze(value.map((entry, index) => {
    const transaction = requireObject(entry, `pending vanilla transactions[${index}]`)
    requireExactKeys(
      transaction,
      ['txid', 'operation_type'],
      `pending vanilla transactions[${index}]`
    )
    if (!['CreateUtxos', 'Drain', 'SendBtc'].includes(transaction.operation_type)) {
      fail(
        `pending vanilla transactions[${index}].operation_type`,
        'be a supported vanilla operation'
      )
    }
    const txid = requireTxid(
      transaction.txid,
      `pending vanilla transactions[${index}].txid`
    )
    if (transactionIds.has(txid)) {
      fail(`pending vanilla transactions[${index}].txid`, 'be unique')
    }
    transactionIds.add(txid)
    return Object.freeze({
      txid,
      operation_type: transaction.operation_type
    })
  }))
}

export function validatePendingRgbSendPlans (value) {
  if (!Array.isArray(value) || value.length > 10_000) {
    fail('pending RGB send plans', 'be a bounded array')
  }
  const planIds = new Set()
  return Object.freeze(value.map((entry, index) => {
    const plan = requireObject(entry, `pending RGB send plans[${index}]`)
    requireExactKeys(
      plan,
      ['plan_id', 'batch_transfer_idx'],
      `pending RGB send plans[${index}]`
    )
    const planId = requireTxid(
      plan.plan_id,
      `pending RGB send plans[${index}].plan_id`
    )
    if (planIds.has(planId)) {
      fail(`pending RGB send plans[${index}].plan_id`, 'be unique')
    }
    planIds.add(planId)
    if (!Number.isSafeInteger(plan.batch_transfer_idx) || plan.batch_transfer_idx < 0) {
      fail(
        `pending RGB send plans[${index}].batch_transfer_idx`,
        'be a non-negative safe integer'
      )
    }
    return Object.freeze({
      plan_id: planId,
      batch_transfer_idx: plan.batch_transfer_idx
    })
  }))
}
