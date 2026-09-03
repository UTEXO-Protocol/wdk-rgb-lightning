// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
'use strict'

import * as secp256k1 from '@noble/secp256k1'
import {
  crypto_hash_sha256 as cryptoHashSha256,
  sodium_memcmp as sodiumMemcmp
} from 'sodium-universal'
import { toUint64String } from './lsp-utils.js'

const APAY_HASH_LEAF_TAG = utf8Bytes('UTEXO_APAY_HASH_V1')
const APAY_HASH_BATCH_TAG = utf8Bytes('UTEXO_APAY_HASH_BATCH_V1')
const APAY_LIGHTNING_ADDRESS_TAG = utf8Bytes('UTEXO_APAY_LNADDR_V1')
const LIGHTNING_MESSAGE_PREFIX = utf8Bytes('Lightning Signed Message:')
const ZBASE32_ALPHABET = 'ybndrfg8ejkmcpqxot1uwisza345h769'
const ZBASE32_VALUES = new Map([...ZBASE32_ALPHABET].map((char, index) => [char, index]))
const DEFAULT_PROOF_CLOCK_SKEW_SECONDS = 300
const MAX_APAY_BATCH_SIZE = 200
const MAX_APAY_MERKLE_DEPTH = 64

/** No accepted asset has enough spendable liquidity in one usable channel. */
export class LspInsufficientAssetLiquidityError extends Error {
  constructor (required, candidates) {
    super(
      candidates.length > 0
        ? `No accepted asset has ${required} spendable base units; ` +
          candidates.map(({ assetId, localAmount }) => `${assetId}: ${localAmount}`).join(', ')
        : `No accepted asset has a usable channel for ${required} base units`
    )
    this.name = 'LspInsufficientAssetLiquidityError'
    this.required = required
    this.candidates = candidates
  }
}

/** A Lightning Address advertises neither a payout asset nor accepted assets. */
export class LspNoPayableAssetError extends Error {
  constructor (address) {
    super(`${address} advertises no payable asset; its receiver has no usable asset channel with the LSP`)
    this.name = 'LspNoPayableAssetError'
    this.address = address
  }
}

/** A requested ticker or contract ID is absent from the address's asset menu. */
export class LspUnknownPayableAssetError extends Error {
  constructor (requested, accepted) {
    super(
      `"${requested}" is not payable to this address; accepted: ` +
      (accepted.map(describeAsset).join(', ') || 'none')
    )
    this.name = 'LspUnknownPayableAssetError'
    this.requested = requested
    this.accepted = accepted
  }
}

/** More than one asset satisfies an implicit selection policy. */
export class LspAmbiguousPayableAssetError extends Error {
  constructor (candidates, preference) {
    super(
      `${candidates.length} assets match preference "${preference}"; name one of: ` +
      candidates.map(describeAsset).join(', ')
    )
    this.name = 'LspAmbiguousPayableAssetError'
    this.candidates = candidates
    this.preference = preference
  }
}

/** The LSP quote and locally decoded invoices do not describe one atomic relay. */
export class LspQuoteMismatchError extends Error {
  constructor (reason) {
    super(`Refusing the LSP relay quote: ${reason}`)
    this.name = 'LspQuoteMismatchError'
  }
}

/**
 * Split a Lightning Address discovery result into payout, accepted, and
 * convertible representations without inferring relationships from labels.
 *
 * @param {object} discovery
 * @returns {{payoutAsset?:object,accepted:object[],convertible:object[]}}
 */
export function payableAssets (discovery) {
  const payoutAsset = discovery?.payoutAsset
  const accepted = discovery?.acceptedAssets ?? (payoutAsset ? [payoutAsset] : [])
  const convertible = payoutAsset
    ? accepted.filter((asset) => asset.assetId !== payoutAsset.assetId)
    : []
  return Object.freeze({
    ...(payoutAsset === undefined ? {} : { payoutAsset }),
    accepted: Object.freeze([...accepted]),
    convertible: Object.freeze(convertible)
  })
}

