// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
'use strict'

const PAYMENT_HASH = /^[0-9a-f]{64}$/i
const COMPRESSED_PUBLIC_KEY = /^(02|03)[0-9a-f]{64}$/i
const DECIMAL_INTEGER = /^(0|[1-9][0-9]*)$/
const LIGHTNING_SIGNATURE = /^[ybndrfg8ejkmcpqxot1uwisza345h769]{104}$/
const ASSET_SCHEMAS = new Set(['Nia', 'Uda', 'Cfa', 'Ifa'])
const LIGHTNING_SEND_STATUSES = new Set([
  'quoted',
  'claimable',
  'outbound_pending',
  'outbound_paid',
  'outbound_claimed',
  'settled',
  'cancelled',
  'failed'
])

const MAX_ASSET_ID_LENGTH = 512
const MAX_INVOICE_LENGTH = 128 * 1024
const MAX_TEXT_LENGTH = 512
const MAX_ASSETS = 512
const MAX_ROUTES = 64
const MAX_MERKLE_DEPTH = 64
const MAX_APAY_BATCH_SIZE = 200
const MAX_SIGNED_SQLITE_ID = (1n << 63n) - 1n

/** A successful LSP response violated the advertised wire contract. */
export class LspProtocolError extends Error {
  /**
   * @param {string} endpoint
   * @param {string} field
   * @param {string} [expectation]
   */
  constructor (endpoint, field, expectation = 'a valid value') {
    super(`LSP ${endpoint} returned invalid ${field}; expected ${expectation}`)
    this.name = 'LspProtocolError'
    this.endpoint = endpoint
    this.field = field
  }
}

/**
 * Parse a supported RGB asset entry into the SDK's camelCase shape.
 *
 * @param {unknown} value
 * @param {string} [endpoint]
 * @returns {{assetId:string,schema:string,ticker?:string,name:string,precision:number}}
 */
export function parseSupportedAsset (value, endpoint = '/.well-known/lnurlp') {
  const asset = record(value, endpoint, 'asset')
  const assetId = text(asset.asset_id, endpoint, 'asset.asset_id', MAX_ASSET_ID_LENGTH)
  if (/\s/.test(assetId)) invalid(endpoint, 'asset.asset_id', 'a whitespace-free RGB contract id')
  const schema = text(asset.schema, endpoint, 'asset.schema', 16)
  if (!ASSET_SCHEMAS.has(schema)) invalid(endpoint, 'asset.schema', 'Nia, Uda, Cfa, or Ifa')
  const precision = unsignedSafeInteger(asset.precision, endpoint, 'asset.precision', 255)
  const ticker = asset.ticker === undefined
    ? undefined
    : text(asset.ticker, endpoint, 'asset.ticker', 32)
  return Object.freeze({
    assetId,
    schema,
    ...(ticker === undefined ? {} : { ticker }),
    name: text(asset.name, endpoint, 'asset.name', 128),
    precision
  })
}

/**
 * Parse LUD-06 discovery including UTEXO's exact asset menu.
 *
 * @param {unknown} value
 * @param {string} [endpoint]
 * @returns {object}
 */
