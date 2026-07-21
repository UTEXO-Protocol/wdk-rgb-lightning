// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
'use strict'

export const WALLET_SNAPSHOT_CONTRACT_VERSION = 1
export const WALLET_SNAPSHOT_NATIVE_SOURCE = 'rgb-lightning-node-v0.9.0-beta.3+utexo-wallet-v1'

const NATIVE_LIMITS = Object.freeze({
  assets: 128,
  channels: 512,
  activityItems: 5000
})

export const DEFAULT_WALLET_SNAPSHOT_OPTIONS = Object.freeze({
  mode: 'routine',
  assetIds: Object.freeze([]),
  maxAssets: NATIVE_LIMITS.assets,
  maxChannels: NATIVE_LIMITS.channels,
  maxActivityItems: 1000,
  includeActivity: false
})

const DECIMAL_TEXT = /^(0|[1-9][0-9]*)$/
const HAS_OWN = (value, key) => Object.prototype.hasOwnProperty.call(value, key)

export class WalletSnapshotContractError extends Error {
  constructor (path, expectation) {
    super(`${path} ${expectation}`)
    this.name = 'WalletSnapshotContractError'
    this.path = path
  }
}

function fail (path, expectation) {
  throw new WalletSnapshotContractError(path, expectation)
}

function record (value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(path, 'must be an object')
  }
  return value
}