/**
 * Choose an explicitly advertised asset. Ambiguous implicit choices fail
 * closed because issuing a quote consumes an APay hash.
 *
 * @param {string} address
 * @param {{payoutAsset?:object,accepted:object[],convertible:object[]}} payable
 * @param {string|undefined} requested
 * @param {'convertible'|'payout'} preference
 * @returns {{asset:object,converted:boolean}}
 */
export function pickPayableAsset (address, payable, requested, preference) {
  const { accepted, convertible, payoutAsset } = payable
  if (accepted.length === 0) throw new LspNoPayableAssetError(address)

  if (preference !== 'convertible' && preference !== 'payout') {
    throw new TypeError('preference must be "convertible" or "payout"')
  }

  const converted = (asset) => Boolean(payoutAsset) && asset.assetId !== payoutAsset.assetId
  if (requested !== undefined) {
    if (
      typeof requested !== 'string' ||
      requested.length === 0 ||
      requested !== requested.trim()
    ) {
      throw new TypeError('requested asset must be a non-empty canonical string')
    }
    const exact = accepted.find((asset) => asset.assetId === requested)
    if (exact) return Object.freeze({ asset: exact, converted: converted(exact) })

    const needle = requested.toLowerCase()
    const tickerMatches = accepted.filter((asset) => (asset.ticker ?? '').toLowerCase() === needle)
    if (tickerMatches.length === 0) throw new LspUnknownPayableAssetError(requested, accepted)
    if (tickerMatches.length > 1) {
      throw new LspAmbiguousPayableAssetError(tickerMatches, requested)
    }
    return Object.freeze({ asset: tickerMatches[0], converted: converted(tickerMatches[0]) })
  }

  if (accepted.length === 1) {
    return Object.freeze({ asset: accepted[0], converted: converted(accepted[0]) })
  }
  if (preference === 'payout' && payoutAsset) {
    return Object.freeze({ asset: payoutAsset, converted: false })
  }
  if (preference === 'convertible') {
    if (convertible.length === 1) {
      return Object.freeze({ asset: convertible[0], converted: true })
    }
    if (convertible.length === 0 && payoutAsset) {
      return Object.freeze({ asset: payoutAsset, converted: false })
    }
  }
  throw new LspAmbiguousPayableAssetError(
    preference === 'payout' ? accepted : convertible,
    preference
  )
}

/**
 * Select an accepted asset that has enough balance in a single usable channel.
 * The payout representation is tried first to minimize conversion trust.
 *
 * @param {object} discovery
 * @param {unknown[]} channels
 * @param {number|bigint|string} required
 * @returns {{assetId:string,asset?:object,converted:boolean,localAssetAmount:number,payoutAsset?:object}}
 */
export function selectLiquidPaymentAsset (discovery, channels, required) {
  const requiredAmount = positiveSafeInteger(required, 'assetAmount')
  const payoutAsset = discovery?.payoutAsset
  const accepted = discovery?.acceptedAssets ?? []
  const ordered = []
  if (payoutAsset) ordered.push(payoutAsset)
  for (const asset of accepted) {
    if (!ordered.some((candidate) => candidate.assetId === asset.assetId)) ordered.push(asset)
  }
  if (ordered.length === 0) {
    throw new LspNoPayableAssetError('Lightning Address')
  }

  const local = largestUsableAssetBalances(channels)
  const candidates = []
  for (const asset of ordered) {
    const localAmount = local.get(asset.assetId) ?? 0
    candidates.push(Object.freeze({ assetId: asset.assetId, localAmount }))
    if (localAmount >= requiredAmount) {
      return Object.freeze({
        assetId: asset.assetId,
        asset,
        converted: Boolean(payoutAsset) && asset.assetId !== payoutAsset.assetId,
        localAssetAmount: localAmount,
        ...(payoutAsset === undefined ? {} : { payoutAsset })
      })
    }
  }
  throw new LspInsufficientAssetLiquidityError(requiredAmount, candidates)
}

/**
 * Pick the funding representation for an external invoice.
 *
 * @param {object} target - Locally decoded target invoice.
 * @param {unknown[]} channels
 * @param {string|undefined} requested
 * @param {object[]} supportedAssets - LSP `/get_info` asset metadata.
 * @returns {string|undefined}
 */
