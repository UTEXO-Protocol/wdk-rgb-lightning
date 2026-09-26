// Copyright 2026 UTEXO. Licensed under the Apache License, Version 2.0.
'use strict'

const RPC_FIELDS = ['bitcoind_rpc_username', 'bitcoind_rpc_password', 'bitcoind_rpc_host', 'bitcoind_rpc_port']
const OPTIONAL_STRINGS = ['indexer_url', 'proxy_endpoint', 'announce_alias']
const FIELDS = new Set(['ldk_chain_sync', 'announce_addresses', ...RPC_FIELDS, ...OPTIONAL_STRINGS])

function record (value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`)
  }
}

function text (value, field) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    throw new TypeError(`${field} must be a non-empty string without NUL bytes`)
  }
  return value
}

function backend (mode, value) {
  record(value, 'ldk_chain_sync.config')
  const fields = mode === 'BlockSync' ? RPC_FIELDS : mode === 'TransactionSync' ? ['indexer_url'] : null
  if (!fields) throw new TypeError('Unsupported ldk_chain_sync.mode')
  if (Object.keys(value).some(key => !fields.includes(key))) {
    throw new TypeError('Unsupported ldk_chain_sync.config field')
  }
  const config = {}
  for (const field of fields) {
    if (field === 'bitcoind_rpc_port') {
      if (!Number.isSafeInteger(value[field]) || value[field] < 1 || value[field] > 65535) {
        throw new TypeError('bitcoind_rpc_port must be a valid TCP port')
      }
      config[field] = value[field]
    } else config[field] = text(value[field], field)
  }
  return Object.freeze({ mode, config: Object.freeze(config) })
}

/** Normalize the released external-signer DTO without logging credentials. */
export function normalizeUnlockRequest (value) {
  record(value, 'unlockRequest')
  if (Object.keys(value).some(key => !FIELDS.has(key))) {
    throw new TypeError('Unsupported external-signer unlock field')
  }
  const hasRpc = RPC_FIELDS.some(key => value[key] !== undefined)
  let chainSync
  if (value.ldk_chain_sync !== undefined) {
    if (hasRpc) throw new TypeError('Canonical and legacy LDK backend fields cannot be mixed')
    record(value.ldk_chain_sync, 'ldk_chain_sync')
    if (Object.keys(value.ldk_chain_sync).some(key => key !== 'mode' && key !== 'config')) {
      throw new TypeError('Unsupported ldk_chain_sync field')
    }
    chainSync = backend(value.ldk_chain_sync.mode, value.ldk_chain_sync.config)
  } else if (hasRpc) {
    chainSync = backend('BlockSync', Object.fromEntries(RPC_FIELDS.map(key => [key, value[key]])))
  } else {
    chainSync = backend('TransactionSync', { indexer_url: value.indexer_url })
  }
  const result = { ldk_chain_sync: chainSync }
  for (const field of OPTIONAL_STRINGS) {
    if (value[field] !== undefined) result[field] = text(value[field], field)
  }
  const addresses = value.announce_addresses === undefined ? [] : value.announce_addresses
  if (!Array.isArray(addresses)) throw new TypeError('announce_addresses must be an array')
  result.announce_addresses = Object.freeze(addresses.map(address => text(address, 'announce_addresses')))
  return Object.freeze(result)
}

export function normalizeAutoUnlockRequest (value) {
  return value === undefined ? undefined : normalizeUnlockRequest(value)
}

export function sameUnlockRequest (left, right) {
  // Normalization fixes object key order and copies all nested mutable values.
  return JSON.stringify(left) === JSON.stringify(right)
}
