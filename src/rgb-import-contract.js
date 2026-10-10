const TXID_PATTERN = /^[0-9a-f]{64}$/i
const MAX_RGB_IMPORT_BASE64_CHARACTERS = 16 * 1024 * 1024
const MAX_ASSET_ID_CHARACTERS = 512

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

function requirePayload (value, path) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_RGB_IMPORT_BASE64_CHARACTERS
  ) {
    fail(
      path,
      `be a non-empty base64 payload no longer than ${MAX_RGB_IMPORT_BASE64_CHARACTERS} characters`
    )
  }
  return value
}

function requireAssetId (value, path) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_ASSET_ID_CHARACTERS ||
    value.trim() !== value
  ) {
    fail(path, `be a non-empty RGB asset id no longer than ${MAX_ASSET_ID_CHARACTERS} characters`)
  }
  return value
}

function requireTxid (value, path) {
  if (typeof value !== 'string' || !TXID_PATTERN.test(value)) {
    fail(path, 'be a 32-byte transaction id')
  }
  return value.toLowerCase()
}

function validateImportResult (value, expectedAssetId, path) {
  const result = requireObject(value, path)
  requireExactKeys(
    result,
    ['asset_id', 'already_imported', 'metadata'],
    [],
    path
  )
  const assetId = requireAssetId(result.asset_id, `${path}.asset_id`)
  if (expectedAssetId !== undefined && assetId !== expectedAssetId) {
    fail(`${path}.asset_id`, `equal expected_asset_id (${expectedAssetId})`)
  }
  if (typeof result.already_imported !== 'boolean') {
    fail(`${path}.already_imported`, 'be a boolean')
  }
  const metadata = requireObject(result.metadata, `${path}.metadata`)
  return Object.freeze({
    asset_id: assetId,
    already_imported: result.already_imported,
    metadata
  })
}

export function validateImportRgbTransferConsignmentRequest (value) {
  const request = requireObject(value, 'RGB transfer consignment import request')
  requireExactKeys(
    request,
    ['consignment_base64', 'offchain_txid'],
    ['expected_asset_id'],
    'RGB transfer consignment import request'
  )
  const normalized = {
    consignment_base64: requirePayload(
      request.consignment_base64,
      'RGB transfer consignment import request.consignment_base64'
    ),
    offchain_txid: requireTxid(
      request.offchain_txid,
      'RGB transfer consignment import request.offchain_txid'
    )
  }
  if (request.expected_asset_id !== undefined) {
    normalized.expected_asset_id = requireAssetId(
      request.expected_asset_id,
      'RGB transfer consignment import request.expected_asset_id'
    )
  }
  return Object.freeze(normalized)
}

export function validateImportRgbContractRequest (value) {
  const request = requireObject(value, 'RGB contract import request')
  requireExactKeys(
    request,
    ['contract_base64', 'expected_asset_id'],
    [],
    'RGB contract import request'
  )
  return Object.freeze({
    contract_base64: requirePayload(
      request.contract_base64,
      'RGB contract import request.contract_base64'
    ),
    expected_asset_id: requireAssetId(
      request.expected_asset_id,
      'RGB contract import request.expected_asset_id'
    )
  })
}

export function validateImportRgbTransferConsignmentResult (value, expectedAssetId) {
  return validateImportResult(
    value,
    expectedAssetId,
    'RGB transfer consignment import result'
  )
}

export function validateImportRgbContractResult (value, expectedAssetId) {
  return validateImportResult(value, expectedAssetId, 'RGB contract import result')
}