export function resolveRelayFundingAsset (target, channels, requested, supportedAssets) {
  if (requested !== undefined) {
    if (
      typeof requested !== 'string' ||
      requested.length === 0 ||
      requested !== requested.trim()
    ) {
      throw new TypeError('requested funding asset must be a non-empty canonical string')
    }
    const candidate = requested
    const exact = supportedAssets.find((asset) => asset.assetId === candidate)
    if (exact) return exact.assetId

    const needle = candidate.toLowerCase()
    const tickerMatches = supportedAssets.filter((asset) => (asset.ticker ?? '').toLowerCase() === needle)
    if (tickerMatches.length === 0) throw new LspUnknownPayableAssetError(candidate, supportedAssets)
    if (tickerMatches.length > 1) {
      throw new LspAmbiguousPayableAssetError(tickerMatches, candidate)
    }
    return tickerMatches[0].assetId
  }

  const required = target.assetAmount
  if (required === undefined) return undefined
  const balances = largestUsableAssetBalances(channels)
  if (
    target.assetId &&
    supportedAssets.some((asset) => asset.assetId === target.assetId) &&
    (balances.get(target.assetId) ?? 0) >= required
  ) {
    return target.assetId
  }
  // Only the LSP's configured conversion graph can name a counterpart. Picking
  // an arbitrary liquid RGB channel here would turn ticker coincidence into an
  // authorization decision. Omitting the field asks the LSP to resolve one
  // unambiguous configured pair, or reject the quote.
  return undefined
}

/**
 * Normalize the native binding's snake/camel invoice result and validate the
 * fields used to authorize a payment.
 *
 * @param {unknown} value
 * @param {string} context
 * @returns {object}
 */
export function decodedInvoice (value, context) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new LspQuoteMismatchError(`${context} did not decode to an object`)
  }
  const raw = value
  const paymentHash = requiredHash(read(raw, 'paymentHash', 'payment_hash'), `${context} payment hash`)
  const amtMsat = positiveSafeInteger(read(raw, 'amtMsat', 'amt_msat'), `${context} amount`)
  const assetIdRaw = read(raw, 'assetId', 'asset_id')
  const assetAmountRaw = read(raw, 'assetAmount', 'asset_amount')
  const assetId = assetIdRaw === null || assetIdRaw === undefined || assetIdRaw === ''
    ? undefined
    : nonEmptyString(assetIdRaw, `${context} asset id`)
  const assetAmount = assetAmountRaw === null || assetAmountRaw === undefined
    ? undefined
    : positiveSafeInteger(assetAmountRaw, `${context} asset amount`)
  if ((assetId === undefined) !== (assetAmount === undefined)) {
    throw new LspQuoteMismatchError(`${context} carries only one of asset id and asset amount`)
  }
  const payeeRaw = read(raw, 'payeePubkey', 'payee_pubkey')
  const payeePubkey = payeeRaw === null || payeeRaw === undefined || payeeRaw === ''
    ? undefined
    : requiredPublicKey(payeeRaw, `${context} payee`)
  const descriptionHashRaw = read(raw, 'descriptionHash', 'description_hash')
  const descriptionHash = descriptionHashRaw === null || descriptionHashRaw === undefined || descriptionHashRaw === ''
    ? undefined
    : requiredHash(descriptionHashRaw, `${context} description hash`)
  const timestamp = positiveSafeInteger(read(raw, 'timestamp', 'timestamp'), `${context} timestamp`)
  const expirySeconds = positiveSafeInteger(read(raw, 'expirySec', 'expiry_sec'), `${context} expiry`)
  const network = nonEmptyString(read(raw, 'network', 'network'), `${context} network`).toLowerCase()
  if (timestamp > Number.MAX_SAFE_INTEGER - expirySeconds) {
    throw new LspQuoteMismatchError(`${context} expiry exceeds JavaScript's exact integer range`)
  }
  return Object.freeze({
    paymentHash,
    amtMsat,
    ...(assetId === undefined ? {} : { assetId, assetAmount }),
    ...(payeePubkey === undefined ? {} : { payeePubkey }),
    ...(descriptionHash === undefined ? {} : { descriptionHash }),
    timestamp,
    expirySeconds,
    expiresAt: timestamp + expirySeconds,
    network
  })
}