export function parseLnurlDiscovery (value, endpoint = '/.well-known/lnurlp') {
  const raw = record(value, endpoint, 'response')
  if (raw.status === 'ERROR') {
    invalid(endpoint, 'response', text(raw.reason, endpoint, 'reason', MAX_TEXT_LENGTH))
  }
  if (raw.tag !== 'payRequest') invalid(endpoint, 'tag', 'payRequest')

  const callback = httpUrl(raw.callback, endpoint, 'callback')
  const minSendable = positiveUint64(raw.minSendable, endpoint, 'minSendable')
  const maxSendable = positiveUint64(raw.maxSendable, endpoint, 'maxSendable')
  if (BigInt(minSendable) > BigInt(maxSendable)) {
    invalid(endpoint, 'sendable range', 'minSendable <= maxSendable')
  }

  const payoutAsset = raw.payout_asset === undefined
    ? undefined
    : parseSupportedAsset(raw.payout_asset, endpoint)
  const acceptedAssets = raw.accepted_assets === undefined
    ? undefined
    : uniqueAssets(raw.accepted_assets, endpoint)
  const commentAllowed = raw.commentAllowed === undefined
    ? undefined
    : unsignedSafeInteger(raw.commentAllowed, endpoint, 'commentAllowed', 65_535)

  if (
    payoutAsset &&
    acceptedAssets &&
    !acceptedAssets.some((asset) => sameAssetMetadata(asset, payoutAsset))
  ) {
    invalid(endpoint, 'accepted_assets', 'a list containing the exact payout_asset metadata')
  }

  return Object.freeze({
    callback,
    minSendable,
    maxSendable,
    metadata: text(raw.metadata, endpoint, 'metadata', 64 * 1024),
    tag: 'payRequest',
    ...(commentAllowed === undefined ? {} : { commentAllowed }),
    recipientPubkey: optionalPublicKey(raw.recipient_pubkey, endpoint, 'recipient_pubkey'),
    addressSig: optionalLightningSignature(raw.address_sig, endpoint, 'address_sig'),
    ...(payoutAsset === undefined ? {} : { payoutAsset }),
    ...(acceptedAssets === undefined ? {} : { acceptedAssets })
  })
}

/**
 * Parse an LNURL callback response and its optional APay evidence.
 *
 * @param {unknown} value
 * @param {string} endpoint
 * @returns {object}
 */
export function parseLnurlCallback (value, endpoint) {
  const raw = record(value, endpoint, 'response')
  if (raw.status === 'ERROR') {
    invalid(endpoint, 'response', text(raw.reason, endpoint, 'reason', MAX_TEXT_LENGTH))
  }
  const routes = raw.routes === undefined ? [] : raw.routes
  if (!Array.isArray(routes) || routes.length > MAX_ROUTES) {
    invalid(endpoint, 'routes', `an array with at most ${MAX_ROUTES} entries`)
  }
  return Object.freeze({
    pr: text(raw.pr, endpoint, 'pr', MAX_INVOICE_LENGTH),
    routes: Object.freeze([...routes]),
    status: optionalText(raw.status, endpoint, 'status', 32),
    reason: optionalText(raw.reason, endpoint, 'reason', MAX_TEXT_LENGTH),
    proof: raw.proof === undefined ? undefined : parseApayProof(raw.proof, endpoint)
  })
}

/**
 * @param {unknown} value
 * @returns {{username:string,domain:string,recipientPubkey?:string,addressSig?:string}}
 */
export function parseLightningAddressByPubkey (value) {
  const endpoint = '/lightning_address/by_pubkey'
  const raw = record(value, endpoint, 'response')
  const username = text(raw.username, endpoint, 'username', 64)
  if (!/^[a-z0-9._+-]+$/i.test(username)) invalid(endpoint, 'username', 'a Lightning Address local-part')
  const domain = text(raw.domain, endpoint, 'domain', 253).toLowerCase()
  if (!isCanonicalHost(domain)) invalid(endpoint, 'domain', 'a canonical host name')
  return Object.freeze({
    username,
    domain,
    recipientPubkey: optionalPublicKey(raw.recipient_pubkey, endpoint, 'recipient_pubkey'),
    addressSig: optionalLightningSignature(raw.address_sig, endpoint, 'address_sig')
  })
}

/**
 * @param {unknown} value
 * @returns {{lnInvoice:string,rgbInvoice:string,mappingId:string,rgbAssetId?:string,converted:boolean}}
 */
export function parseLightningReceive (value) {
  const endpoint = '/lightning_receive'
  const raw = record(value, endpoint, 'response')
  return Object.freeze({
    lnInvoice: text(read(raw, 'ln_invoice', 'lnInvoice'), endpoint, 'ln_invoice', MAX_INVOICE_LENGTH),
    rgbInvoice: text(read(raw, 'rgb_invoice', 'rgbInvoice'), endpoint, 'rgb_invoice', MAX_INVOICE_LENGTH),
    mappingId: positiveDecimalId(read(raw, 'mapping_id', 'mappingId'), endpoint, 'mapping_id'),
    rgbAssetId: optionalAssetId(read(raw, 'rgb_asset_id', 'rgbAssetId'), endpoint, 'rgb_asset_id'),
    converted: optionalBoolean(raw.converted, endpoint, 'converted') ?? false
  })
}

