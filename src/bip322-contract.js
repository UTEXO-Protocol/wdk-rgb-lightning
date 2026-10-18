// Copyright 2026 UTEXO. Licensed under the Apache License, Version 2.0.
'use strict'

// Bounds apply to the exact UTF-8 message, before a native signing operation.
export const BIP322_MAX_MESSAGE_BYTES = 4_096
export const BIP322_MAX_SIGNATURE_CHARS = 4_096

export function validateBip322Message (message) {
  if (typeof message !== 'string') throw new TypeError('BIP-322 message must be a string')
  // JS encoders replace lone surrogates with U+FFFD. Reject that ambiguity rather
  // than silently signing bytes different from those supplied by the caller.
  for (let index = 0; index < message.length; index++) {
    const code = message.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = message.charCodeAt(++index)
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError('BIP-322 message contains an unpaired surrogate')
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError('BIP-322 message contains an unpaired surrogate')
    }
  }
  if (Buffer.byteLength(message, 'utf8') > BIP322_MAX_MESSAGE_BYTES) {
    throw new RangeError(`BIP-322 message exceeds ${BIP322_MAX_MESSAGE_BYTES} UTF-8 bytes`)
  }
  return message
}

export function validateBip322Address (address, network) {
  if (typeof address !== 'string' || address.length < 8 || address.length > 90 || /\s/.test(address)) {
    throw new TypeError('BIP-322 requires a Bitcoin address without whitespace or a payment URI')
  }
  const prefix = { mainnet: 'bc1', testnet: 'tb1', testnet4: 'tb1', signet: 'tb1', regtest: 'bcrt1' }[network]
  if (!prefix) throw new TypeError('BIP-322 requires a configured Bitcoin network')
  if (!address.toLowerCase().startsWith(prefix) || !/^[a-zA-Z0-9]+$/.test(address)) {
    throw new TypeError('BIP-322 address does not match the configured Bitcoin network')
  }
  // The native verifier checks the checksum, script type and, for signing,
  // ownership. Prefix validation alone is never treated as address admission.
  return address
}

export function validateBip322Signature (signature, emitted = false) {
  if (typeof signature !== 'string' || signature.length > BIP322_MAX_SIGNATURE_CHARS) {
    throw new TypeError('BIP-322 signature must be a bounded simple signature string')
  }
  const prefixed = signature.startsWith('smp')
  if (emitted && !prefixed) throw new TypeError('BIP-322 signer must emit the smp prefix')
  if (signature.startsWith('ful') || signature.startsWith('pof')) {
    throw new TypeError('Only BIP-322 simple signatures are supported')
  }
  const encoded = prefixed ? signature.slice(3) : signature
  if (!encoded || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded) ||
      Buffer.from(encoded, 'base64').toString('base64') !== encoded) {
    throw new TypeError('BIP-322 signature must contain canonical base64 witness data')
  }
  return signature
}

export function bip322Capabilities (binding, readOnly = false) {
  const reported = binding.getMessageSigningCapabilities?.()
  const verification = reported?.verification === true && typeof binding.verifyMessageBip322 === 'function'
  const signing = !readOnly && verification && reported?.signing === true &&
    typeof binding.getMessageSigningAddress === 'function' && typeof binding.signMessageBip322 === 'function'
  return {
    signing,
    verification,
    protocol: 'bip322-simple',
    specVersion: '2.0.0',
    addressTypes: ['p2tr'],
    verificationAddressTypes: ['p2tr', 'p2wpkh']
  }
}

/** Check the native feature and every real facade method without a node handle. */
export function nativeSupportsBip322 (native) {
  const info = native.getRuntimeInfo?.()
  return typeof native.verifyMessageBip322 === 'function' &&
    Array.isArray(info?.capabilities) && info.capabilities.includes('bip322-simple-v1') &&
    ['getMessageSigningAddress', 'signMessageBip322', 'verifyMessageBip322']
      .every(method => typeof native.SdkNode?.prototype?.[method] === 'function')
}

export function requireBip322 (binding, operation) {
  if (!bip322Capabilities(binding)[operation]) {
    const error = new Error('The installed RGB Lightning native binding does not support BIP-322 simple message signing')
    error.code = 'ERR_BIP322_UNAVAILABLE'
    throw error
  }
}
