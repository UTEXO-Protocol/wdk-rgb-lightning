// Copyright 2026 UTEXO. Licensed under the Apache License, Version 2.0.
import { keccak_256 as keccak256 } from '@noble/hashes/sha3'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils'
import { base64 } from '@scure/base'

export const MAX_BURN_PROOF_BYTES = 10 * 1024 * 1024
const TYPE = 'UtexoBurnDestinationV1(uint64 destinationChainId,uint32 dstEid,bytes recipient)'
const FIELDS = ['version', 'destinationChainId', 'dstEid', 'recipient']

/** Validate the portable V1 preimage; route policy is checked separately. */
export function validateBurnDestination (value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).length !== FIELDS.length ||
      Reflect.ownKeys(value).some(key => typeof key !== 'string' || !FIELDS.includes(key) ||
        !Object.getOwnPropertyDescriptor(value, key)?.enumerable ||
        !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) ||
      value.version !== 1 || !Number.isSafeInteger(value.destinationChainId) || value.destinationChainId <= 0 ||
      !Number.isSafeInteger(value.dstEid) || value.dstEid < 0 || value.dstEid > 0xffffffff ||
      typeof value.recipient !== 'string' || !/^0x(?:[a-f\d]{2}){1,32}$/i.test(value.recipient) ||
      (value.dstEid === 0 && value.recipient.length !== 42)) {
    throw new TypeError('Invalid V1 burn destination')
  }
  return Object.freeze({
    version: 1,
    destinationChainId: value.destinationChainId,
    dstEid: value.dstEid,
    recipient: value.recipient.toLowerCase()
  })
}

/** HashStruct, not an EIP-712 domain/signature digest. Native accepts this hex without 0x. */
export function burnDestinationHash (value) {
  const destination = validateBurnDestination(value)
  const encoded = new Uint8Array(128)
  encoded.set(keccak256(utf8ToBytes(TYPE)))
  const view = new DataView(encoded.buffer)
  view.setBigUint64(56, BigInt(destination.destinationChainId))
  view.setUint32(92, destination.dstEid)
  encoded.set(keccak256(hexToBytes(destination.recipient.slice(2))), 96)
  return bytesToHex(keccak256(encoded))
}

/** Only explicitly qualified EVM routes are implemented. Never infer an endpoint ID. */
export function burnDestinationFor (payout, routes) {
  if (!payout || typeof payout.chainId !== 'string' ||
      !/^eip155:[1-9]\d{0,15}$/.test(payout.chainId) ||
      typeof payout.address !== 'string' || !/^0x[a-f\d]{40}$/i.test(payout.address) ||
      /^0x0{40}$/i.test(payout.address) || !Array.isArray(routes)) {
    throw new TypeError('A supported EVM payout chain and nonzero address are required')
  }
  const matches = routes.filter(route => route?.chainId === payout.chainId)
  if (matches.length !== 1) throw new TypeError('This V1 payout route is not qualified')
  return validateBurnDestination({
    version: 1,
    destinationChainId: Number(payout.chainId.slice(7)),
    dstEid: matches[0].dstEid,
    recipient: payout.address
  })
}

/** A portable export of an already saved proof. Never invokes a wallet or burns. */
export function createBurnPackage (proof, value) {
  const magic = [82, 71, 66, 0, 84, 70, 82]
  if (!(proof instanceof Uint8Array) || proof.length > MAX_BURN_PROOF_BYTES) {
    throw new TypeError('Expected a saved RGB Transfer proof of at most 10 MiB')
  }
  const bytes = proof.slice()
  if (bytes.length <= magic.length || !magic.every((byte, index) => bytes[index] === byte)) {
    throw new TypeError('Expected a saved RGB Transfer proof of at most 10 MiB')
  }
  const destination = validateBurnDestination(value)
  return JSON.stringify({
    format: 'utexo-burn',
    version: 1,
    consignment: { encoding: 'base64', byteLength: bytes.length, data: base64.encode(bytes) },
    burnDestination: destination
  })
}