/**
 * @param {unknown} value
 * @returns {{lnInvoice:string,rgbInvoice:string,mappingId:string}}
 */
export function parseOnchainSend (value) {
  const endpoint = '/onchain_send'
  const raw = record(value, endpoint, 'response')
  return Object.freeze({
    lnInvoice: text(read(raw, 'ln_invoice', 'lnInvoice'), endpoint, 'ln_invoice', MAX_INVOICE_LENGTH),
    rgbInvoice: text(read(raw, 'rgb_invoice', 'rgbInvoice'), endpoint, 'rgb_invoice', MAX_INVOICE_LENGTH),
    mappingId: positiveDecimalId(read(raw, 'mapping_id', 'mappingId'), endpoint, 'mapping_id')
  })
}

/**
 * @param {unknown} value
 * @returns {object}
 */
export function parseLightningSend (value) {
  const endpoint = '/lightning_send'
  const raw = record(value, endpoint, 'response')
  const inbound = parseLightningSendLeg(raw.inbound, endpoint, 'inbound')
  const outbound = parseLightningSendLeg(raw.outbound, endpoint, 'outbound')
  const converted = optionalBoolean(raw.converted, endpoint, 'converted') ?? false
  const expectedConverted = inbound.assetId !== outbound.assetId
  if (converted !== expectedConverted) {
    invalid(endpoint, 'converted', `${expectedConverted} for the returned asset pair`)
  }
  return Object.freeze({
    lnInvoice: text(raw.ln_invoice, endpoint, 'ln_invoice', MAX_INVOICE_LENGTH),
    paymentHash: paymentHash(raw.payment_hash, endpoint, 'payment_hash'),
    inbound,
    outbound,
    converted,
    feeMsat: unsignedSafeInteger(raw.fee_msat ?? 0, endpoint, 'fee_msat'),
    expiresAt: positiveSafeInteger(raw.expires_at, endpoint, 'expires_at')
  })
}

/**
 * @param {unknown} value
 * @returns {{paymentHash:string,status:string,reason?:string}}
 */
export function parseLightningSendStatus (value) {
  const endpoint = '/lightning_send/{payment_hash}'
  const raw = record(value, endpoint, 'response')
  const status = text(raw.status, endpoint, 'status', 32)
  if (!LIGHTNING_SEND_STATUSES.has(status)) {
    invalid(endpoint, 'status', [...LIGHTNING_SEND_STATUSES].join(', '))
  }
  return Object.freeze({
    paymentHash: paymentHash(raw.payment_hash, endpoint, 'payment_hash'),
    status,
    reason: optionalText(raw.reason, endpoint, 'reason', MAX_TEXT_LENGTH)
  })
}

function parseLightningSendLeg (value, endpoint, field) {
  const raw = record(value, endpoint, field)
  const assetId = optionalAssetId(raw.asset_id, endpoint, `${field}.asset_id`)
  const assetAmount = raw.asset_amount === undefined
    ? undefined
    : positiveSafeInteger(raw.asset_amount, endpoint, `${field}.asset_amount`)
  if ((assetId === undefined) !== (assetAmount === undefined)) {
    invalid(endpoint, field, 'asset_id and asset_amount together, or neither')
  }
  return Object.freeze({
    ...(assetId === undefined ? {} : { assetId, assetAmount }),
    amtMsat: positiveSafeInteger(raw.amt_msat, endpoint, `${field}.amt_msat`),
    payeePubkey: optionalPublicKey(raw.payee_pubkey, endpoint, `${field}.payee_pubkey`)
  })
}