/**
 * Verify the HODL quote against both locally decoded signed invoices.
 *
 * @param {object} target
 * @param {object} hodl
 * @param {object} quote
 * @param {object} policy
 * @returns {void}
 */
export function assertRelayQuote (target, hodl, quote, policy) {
  const maxFeeMsat = nonNegativeSafeInteger(policy.maxFeeMsat, 'maxFeeMsat')
  const nowSeconds = nonNegativeSafeInteger(
    policy.nowSeconds ?? Math.floor(Date.now() / 1000),
    'nowSeconds'
  )
  const quotePaymentHash = requiredHash(quote?.paymentHash, 'quote payment hash')
  const inbound = quoteLeg(quote?.inbound, 'quoted inbound leg')
  const outbound = quoteLeg(quote?.outbound, 'quoted outbound leg')
  const feeMsat = strictNonNegativeSafeInteger(quote?.feeMsat, 'quoted fee')
  const expiresAt = strictPositiveSafeInteger(quote?.expiresAt, 'quoted expiry')
  if (typeof quote?.converted !== 'boolean') {
    throw new LspQuoteMismatchError('the converted flag is missing or malformed')
  }

  assertEqual(hodl.paymentHash, target.paymentHash, 'the funding invoice does not carry the target payment hash')
  assertEqual(quotePaymentHash, target.paymentHash, 'the response payment hash does not match the target invoice')
  assertEqual(hodl.assetId, inbound.assetId, 'the signed funding asset differs from the quoted inbound asset')
  assertEqual(hodl.assetAmount, inbound.assetAmount, 'the signed funding units differ from the quoted inbound units')
  assertEqual(hodl.amtMsat, inbound.amtMsat, 'the signed funding msat differs from the quoted inbound msat')
  assertEqual(target.assetId, outbound.assetId, 'the target asset differs from the quoted outbound asset')
  assertEqual(target.assetAmount, outbound.assetAmount, 'the target units differ from the quoted outbound units')
  assertEqual(target.amtMsat, outbound.amtMsat, 'the target msat differs from the quoted outbound msat')
  assertEqual(hodl.network, target.network, 'the two invoices are for different Bitcoin networks')

  if (outbound.payeePubkey !== undefined) {
    assertEqual(target.payeePubkey, outbound.payeePubkey, 'the target payee differs from the quoted outbound payee')
  }
  if (policy.lspPubkey !== undefined) {
    assertEqual(hodl.payeePubkey, String(policy.lspPubkey).toLowerCase(), 'the funding invoice is not payable to the configured LSP')
  }
  if (target.assetAmount !== hodl.assetAmount) {
    throw new LspQuoteMismatchError(
      `the relay is not 1:1 in base units: ${hodl.assetAmount} in, ${target.assetAmount} out`
    )
  }
  if (feeMsat > maxFeeMsat) {
    throw new LspQuoteMismatchError(`fee ${feeMsat} msat exceeds the ${maxFeeMsat} msat policy`)
  }
  if (inbound.amtMsat - outbound.amtMsat !== feeMsat) {
    throw new LspQuoteMismatchError('the quoted msat legs do not reconcile to fee_msat')
  }
  if (expiresAt <= nowSeconds || target.expiresAt <= nowSeconds || hodl.expiresAt <= nowSeconds) {
    throw new LspQuoteMismatchError('one or more invoices have expired')
  }
  if (expiresAt > target.expiresAt || expiresAt > hodl.expiresAt) {
    throw new LspQuoteMismatchError('the response expiry outlives a signed invoice')
  }
  const actuallyConverted = inbound.assetId !== outbound.assetId
  assertEqual(quote.converted, actuallyConverted, 'the converted flag does not match the asset pair')
}

