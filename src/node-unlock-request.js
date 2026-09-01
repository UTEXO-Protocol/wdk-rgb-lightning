// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
'use strict'

const REQUIRED_STRING_FIELDS = Object.freeze([
  'proxy_endpoint',
  'announce_alias'
])
const BITCOIND_STRING_FIELDS = Object.freeze([
  'bitcoind_rpc_username',
  'bitcoind_rpc_password',
  'bitcoind_rpc_host'
])

function nonEmptyString (value) {
  return typeof value === 'string' && value.length > 0
}

/**
 * Validate and defensively copy the request retained for automatic account
 * activation. Error messages identify fields without echoing credential data.
 *
 * @param {unknown} value
 * @returns {object | undefined}
 */
export function normalizeAutoUnlockRequest (value) {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('autoUnlockRequest must be an object')
  }

  for (const field of REQUIRED_STRING_FIELDS) {
    if (!nonEmptyString(value[field])) {
      throw new TypeError(`autoUnlockRequest.${field} must be a non-empty string`)
    }
  }

  const hasIndexer = nonEmptyString(value.indexer_url)
  const hasAnyBitcoindField = BITCOIND_STRING_FIELDS.some((field) => value[field] !== undefined) ||
    value.bitcoind_rpc_port !== undefined

  if (hasIndexer === hasAnyBitcoindField) {
    throw new TypeError(
      'autoUnlockRequest must provide exactly one chain backend: indexer_url or all bitcoind RPC fields'
    )
  }

  if (hasAnyBitcoindField) {
    for (const field of BITCOIND_STRING_FIELDS) {
      if (!nonEmptyString(value[field])) {
        throw new TypeError(`autoUnlockRequest.${field} must be a non-empty string`)
      }
    }
    if (
      !Number.isInteger(value.bitcoind_rpc_port) ||
      value.bitcoind_rpc_port < 1 ||
      value.bitcoind_rpc_port > 65_535
    ) {
      throw new TypeError('autoUnlockRequest.bitcoind_rpc_port must be a valid TCP port')
    }
  }

  if (
    !Array.isArray(value.announce_addresses) ||
    !value.announce_addresses.every((address) => typeof address === 'string' && address.length > 0)
  ) {
    throw new TypeError('autoUnlockRequest.announce_addresses must be an array of non-empty strings')
  }

  const chainBackend = hasIndexer
    ? { indexer_url: value.indexer_url }
    : {
        bitcoind_rpc_username: value.bitcoind_rpc_username,
        bitcoind_rpc_password: value.bitcoind_rpc_password,
        bitcoind_rpc_host: value.bitcoind_rpc_host,
        bitcoind_rpc_port: value.bitcoind_rpc_port
      }

  return Object.freeze({
    ...chainBackend,
    proxy_endpoint: value.proxy_endpoint,
    announce_addresses: Object.freeze([...value.announce_addresses]),
    announce_alias: value.announce_alias
  })
}