function parseApayProof (value, endpoint) {
  const raw = record(value, endpoint, 'proof')
  const merkle = raw.merkle_proof
  if (!Array.isArray(merkle) || merkle.length > MAX_MERKLE_DEPTH) {
    invalid(endpoint, 'proof.merkle_proof', `an array with at most ${MAX_MERKLE_DEPTH} entries`)
  }
  const version = unsignedSafeInteger(raw.version, endpoint, 'proof.version', 255)
  if (version !== 1) invalid(endpoint, 'proof.version', '1')
  const batchSize = positiveSafeInteger(raw.batch_size, endpoint, 'proof.batch_size')
  if (batchSize > MAX_APAY_BATCH_SIZE) {
    invalid(endpoint, 'proof.batch_size', `no greater than ${MAX_APAY_BATCH_SIZE}`)
  }
  const createdAt = positiveSafeInteger(raw.created_at, endpoint, 'proof.created_at')
  const expiresAt = positiveSafeInteger(raw.expires_at, endpoint, 'proof.expires_at')
  if (expiresAt <= createdAt) {
    invalid(endpoint, 'proof.expires_at', 'later than proof.created_at')
  }
  const expectedDepth = Math.ceil(Math.log2(batchSize))
  if (merkle.length !== expectedDepth) {
    invalid(endpoint, 'proof.merkle_proof', `exactly ${expectedDepth} entries for batch_size ${batchSize}`)
  }
  return Object.freeze({
    version,
    recipientPubkey: publicKey(raw.recipient_pubkey, endpoint, 'proof.recipient_pubkey'),
    hostPubkey: publicKey(raw.host_pubkey, endpoint, 'proof.host_pubkey'),
    batchId: hex(raw.batch_id, endpoint, 'proof.batch_id', 32, 32),
    hashIndex: unsignedSafeInteger(raw.hash_index, endpoint, 'proof.hash_index'),
    paymentHash: paymentHash(raw.payment_hash, endpoint, 'proof.payment_hash'),
    batchRoot: hex(raw.batch_root, endpoint, 'proof.batch_root', 64, 64),
    batchSize,
    merkleProof: Object.freeze(merkle.map((entry, index) => {
      const step = record(entry, endpoint, `proof.merkle_proof[${index}]`)
      const side = text(step.side, endpoint, `proof.merkle_proof[${index}].side`, 8)
      if (side !== 'left' && side !== 'right') {
        invalid(endpoint, `proof.merkle_proof[${index}].side`, 'left or right')
      }
      return Object.freeze({
        sibling: hex(step.sibling, endpoint, `proof.merkle_proof[${index}].sibling`, 64, 64),
        side
      })
    })),
    batchSig: lightningSignature(raw.batch_sig, endpoint, 'proof.batch_sig'),
    createdAt,
    expiresAt
  })
}

function uniqueAssets (value, endpoint) {
  if (!Array.isArray(value) || value.length > MAX_ASSETS) {
    invalid(endpoint, 'accepted_assets', `an array with at most ${MAX_ASSETS} entries`)
  }
  const seen = new Set()
  return Object.freeze(value.map((entry) => {
    const asset = parseSupportedAsset(entry, endpoint)
    if (seen.has(asset.assetId)) invalid(endpoint, 'accepted_assets', 'unique asset ids')
    seen.add(asset.assetId)
    return asset
  }))
}

function record (value, endpoint, field) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    invalid(endpoint, field, 'an object')
  }
  return value
}

function text (value, endpoint, field, max = MAX_TEXT_LENGTH) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > max ||
    value !== value.trim()
  ) {
    invalid(endpoint, field, `a non-empty trimmed string no longer than ${max} characters`)
  }
  return value
}

function optionalText (value, endpoint, field, max) {
  return value === undefined ? undefined : text(value, endpoint, field, max)
}

function optionalAssetId (value, endpoint, field) {
  if (value === undefined || value === null || value === '') return undefined
  const id = text(value, endpoint, field, MAX_ASSET_ID_LENGTH)
  if (/\s/.test(id)) invalid(endpoint, field, 'a whitespace-free RGB contract id')
  return id
}

function publicKey (value, endpoint, field) {
  const key = text(value, endpoint, field, 66).toLowerCase()
  if (!COMPRESSED_PUBLIC_KEY.test(key)) invalid(endpoint, field, 'a compressed secp256k1 public key')
  return key
}