/** Verify an LNURL quote before it is paid or shown as an external invoice. */
export function assertAddressQuote (decoded, expected) {
  assertEqual(decoded.amtMsat, expected.amtMsat, 'the Lightning Address invoice changed the requested msat amount')
  assertEqual(decoded.assetId, expected.assetId, 'the Lightning Address invoice changed the requested asset')
  assertEqual(decoded.assetAmount, expected.assetAmount, 'the Lightning Address invoice changed the requested asset amount')
  if (expected.lspPubkey !== undefined) {
    assertEqual(decoded.payeePubkey, String(expected.lspPubkey).toLowerCase(), 'the hosted invoice is not payable to the configured LSP')
  }
  if (expected.network !== undefined) {
    assertEqual(
      decoded.network,
      String(expected.network).toLowerCase(),
      'the Lightning Address invoice is for a different Bitcoin network'
    )
  }
  if (expected.paymentHash !== undefined) {
    assertEqual(decoded.paymentHash, String(expected.paymentHash).toLowerCase(), 'the APay proof does not commit to the signed invoice hash')
  }
  if (expected.metadata !== undefined) {
    assertEqual(
      decoded.descriptionHash,
      lnurlMetadataHash(expected.metadata),
      'the Lightning Address invoice does not commit to the discovery metadata'
    )
  }
  if (decoded.expiresAt <= (expected.nowSeconds ?? Math.floor(Date.now() / 1000))) {
    throw new LspQuoteMismatchError('the Lightning Address invoice is already expired')
  }
}

/** SHA-256 of the exact UTF-8 LUD-06 metadata string. */
export function lnurlMetadataHash (metadata) {
  if (typeof metadata !== 'string') {
    throw new LspQuoteMismatchError('the Lightning Address metadata is missing or malformed')
  }
  return bytesHex(sha256(utf8Bytes(metadata)))
}

/**
 * Verify that a requested amount and RGB representation were advertised by a
 * Lightning Address discovery document.
 */
export function assertAddressRequest (discovery, expected) {
  const amount = BigInt(toUint64String(expected.amtMsat, 'amtMsat'))
  const minimum = BigInt(toUint64String(discovery?.minSendable, 'minSendable'))
  const maximum = BigInt(toUint64String(discovery?.maxSendable, 'maxSendable'))
  if (amount < minimum || amount > maximum) {
    throw new LspQuoteMismatchError(
      `the requested amount ${amount} is outside the advertised range [${minimum}, ${maximum}]`
    )
  }

  const hasAssetId = expected.assetId !== undefined
  const hasAssetAmount = expected.assetAmount !== undefined
  if (hasAssetId !== hasAssetAmount) {
    throw new LspQuoteMismatchError('asset id and asset amount must be requested together')
  }
  if (!hasAssetId) return

  const menu = payableAssets(discovery).accepted
  if (!menu.some((asset) => asset.assetId === expected.assetId)) {
    throw new LspUnknownPayableAssetError(expected.assetId, menu)
  }
}

/**
 * Verify the APay inclusion path and recipient Lightning-message signature.
 * The signature binds the complete batch commitment to the recipient node;
 * the Merkle path then binds this invoice payment hash to that batch.
 */
