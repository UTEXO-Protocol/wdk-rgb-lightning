const TXID_PATTERN = /^[0-9a-f]{64}$/i
const OUTPOINT_PATTERN = /^([0-9a-f]{64}):(\d+)$/i
const DECIMAL_PATTERN = /^(0|[1-9]\d*)$/
const UINT8_MAX = 255
const UINT32_MAX = 4_294_967_295
const MAX_UNSPENTS = 10_000
const MAX_ALLOCATIONS_PER_UNSPENT = 255
const MAX_ASSET_ID_LENGTH = 512
const MAX_ASSIGNMENT_LENGTH = 512

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

function requireNonNegativeSafeInteger (value, maximum, path) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    fail(path, `be an integer from 0 through ${maximum}`)
  }
  return value
}

function requirePositiveSafeInteger (value, maximum, path) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    fail(path, `be an integer from 1 through ${maximum}`)
  }
  return value
}

function requireBoundedString (value, maximumLength, path, nullable = false) {
  if (nullable && value === null) return null
  if (typeof value !== 'string' || value.length === 0 || value.length > maximumLength) {
    fail(path, `be a non-empty string no longer than ${maximumLength} characters`)
  }
  return value
}

function requireOutpoint (value, path) {
  if (typeof value !== 'string') fail(path, 'be a Bitcoin outpoint')
  const match = OUTPOINT_PATTERN.exec(value)
  if (!match) fail(path, 'be a Bitcoin outpoint')
  const vout = Number(match[2])
  if (!Number.isSafeInteger(vout) || vout > UINT32_MAX) {
    fail(path, `contain an output index from 0 through ${UINT32_MAX}`)
  }
  return `${match[1].toLowerCase()}:${vout}`
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

export function validateRgbUnspents (value) {
  if (!Array.isArray(value) || value.length > MAX_UNSPENTS) {
    fail('RGB unspents', `be an array with at most ${MAX_UNSPENTS} entries`)
  }

  const unspents = value.map((entry, index) => {
    const path = `RGB unspents[${index}]`
    const unspent = requireObject(entry, path)
    requireExactKeys(
      unspent,
      ['utxo', 'rgb_allocations', 'pending_blinded'],
      [],
      path
    )

    const utxoPath = `${path}.utxo`
    const utxo = requireObject(unspent.utxo, utxoPath)
    requireExactKeys(
      utxo,
      ['outpoint', 'btc_amount', 'colorable'],
      [],
      utxoPath
    )

    const allocationsPath = `${path}.rgb_allocations`
    if (
      !Array.isArray(unspent.rgb_allocations) ||
      unspent.rgb_allocations.length > MAX_ALLOCATIONS_PER_UNSPENT
    ) {
      fail(
        allocationsPath,
        `be an array with at most ${MAX_ALLOCATIONS_PER_UNSPENT} entries`
      )
    }

    const rgbAllocations = unspent.rgb_allocations.map((entry, allocationIndex) => {
      const allocationPath = `${allocationsPath}[${allocationIndex}]`
      const allocation = requireObject(entry, allocationPath)
      requireExactKeys(
        allocation,
        ['asset_id', 'assignment', 'settled'],
        [],
        allocationPath
      )
      return Object.freeze({
        asset_id: requireBoundedString(
          allocation.asset_id,
          MAX_ASSET_ID_LENGTH,
          `${allocationPath}.asset_id`,
          true
        ),
        assignment: requireBoundedString(
          allocation.assignment,
          MAX_ASSIGNMENT_LENGTH,
          `${allocationPath}.assignment`
        ),
        settled: requireBoolean(
          allocation.settled,
          `${allocationPath}.settled`
        )
      })
    })

    return Object.freeze({
      utxo: Object.freeze({
        outpoint: requireOutpoint(utxo.outpoint, `${utxoPath}.outpoint`),
        btc_amount: requireNonNegativeSafeInteger(
          utxo.btc_amount,
          Number.MAX_SAFE_INTEGER,
          `${utxoPath}.btc_amount`
        ),
        colorable: requireBoolean(utxo.colorable, `${utxoPath}.colorable`)
      }),
      rgb_allocations: Object.freeze(rgbAllocations),
      pending_blinded: requireNonNegativeSafeInteger(
        unspent.pending_blinded,
        UINT32_MAX,
        `${path}.pending_blinded`
      )
    })
  })

  return Object.freeze(unspents)
}