function optionalPublicKey (value, endpoint, field) {
  return value === undefined || value === null || value === ''
    ? undefined
    : publicKey(value, endpoint, field)
}

function paymentHash (value, endpoint, field) {
  const hash = text(value, endpoint, field, 64).toLowerCase()
  if (!PAYMENT_HASH.test(hash)) invalid(endpoint, field, 'a 32-byte hex payment hash')
  return hash
}

function hex (value, endpoint, field, maxLength, exactLength) {
  const encoded = text(value, endpoint, field, maxLength).toLowerCase()
  if (
    encoded.length % 2 !== 0 ||
    !/^[0-9a-f]+$/.test(encoded) ||
    (exactLength !== undefined && encoded.length !== exactLength)
  ) {
    invalid(endpoint, field, 'even-length hexadecimal text')
  }
  return encoded
}

function lightningSignature (value, endpoint, field) {
  const signature = text(value, endpoint, field, 104)
  if (!LIGHTNING_SIGNATURE.test(signature)) {
    invalid(endpoint, field, 'a canonical 65-byte z-base-32 Lightning signature')
  }
  return signature
}

function optionalLightningSignature (value, endpoint, field) {
  return value === undefined || value === null || value === ''
    ? undefined
    : lightningSignature(value, endpoint, field)
}

function unsignedSafeInteger (value, endpoint, field, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    invalid(endpoint, field, `a non-negative safe integer no greater than ${maximum}`)
  }
  return value
}

function positiveSafeInteger (value, endpoint, field) {
  const number = unsignedSafeInteger(value, endpoint, field)
  if (number === 0) invalid(endpoint, field, 'a positive safe integer')
  return number
}

function positiveUint64 (value, endpoint, field) {
  if (
    (typeof value !== 'number' || !Number.isSafeInteger(value)) &&
    (typeof value !== 'string' || !DECIMAL_INTEGER.test(value))
  ) {
    invalid(endpoint, field, 'a positive unsigned 64-bit integer')
  }
  let parsed
  try {
    parsed = BigInt(value)
  } catch {
    invalid(endpoint, field, 'a positive unsigned 64-bit integer')
  }
  if (parsed <= 0n || parsed > ((1n << 64n) - 1n)) {
    invalid(endpoint, field, 'a positive unsigned 64-bit integer')
  }
  return value
}

function optionalBoolean (value, endpoint, field) {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') invalid(endpoint, field, 'a boolean')
  return value
}

function positiveDecimalId (value, endpoint, field) {
  if (typeof value === 'number') {
    const number = positiveSafeInteger(value, endpoint, field)
    return String(number)
  }
  if (typeof value !== 'string' || !DECIMAL_INTEGER.test(value)) {
    invalid(endpoint, field, 'a positive signed 64-bit decimal integer')
  }
  const parsed = BigInt(value)
  if (parsed <= 0n || parsed > MAX_SIGNED_SQLITE_ID) {
    invalid(endpoint, field, 'a positive signed 64-bit decimal integer')
  }
  return value
}

function read (value, snake, camel) {
  return value[snake] ?? value[camel]
}

function httpUrl (value, endpoint, field) {
  const candidate = text(value, endpoint, field, 4096)
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('invalid protocol')
    if (url.username !== '' || url.password !== '') throw new Error('credentials are not allowed')
    if (url.hash !== '') throw new Error('fragments are not allowed')
    return url.toString()
  } catch {
    invalid(endpoint, field, 'an absolute HTTP(S) URL without credentials or a fragment')
  }
}

function sameAssetMetadata (left, right) {
  return left.assetId === right.assetId &&
    left.schema === right.schema &&
    left.ticker === right.ticker &&
    left.name === right.name &&
    left.precision === right.precision
}

function isCanonicalHost (value) {
  try {
    const url = new URL(`https://${value}`)
    return url.username === '' &&
      url.password === '' &&
      url.pathname === '/' &&
      url.search === '' &&
      url.hash === '' &&
      url.host.toLowerCase() === value
  } catch {
    return false
  }
}

function invalid (endpoint, field, expectation) {
  throw new LspProtocolError(endpoint, field, expectation)
}
