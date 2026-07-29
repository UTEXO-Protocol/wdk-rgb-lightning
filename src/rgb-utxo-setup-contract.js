const TXID_PATTERN = /^[0-9a-f]{64}$/i
const DECIMAL_PATTERN = /^(0|[1-9]\d*)$/
const UINT8_MAX = 255
const UINT32_MAX = 4_294_967_295

function fail (path, expectation) {
  throw new TypeError(`${path} must ${expectation}`)
}

function requireObject (value, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(path, 'be an object')
  }
  return value
}

function requireExactKeys (value, required, optional, path) {
  const allowed = new Set([...required, ...optional])
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      fail(path, `contain only: ${[...allowed].sort().join(', ')}`)
    }
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      fail(path, `contain ${key}`)
    }
  }
}

function requireBoolean (value, path) {
  if (typeof value !== 'boolean') fail(path, 'be a boolean')
  return value
}

function requirePositiveSafeInteger (value, maximum, path) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    fail(path, `be an integer from 1 through ${maximum}`)
  }
  return value
}

function requireDecimal (value, path) {
  if (typeof value !== 'string' || !DECIMAL_PATTERN.test(value)) {
    fail(path, 'be an unsigned base-10 integer string')
  }
  return value
}

function requireTxid (value, path) {
  if (typeof value !== 'string' || !TXID_PATTERN.test(value)) {
    fail(path, 'be a 32-byte transaction id')
  }
  return value.toLowerCase()
}

export function validateCreateUtxosRequest (value) {
  const request = requireObject(value, 'create UTXOs request')
  requireExactKeys(
    request,
    ['up_to', 'fee_rate', 'skip_sync'],
    ['num', 'size'],
    'create UTXOs request'
  )

  const normalized = {
    up_to: requireBoolean(request.up_to, 'create UTXOs request.up_to'),
    fee_rate: requirePositiveSafeInteger(
      request.fee_rate,
      Number.MAX_SAFE_INTEGER,
      'create UTXOs request.fee_rate'
    ),
    skip_sync: requireBoolean(request.skip_sync, 'create UTXOs request.skip_sync')
  }
  if (request.num !== undefined) {
    normalized.num = requirePositiveSafeInteger(
      request.num,
      UINT8_MAX,
      'create UTXOs request.num'
    )
  }
  if (request.size !== undefined) {
    normalized.size = requirePositiveSafeInteger(
      request.size,
      UINT32_MAX,
      'create UTXOs request.size'
    )
  }
  return Object.freeze(normalized)
}

export function validatePreparedCreateUtxosResponse (value) {
  const response = requireObject(value, 'prepared create UTXOs response')
  requireExactKeys(response, [
    'plan_id',
    'fee_sat',
    'total_input_sat',
    'total_output_sat',
    'size_vbytes',
    'target_count',
    'output_size_sat'
  ], [], 'prepared create UTXOs response')

  const feeSat = requireDecimal(
    response.fee_sat,
    'prepared create UTXOs response.fee_sat'
  )
  const totalInputSat = requireDecimal(
    response.total_input_sat,
    'prepared create UTXOs response.total_input_sat'
  )
  const totalOutputSat = requireDecimal(
    response.total_output_sat,
    'prepared create UTXOs response.total_output_sat'
  )
  const sizeVbytes = requireDecimal(
    response.size_vbytes,
    'prepared create UTXOs response.size_vbytes'
  )
  const fee = BigInt(feeSat)
  const totalInput = BigInt(totalInputSat)
  const totalOutput = BigInt(totalOutputSat)

  if (totalOutput > totalInput) {
    fail('prepared create UTXOs response', 'not spend more than its inputs')
  }
  if (totalInput - totalOutput !== fee) {
    fail(
      'prepared create UTXOs response.fee_sat',
      'equal total_input_sat minus total_output_sat'
    )
  }
  if (BigInt(sizeVbytes) === 0n) {
    fail('prepared create UTXOs response.size_vbytes', 'be greater than zero')
  }

  return Object.freeze({
    plan_id: requireTxid(
      response.plan_id,
      'prepared create UTXOs response.plan_id'
    ),
    fee_sat: feeSat,
    total_input_sat: totalInputSat,
    total_output_sat: totalOutputSat,
    size_vbytes: sizeVbytes,
    target_count: requirePositiveSafeInteger(
      response.target_count,
      UINT8_MAX,
      'prepared create UTXOs response.target_count'
    ),
    output_size_sat: requirePositiveSafeInteger(
      response.output_size_sat,
      UINT32_MAX,
      'prepared create UTXOs response.output_size_sat'
    )
  })
}