export function verifyApayInvoiceProof (proof, expected = {}) {
  if (expected === null || typeof expected !== 'object' || Array.isArray(expected)) {
    throw new LspQuoteMismatchError('the expected APay proof identity is malformed')
  }
  const checked = validatedApayProof(proof)
  const nowSeconds = nonNegativeSafeInteger(
    expected.nowSeconds ?? Math.floor(Date.now() / 1000),
    'APay verification time'
  )
  const maxClockSkewSeconds = nonNegativeSafeInteger(
    expected.maxClockSkewSeconds ?? DEFAULT_PROOF_CLOCK_SKEW_SECONDS,
    'APay clock skew'
  )
  if (nowSeconds > Number.MAX_SAFE_INTEGER - maxClockSkewSeconds) {
    throw new LspQuoteMismatchError('the APay verification window exceeds JavaScript\'s exact integer range')
  }
  if (checked.createdAt > nowSeconds + maxClockSkewSeconds) {
    throw new LspQuoteMismatchError('the APay proof was created in the future')
  }
  if (checked.expiresAt <= nowSeconds) {
    throw new LspQuoteMismatchError('the APay proof has expired')
  }
  if (checked.expiresAt <= checked.createdAt) {
    throw new LspQuoteMismatchError('the APay proof expiry does not follow its creation time')
  }

  if (expected.paymentHash !== undefined) {
    assertEqual(
      checked.paymentHash,
      requiredHash(expected.paymentHash, 'expected APay payment hash'),
      'the APay proof commits to a different payment hash'
    )
  }
  if (expected.hostPubkey !== undefined) {
    assertEqual(
      checked.hostPubkey,
      requiredPublicKey(expected.hostPubkey, 'expected APay host'),
      'the APay batch targets a different LSP'
    )
  }
  if (expected.recipientPubkey !== undefined) {
    assertEqual(
      checked.recipientPubkey,
      requiredPublicKey(expected.recipientPubkey, 'expected APay recipient'),
      'the APay batch belongs to a different recipient'
    )
  }

  const expectedDepth = Math.ceil(Math.log2(checked.batchSize))
  if (checked.merkleProof.length !== expectedDepth) {
    throw new LspQuoteMismatchError('the APay Merkle path depth does not match its batch size')
  }

  let root = sha256(concatBytes(
    Uint8Array.of(0),
    APAY_HASH_LEAF_TAG,
    hexBytes(checked.recipientPubkey),
    hexBytes(checked.batchId),
    uint64Bytes(checked.hashIndex),
    hexBytes(checked.paymentHash)
  ))
  for (const step of checked.merkleProof) {
    const sibling = hexBytes(step.sibling)
    root = step.side === 'left'
      ? sha256(concatBytes(Uint8Array.of(1), sibling, root))
      : sha256(concatBytes(Uint8Array.of(1), root, sibling))
  }
  if (!sodiumMemcmp(root, hexBytes(checked.batchRoot))) {
    throw new LspQuoteMismatchError('the APay Merkle path does not reach the signed batch root')
  }

  const commitment = concatBytes(
    APAY_HASH_BATCH_TAG,
    hexBytes(checked.recipientPubkey),
    hexBytes(checked.hostPubkey),
    hexBytes(checked.batchId),
    root,
    uint64Bytes(checked.batchSize),
    uint64Bytes(checked.createdAt),
    uint64Bytes(checked.expiresAt)
  )
  if (!verifyLightningMessageSignature(commitment, checked.batchSig, checked.recipientPubkey)) {
    throw new LspQuoteMismatchError('the APay batch signature is invalid')
  }
}

/** Verify the recipient signature binding a node key to a Lightning Address. */
export function verifyApayAddressAttestation (attestation) {
  if (attestation === null || typeof attestation !== 'object' || Array.isArray(attestation)) {
    throw new LspQuoteMismatchError('the APay address attestation is missing or malformed')
  }
  const { recipientPubkey, username, domain, addressSig } = attestation
  const recipient = requiredPublicKey(recipientPubkey, 'APay address recipient')
  const localPart = nonEmptyString(username, 'APay address username')
  const host = nonEmptyString(domain, 'APay address domain')
  const commitment = concatBytes(
    APAY_LIGHTNING_ADDRESS_TAG,
    hexBytes(recipient),
    utf8Bytes(host),
    utf8Bytes(localPart),
    uint64Bytes(0)
  )
  if (!verifyLightningMessageSignature(commitment, addressSig, recipient)) {
    throw new LspQuoteMismatchError('the Lightning Address attestation signature is invalid')
  }
}