function exactKeys (value, required, optional, path) {
  const allowed = new Set([...required, ...optional])
  for (const key of required) {
    if (!HAS_OWN(value, key)) fail(`${path}.${key}`, 'is required')
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${path}.${key}`, 'is not part of contract v1')
  }
}

function text (value, path, maxLength) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    fail(path, `must be non-empty text no longer than ${maxLength} characters`)
  }
  return value
}

function nullableText (value, path, maxLength) {
  if (value === null) return null
  return text(value, path, maxLength)
}

function decimal (value, path) {
  if (typeof value !== 'string' || !DECIMAL_TEXT.test(value)) {
    fail(path, 'must be an unsigned base-10 integer string')
  }
  return value
}

function nullableDecimal (value, path) {
  if (value === null) return null
  return decimal(value, path)
}

function boolean (value, path) {
  if (typeof value !== 'boolean') fail(path, 'must be a boolean')
  return value
}

function integer (value, path, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(path, `must be an integer between ${minimum} and ${maximum}`)
  }
  return value
}

function oneOf (value, values, path) {
  if (!values.includes(value)) fail(path, `must be one of: ${values.join(', ')}`)
  return value
}

function array (value, path, maximum) {
  if (!Array.isArray(value) || value.length > maximum) {
    fail(path, `must be an array with at most ${maximum} entries`)
  }
  return value
}

function optionalObjectInput (value) {
  if (value === undefined) return {}
  return record(value, 'options')
}

function inputLimit (value, fallback, maximum, path) {
  if (value === undefined) return fallback
  return integer(value, path, 1, maximum)
}

function uniqueTextArray (value, maximum, path) {
  if (value === undefined) return []
  const rows = array(value, path, maximum)
  const seen = new Set()
  return rows.map((row, index) => {
    const item = text(row, `${path}[${index}]`, 256)
    if (seen.has(item)) fail(`${path}[${index}]`, 'must not duplicate another entry')
    seen.add(item)
    return item
  })
}

export function normalizeWalletSnapshotOptions (value) {
  const input = optionalObjectInput(value)
  exactKeys(
    input,
    [],
    ['mode', 'assetIds', 'maxAssets', 'maxChannels', 'maxActivityItems', 'includeActivity'],
    'options'
  )

  const mode = input.mode === undefined
    ? DEFAULT_WALLET_SNAPSHOT_OPTIONS.mode
    : oneOf(input.mode, ['routine', 'recovery'], 'options.mode')
  const maxAssets = inputLimit(
    input.maxAssets,
    DEFAULT_WALLET_SNAPSHOT_OPTIONS.maxAssets,
    NATIVE_LIMITS.assets,
    'options.maxAssets'
  )
  const maxChannels = inputLimit(
    input.maxChannels,
    DEFAULT_WALLET_SNAPSHOT_OPTIONS.maxChannels,
    NATIVE_LIMITS.channels,
    'options.maxChannels'
  )
  const maxActivityItems = inputLimit(
    input.maxActivityItems,
    DEFAULT_WALLET_SNAPSHOT_OPTIONS.maxActivityItems,
    NATIVE_LIMITS.activityItems,
    'options.maxActivityItems'
  )
  const assetIds = uniqueTextArray(input.assetIds, maxAssets, 'options.assetIds')
  const includeActivity = input.includeActivity === undefined
    ? DEFAULT_WALLET_SNAPSHOT_OPTIONS.includeActivity
    : boolean(input.includeActivity, 'options.includeActivity')

  return Object.freeze({
    mode,
    assetIds: Object.freeze(assetIds),
    maxAssets,
    maxChannels,
    maxActivityItems,
    includeActivity,
    nativeRequest: Object.freeze({
      asset_ids: Object.freeze([...assetIds]),
      max_assets: maxAssets,
      max_channels: maxChannels,
      max_activity_items: maxActivityItems,
      include_activity: includeActivity
    })
  })
}

function syncKeychain (value, path) {
  const item = record(value, path)
  exactKeys(item, ['status'], ['error_code'], path)
  oneOf(item.status, ['succeeded', 'failed'], `${path}.status`)
  if (item.status === 'succeeded' && HAS_OWN(item, 'error_code')) {
    fail(`${path}.error_code`, 'must be omitted after a successful sync')
  }
  if (item.status === 'failed') {
    text(item.error_code, `${path}.error_code`, 128)
  }
}

export function validateWalletSyncResponse (value, expectedMode) {
  const response = record(value, 'sync')
  exactKeys(response, ['contract_version', 'mode', 'vanilla', 'colored'], [], 'sync')
  if (response.contract_version !== WALLET_SNAPSHOT_CONTRACT_VERSION) {
    fail('sync.contract_version', `must equal ${WALLET_SNAPSHOT_CONTRACT_VERSION}`)
  }
  if (response.mode !== expectedMode) fail('sync.mode', `must equal ${expectedMode}`)
  syncKeychain(response.vanilla, 'sync.vanilla')
  syncKeychain(response.colored, 'sync.colored')
  return deepFreeze(response)
}

function network (value, path) {
  const item = record(value, path)
  exactKeys(item, ['network', 'height'], [], path)
  text(item.network, `${path}.network`, 32)
  integer(item.height, `${path}.height`, 0, 0xffffffff)
}

function balance (value, path, includeOffchain) {
  const item = record(value, path)
  const fields = includeOffchain
    ? ['settled', 'future', 'spendable', 'offchain_outbound', 'offchain_inbound']
    : ['settled', 'future', 'spendable']
  exactKeys(item, fields, [], path)
  for (const field of fields) decimal(item[field], `${path}.${field}`)
}

function snapshotNode (value) {
  const path = 'snapshot.node'
  const item = record(value, path)
  const fields = [
    'pubkey',
    'num_channels',
    'num_usable_channels',
    'claimable_onchain_sat',
    'eventual_close_fees_sat',
    'pending_outbound_payments_sat',
    'num_peers',
    'latest_rgs_snapshot_timestamp'
  ]
  exactKeys(item, fields, [], path)
  text(item.pubkey, `${path}.pubkey`, 130)
  for (const field of fields.slice(1, -1)) decimal(item[field], `${path}.${field}`)
  nullableDecimal(item.latest_rgs_snapshot_timestamp, `${path}.latest_rgs_snapshot_timestamp`)
}

function snapshotAsset (value, path) {
  const item = record(value, path)
  exactKeys(item, ['asset_id', 'ticker', 'name', 'precision', 'balance'], [], path)
  text(item.asset_id, `${path}.asset_id`, 256)
  text(item.ticker, `${path}.ticker`, 32)
  text(item.name, `${path}.name`, 256)
  integer(item.precision, `${path}.precision`, 0, 255)
  balance(item.balance, `${path}.balance`, true)
}

function snapshotChannel (value, path) {
  const item = record(value, path)
  const fields = [
    'channel_id', 'peer_pubkey', 'status', 'ready', 'capacity_sat',
    'claimable_onchain_sat', 'outbound_capacity_msat', 'inbound_capacity_msat',
    'next_outbound_htlc_limit_msat', 'next_outbound_htlc_minimum_msat',
    'is_usable', 'public', 'funding_txid', 'peer_alias', 'short_channel_id',
    'asset_id', 'asset_local_amount', 'asset_remote_amount', 'virtual_open_mode'
  ]
  exactKeys(item, fields, [], path)
  text(item.channel_id, `${path}.channel_id`, 128)
  text(item.peer_pubkey, `${path}.peer_pubkey`, 130)
  oneOf(item.status, ['Opening', 'Opened', 'Closing'], `${path}.status`)
  boolean(item.ready, `${path}.ready`)
  for (const field of fields.slice(4, 10)) decimal(item[field], `${path}.${field}`)
  boolean(item.is_usable, `${path}.is_usable`)
  boolean(item.public, `${path}.public`)
  nullableText(item.funding_txid, `${path}.funding_txid`, 128)
  nullableText(item.peer_alias, `${path}.peer_alias`, 256)
  nullableDecimal(item.short_channel_id, `${path}.short_channel_id`)
  nullableText(item.asset_id, `${path}.asset_id`, 256)
  nullableDecimal(item.asset_local_amount, `${path}.asset_local_amount`)
  nullableDecimal(item.asset_remote_amount, `${path}.asset_remote_amount`)
  nullableText(item.virtual_open_mode, `${path}.virtual_open_mode`, 64)
}

function blockTime (value, path) {
  if (value === null) return
  const item = record(value, path)
  exactKeys(item, ['height', 'timestamp'], [], path)
  integer(item.height, `${path}.height`, 0, 0xffffffff)
  decimal(item.timestamp, `${path}.timestamp`)
}

function snapshotTransaction (value, path) {
  const item = record(value, path)
  exactKeys(item, ['transaction_type', 'txid', 'received', 'sent', 'fee', 'confirmation_time'], [], path)
  oneOf(item.transaction_type, ['RgbSend', 'Drain', 'CreateUtxos', 'SendBtc', 'Incoming'], `${path}.transaction_type`)
  text(item.txid, `${path}.txid`, 128)
  decimal(item.received, `${path}.received`)
  decimal(item.sent, `${path}.sent`)
  decimal(item.fee, `${path}.fee`)
  blockTime(item.confirmation_time, `${path}.confirmation_time`)
}

function snapshotPayment (value, path) {
  const item = record(value, path)
  const fields = [
    'amt_msat', 'asset_amount', 'asset_id', 'payment_hash', 'payment_type',
    'status', 'created_at', 'updated_at', 'payee_pubkey'
  ]
  exactKeys(item, fields, [], path)
  nullableDecimal(item.amt_msat, `${path}.amt_msat`)
  nullableDecimal(item.asset_amount, `${path}.asset_amount`)
  nullableText(item.asset_id, `${path}.asset_id`, 256)
  text(item.payment_hash, `${path}.payment_hash`, 128)
  oneOf(item.payment_type, ['Outbound', 'InboundAutoClaim', 'InboundHodl'], `${path}.payment_type`)
  oneOf(item.status, ['Pending', 'Claimable', 'Claiming', 'Succeeded', 'Cancelled', 'Failed'], `${path}.status`)
  decimal(item.created_at, `${path}.created_at`)
  decimal(item.updated_at, `${path}.updated_at`)
  text(item.payee_pubkey, `${path}.payee_pubkey`, 130)
}

function transferEndpoint (value, path) {
  const item = record(value, path)
  exactKeys(item, ['endpoint', 'transport_type', 'used'], [], path)
  text(item.endpoint, `${path}.endpoint`, 4096)
  text(item.transport_type, `${path}.transport_type`, 64)
  boolean(item.used, `${path}.used`)
}

function snapshotTransfer (value, path) {
  const item = record(value, path)
  const fields = [
    'idx', 'created_at', 'updated_at', 'status', 'requested_assignment',
    'assignments', 'kind', 'txid', 'recipient_id', 'receive_utxo',
    'change_utxo', 'expiration', 'transport_endpoints'
  ]
  exactKeys(item, fields, [], path)
  integer(item.idx, `${path}.idx`, 0, 0x7fffffff)
  decimal(item.created_at, `${path}.created_at`)
  decimal(item.updated_at, `${path}.updated_at`)
  text(item.status, `${path}.status`, 64)
  nullableText(item.requested_assignment, `${path}.requested_assignment`, 1024)
  array(item.assignments, `${path}.assignments`, 1024).forEach((entry, index) => {
    text(entry, `${path}.assignments[${index}]`, 1024)
  })
  text(item.kind, `${path}.kind`, 64)
  nullableText(item.txid, `${path}.txid`, 128)
  nullableText(item.recipient_id, `${path}.recipient_id`, 1024)
  nullableText(item.receive_utxo, `${path}.receive_utxo`, 256)
  nullableText(item.change_utxo, `${path}.change_utxo`, 256)
  nullableDecimal(item.expiration, `${path}.expiration`)
  array(item.transport_endpoints, `${path}.transport_endpoints`, 64).forEach((entry, index) => {
    transferEndpoint(entry, `${path}.transport_endpoints[${index}]`)
  })
}

function snapshotTransfers (value, path, options) {
  const item = record(value, path)
  exactKeys(item, ['asset_id', 'transfers'], [], path)
  const assetId = text(item.asset_id, `${path}.asset_id`, 256)
  if (!options.assetIds.includes(assetId)) {
    fail(`${path}.asset_id`, 'must have been requested explicitly')
  }
  array(item.transfers, `${path}.transfers`, options.maxActivityItems)
    .forEach((entry, index) => snapshotTransfer(entry, `${path}.transfers[${index}]`))
}

function assertUnique (rows, key, path) {
  const seen = new Set()
  rows.forEach((row, index) => {
    if (seen.has(row[key])) fail(`${path}[${index}].${key}`, 'must be unique')
    seen.add(row[key])
  })
}

export function validateWalletSnapshotResponse (value, options) {
  const snapshot = record(value, 'snapshot')
  const required = [
    'contract_version', 'native_source', 'capture_sequence', 'started_at_ms',
    'completed_at_ms', 'network_before', 'network_after', 'node', 'btc',
    'assets', 'channels'
  ]
  const optional = ['transactions', 'payments', 'transfers']
  exactKeys(snapshot, required, optional, 'snapshot')
  if (snapshot.contract_version !== WALLET_SNAPSHOT_CONTRACT_VERSION) {
    fail('snapshot.contract_version', `must equal ${WALLET_SNAPSHOT_CONTRACT_VERSION}`)
  }
  if (snapshot.native_source !== WALLET_SNAPSHOT_NATIVE_SOURCE) {
    fail('snapshot.native_source', `must equal ${WALLET_SNAPSHOT_NATIVE_SOURCE}`)
  }
  decimal(snapshot.capture_sequence, 'snapshot.capture_sequence')
  if (BigInt(snapshot.capture_sequence) === 0n) fail('snapshot.capture_sequence', 'must be greater than zero')
  decimal(snapshot.started_at_ms, 'snapshot.started_at_ms')
  decimal(snapshot.completed_at_ms, 'snapshot.completed_at_ms')
  if (BigInt(snapshot.completed_at_ms) < BigInt(snapshot.started_at_ms)) {
    fail('snapshot.completed_at_ms', 'must not precede started_at_ms')
  }
  network(snapshot.network_before, 'snapshot.network_before')
  network(snapshot.network_after, 'snapshot.network_after')
  snapshotNode(snapshot.node)

  const btc = record(snapshot.btc, 'snapshot.btc')
  exactKeys(btc, ['vanilla', 'colored'], [], 'snapshot.btc')
  balance(btc.vanilla, 'snapshot.btc.vanilla', false)
  balance(btc.colored, 'snapshot.btc.colored', false)

  const assets = array(snapshot.assets, 'snapshot.assets', options.maxAssets)
  assets.forEach((entry, index) => snapshotAsset(entry, `snapshot.assets[${index}]`))
  assertUnique(assets, 'asset_id', 'snapshot.assets')

  const channels = array(snapshot.channels, 'snapshot.channels', options.maxChannels)
  channels.forEach((entry, index) => snapshotChannel(entry, `snapshot.channels[${index}]`))
  assertUnique(channels, 'channel_id', 'snapshot.channels')

  if (options.includeActivity) {
    for (const field of optional) {
      if (!HAS_OWN(snapshot, field)) fail(`snapshot.${field}`, 'is required when includeActivity is true')
    }
    array(snapshot.transactions, 'snapshot.transactions', options.maxActivityItems)
      .forEach((entry, index) => snapshotTransaction(entry, `snapshot.transactions[${index}]`))
    array(snapshot.payments, 'snapshot.payments', options.maxActivityItems)
      .forEach((entry, index) => snapshotPayment(entry, `snapshot.payments[${index}]`))
    const transfers = array(snapshot.transfers, 'snapshot.transfers', options.maxAssets)
    transfers.forEach((entry, index) => snapshotTransfers(entry, `snapshot.transfers[${index}]`, options))
    assertUnique(transfers, 'asset_id', 'snapshot.transfers')
  } else {
    for (const field of optional) {
      if (HAS_OWN(snapshot, field)) fail(`snapshot.${field}`, 'must be omitted when includeActivity is false')
    }
  }

  return deepFreeze(snapshot)
}

export function isCoherentWalletSnapshot (snapshot) {
  return snapshot.network_before.network === snapshot.network_after.network &&
    snapshot.network_before.height === snapshot.network_after.height
}

export function walletSnapshotRequestKey (options) {
  return JSON.stringify([options.mode, options.nativeRequest])
}

function deepFreeze (value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}