function validatedApayProof (proof) {
  if (proof === null || typeof proof !== 'object' || Array.isArray(proof)) {
    throw new LspQuoteMismatchError('the APay proof is missing or malformed')
  }
  const version = strictNonNegativeSafeInteger(proof.version, 'APay proof version')
  if (version !== 1) throw new LspQuoteMismatchError('the APay proof version is unsupported')
  const batchSize = strictPositiveSafeInteger(proof.batchSize, 'APay batch size')
  if (batchSize > MAX_APAY_BATCH_SIZE) {
    throw new LspQuoteMismatchError(`the APay batch size exceeds ${MAX_APAY_BATCH_SIZE}`)
  }
  if (!Array.isArray(proof.merkleProof) || proof.merkleProof.length > MAX_APAY_MERKLE_DEPTH) {
    throw new LspQuoteMismatchError(`the APay Merkle path must contain at most ${MAX_APAY_MERKLE_DEPTH} entries`)
  }
  const merkleProof = proof.merkleProof.map((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new LspQuoteMismatchError(`APay Merkle step ${index} is malformed`)
    }
    if (entry.side !== 'left' && entry.side !== 'right') {
      throw new LspQuoteMismatchError(`APay Merkle step ${index} has an invalid side`)
    }
    return {
      sibling: requiredHash(entry.sibling, `APay Merkle step ${index} sibling`),
      side: entry.side
    }
  })
  return {
    version,
    recipientPubkey: requiredPublicKey(proof.recipientPubkey, 'APay proof recipient'),
    hostPubkey: requiredPublicKey(proof.hostPubkey, 'APay proof host'),
    batchId: requiredHex(proof.batchId, 32, 'APay batch id'),
    hashIndex: strictNonNegativeSafeInteger(proof.hashIndex, 'APay hash index'),
    paymentHash: requiredHash(proof.paymentHash, 'APay payment hash'),
    batchRoot: requiredHash(proof.batchRoot, 'APay batch root'),
    batchSize,
    merkleProof,
    batchSig: nonEmptyString(proof.batchSig, 'APay batch signature'),
    createdAt: strictPositiveSafeInteger(proof.createdAt, 'APay creation time'),
    expiresAt: strictPositiveSafeInteger(proof.expiresAt, 'APay expiry time')
  }
}

/** Verify an LDK/lnd-compatible z-base-32 Lightning message signature. */
export function verifyLightningMessageSignature (message, signature, expectedPublicKey) {
  try {
    const payload = typeof message === 'string' ? utf8Bytes(message) : message
    if (!(payload instanceof Uint8Array)) return false
    const signatureBytes = decodeZbase32(signature)
    if (signatureBytes.length !== 65) return false
    const recovery = signatureBytes[0] - 31
    if (recovery < 0 || recovery > 3) return false
    const digest = sha256(sha256(concatBytes(LIGHTNING_MESSAGE_PREFIX, payload)))
    const recovered = secp256k1.Signature
      .fromBytes(signatureBytes.subarray(1))
      .addRecoveryBit(recovery)
      .recoverPublicKey(digest)
      .toRawBytes(true)
    return sodiumMemcmp(recovered, hexBytes(expectedPublicKey))
  } catch {
    return false
  }
}

function largestUsableAssetBalances (channels) {
  const balances = new Map()
  for (const channel of Array.isArray(channels) ? channels : []) {
    const assetId = read(channel, 'assetId', 'asset_id')
    const usable = read(channel, 'isUsable', 'is_usable') ?? read(channel, 'ready', 'ready')
    if (typeof assetId !== 'string' || assetId.length === 0 || !usable) continue
    const amount = nonNegativeSafeInteger(
      read(channel, 'assetLocalAmount', 'asset_local_amount') ?? 0,
      `channel ${assetId} asset balance`
    )
    if (amount > (balances.get(assetId) ?? 0)) balances.set(assetId, amount)
  }
  return balances
}

function quoteLeg (value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new LspQuoteMismatchError(`${field} is missing or malformed`)
  }
  const assetIdRaw = read(value, 'assetId', 'asset_id')
  const assetAmountRaw = read(value, 'assetAmount', 'asset_amount')
  const assetId = assetIdRaw === undefined || assetIdRaw === null || assetIdRaw === ''
    ? undefined
    : nonEmptyString(assetIdRaw, `${field} asset id`)
  const assetAmount = assetAmountRaw === undefined || assetAmountRaw === null
    ? undefined
    : strictPositiveSafeInteger(assetAmountRaw, `${field} asset amount`)
  if ((assetId === undefined) !== (assetAmount === undefined)) {
    throw new LspQuoteMismatchError(`${field} carries only one of asset id and asset amount`)
  }
  const payeeRaw = read(value, 'payeePubkey', 'payee_pubkey')
  return {
    ...(assetId === undefined ? {} : { assetId, assetAmount }),
    amtMsat: strictPositiveSafeInteger(read(value, 'amtMsat', 'amt_msat'), `${field} amount`),
    ...(payeeRaw === undefined || payeeRaw === null || payeeRaw === ''
      ? {}
      : { payeePubkey: requiredPublicKey(payeeRaw, `${field} payee`) })
  }
}

function read (object, camel, snake) {
  return object?.[camel] ?? object?.[snake]
}

function describeAsset (asset) {
  return asset.ticker ? `${asset.ticker} (${asset.assetId})` : asset.assetId
}

function assertEqual (actual, expected, message) {
  if (actual !== expected) throw new LspQuoteMismatchError(message)
}

function requiredHash (value, field) {
  const hash = nonEmptyString(value, field).toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new LspQuoteMismatchError(`${field} is not 32-byte hexadecimal`)
  return hash
}

function requiredHex (value, length, field) {
  const encoded = nonEmptyString(value, field).toLowerCase()
  if (encoded.length !== length || !/^[0-9a-f]+$/.test(encoded)) {
    throw new LspQuoteMismatchError(`${field} is not ${length / 2}-byte hexadecimal`)
  }
  return encoded
}

function requiredPublicKey (value, field) {
  const key = nonEmptyString(value, field).toLowerCase()
  if (!/^(02|03)[0-9a-f]{64}$/.test(key)) throw new LspQuoteMismatchError(`${field} is not a compressed public key`)
  return key
}

function nonEmptyString (value, field) {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw new LspQuoteMismatchError(`${field} is missing or malformed`)
  }
  return value
}

function nonNegativeSafeInteger (value, field) {
  let parsed
  try {
    parsed = Number(toUint64String(value, field))
  } catch {
    throw new LspQuoteMismatchError(`${field} is not an unsigned integer`)
  }
  if (!Number.isSafeInteger(parsed)) {
    throw new LspQuoteMismatchError(`${field} exceeds JavaScript's exact integer range`)
  }
  return parsed
}

function positiveSafeInteger (value, field) {
  const parsed = nonNegativeSafeInteger(value, field)
  if (parsed === 0) throw new LspQuoteMismatchError(`${field} must be positive`)
  return parsed
}

function strictNonNegativeSafeInteger (value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new LspQuoteMismatchError(`${field} is not a non-negative safe integer`)
  }
  return value
}

function strictPositiveSafeInteger (value, field) {
  const parsed = strictNonNegativeSafeInteger(value, field)
  if (parsed === 0) throw new LspQuoteMismatchError(`${field} must be positive`)
  return parsed
}

function utf8Bytes (value) {
  return new TextEncoder().encode(value)
}

function hexBytes (value) {
  if (typeof value !== 'string' || value.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(value)) {
    throw new Error('invalid hexadecimal input')
  }
  const result = new Uint8Array(value.length / 2)
  for (let index = 0; index < result.length; index += 1) {
    result[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  }
  return result
}

function bytesHex (value) {
  let encoded = ''
  for (const byte of value) encoded += byte.toString(16).padStart(2, '0')
  return encoded
}

function uint64Bytes (value) {
  let remaining = BigInt(toUint64String(value, 'uint64'))
  const result = new Uint8Array(8)
  for (let index = result.length - 1; index >= 0; index -= 1) {
    result[index] = Number(remaining & 0xffn)
    remaining >>= 8n
  }
  return result
}

function concatBytes (...parts) {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.length, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

function sha256 (value) {
  const digest = new Uint8Array(32)
  cryptoHashSha256(digest, value)
  return digest
}

function decodeZbase32 (value) {
  if (
    typeof value !== 'string' ||
    value.length !== 104 ||
    !/^[ybndrfg8ejkmcpqxot1uwisza345h769]+$/.test(value)
  ) {
    throw new Error('invalid z-base-32 Lightning signature')
  }
  const output = []
  let accumulator = 0
  let bits = 0
  for (const char of value) {
    const digit = ZBASE32_VALUES.get(char)
    if (digit === undefined) throw new Error('invalid z-base-32 input')
    accumulator = (accumulator << 5) | digit
    bits += 5
    while (bits >= 8) {
      bits -= 8
      output.push((accumulator >>> bits) & 0xff)
      accumulator &= (1 << bits) - 1
    }
  }
  if (bits !== 0 && accumulator !== 0) throw new Error('non-canonical z-base-32 input')
  return Uint8Array.from(output)
}
