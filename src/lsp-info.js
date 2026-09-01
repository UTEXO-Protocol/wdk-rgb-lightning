// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
'use strict'

const COMPRESSED_PUBLIC_KEY = /^(02|03)[0-9a-f]{64}$/i
const DECIMAL_STRING = /^(0|[1-9][0-9]*)$/
const ASSET_SCHEMAS = new Set(['Nia', 'Uda', 'Cfa', 'Ifa'])
const NETWORKS = new Set(['mainnet', 'testnet', 'regtest', 'signet'])
const MAX_INFO_FIELDS = 64
const MAX_SUPPORTED_ASSETS = 512
const MAX_ASSET_FIELDS = 8
const MAX_ASSET_ID_LENGTH = 512
const MAX_TEXT_LENGTH = 128

function invalid (field) {
  throw new TypeError(`LSP /get_info returned an invalid ${field}`)
}

function plainRecord (value, field, maximumFields) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length > maximumFields
  ) {
    return invalid(field)
  }
  return value
}

function boundedText (value, field, maximum = MAX_TEXT_LENGTH) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximum ||
    value !== value.trim()
  ) {
    return invalid(field)
  }
  return value
}

function decimalString (value, field) {
  if (typeof value !== 'string' || !DECIMAL_STRING.test(value)) {
    return invalid(field)
  }
  return value
}

function optionalPeerAddress (info) {
  const hostPresent = info.host !== undefined && info.host !== null && info.host !== ''
  const portPresent = info.port !== undefined && info.port !== null && info.port !== 0
  if (hostPresent !== portPresent) return invalid('peer address')
  if (!hostPresent) return {}

  const host = boundedText(info.host, 'host', 253)
  if (
    /\s|@|\/|\?|#/.test(host) ||
    host.includes('://') ||
    (host.includes(':') && !/^[0-9a-f:]+$/i.test(host))
  ) {
    return invalid('host')
  }
  if (!Number.isSafeInteger(info.port) || info.port < 1 || info.port > 65_535) {
    return invalid('port')
  }
  return { host, port: info.port }
}

function supportedAsset (value) {
  const asset = plainRecord(value, 'supported asset', MAX_ASSET_FIELDS)
  const assetId = boundedText(asset.asset_id, 'supported asset id', MAX_ASSET_ID_LENGTH)
  if (/\s/.test(assetId)) return invalid('supported asset id')
  const schema = boundedText(asset.schema, 'supported asset schema', 16)
  if (!ASSET_SCHEMAS.has(schema)) return invalid('supported asset schema')
  const name = boundedText(asset.name, 'supported asset name')
  const ticker = asset.ticker === undefined
    ? undefined
    : boundedText(asset.ticker, 'supported asset ticker', 16)
  if (
    !Number.isSafeInteger(asset.precision) ||
    asset.precision < 0 ||
    asset.precision > 255
  ) {
    return invalid('supported asset precision')
  }
  return Object.freeze({
    asset_id: assetId,
    schema,
    ...(ticker === undefined ? {} : { ticker }),
    name,
    precision: asset.precision
  })
}

function supportedAssets (value) {
  if (!Array.isArray(value) || value.length > MAX_SUPPORTED_ASSETS) {
    return invalid('supported assets')
  }
  const seen = new Set()
  const assets = value.map((entry) => {
    const asset = supportedAsset(entry)
    if (seen.has(asset.asset_id)) return invalid('supported assets')
    seen.add(asset.asset_id)
    return asset
  })
  return Object.freeze(assets)
}

function orderedRange (info, minimumField, maximumField) {
  const minimum = decimalString(info[minimumField], minimumField)
  const maximum = decimalString(info[maximumField], maximumField)
  if (BigInt(minimum) > BigInt(maximum)) return invalid(`${minimumField}/${maximumField} range`)
  return [minimum, maximum]
}

/**
 * Validate and freeze the v1 public LSP discovery document.
 * Unknown fields are ignored so additive server changes remain compatible.
 *
 * @param {unknown} value
 * @returns {import('../index.js').LspInfo}
 */
export function parseLspInfo (value) {
  const info = plainRecord(value, 'response', MAX_INFO_FIELDS)
  if (info.api_version !== 1) return invalid('api_version')

  const pubkey = boundedText(info.pubkey, 'pubkey', 66).toLowerCase()
  if (!COMPRESSED_PUBLIC_KEY.test(pubkey)) return invalid('pubkey')
  const network = boundedText(info.network, 'network', 16).toLowerCase()
  if (!NETWORKS.has(network)) return invalid('network')
  const peerAddress = optionalPeerAddress(info)
  const assets = supportedAssets(info.supported_assets)
  const [minPaymentSizeMsat, maxPaymentSizeMsat] = orderedRange(
    info,
    'min_payment_size_msat',
    'max_payment_size_msat'
  )
  const [minChannelBalanceSat, maxChannelBalanceSat] = orderedRange(
    info,
    'min_channel_balance_sat',
    'max_channel_balance_sat'
  )
  const [minInitialClientBalanceMsat, maxInitialClientBalanceMsat] = orderedRange(
    info,
    'min_initial_client_balance_msat',
    'max_initial_client_balance_msat'
  )
  const [minChannelAssetAmount, maxChannelAssetAmount] = orderedRange(
    info,
    'min_channel_asset_amount',
    'max_channel_asset_amount'
  )
  const [lightningAddressMinSendableMsat, lightningAddressMaxSendableMsat] = orderedRange(
    info,
    'lightning_address_min_sendable_msat',
    'lightning_address_max_sendable_msat'
  )
  const virtualChannelMode = info.virtual_channel_mode === undefined
    ? undefined
    : boundedText(info.virtual_channel_mode, 'virtual_channel_mode', 64)

  return Object.freeze({
    api_version: 1,
    pubkey,
    network,
    ...peerAddress,
    supported_assets: assets,
    min_payment_size_msat: minPaymentSizeMsat,
    max_payment_size_msat: maxPaymentSizeMsat,
    min_channel_balance_sat: minChannelBalanceSat,
    max_channel_balance_sat: maxChannelBalanceSat,
    min_initial_client_balance_msat: minInitialClientBalanceMsat,
    max_initial_client_balance_msat: maxInitialClientBalanceMsat,
    min_channel_asset_amount: minChannelAssetAmount,
    max_channel_asset_amount: maxChannelAssetAmount,
    ...(virtualChannelMode === undefined ? {} : { virtual_channel_mode: virtualChannelMode }),
    lightning_address_min_sendable_msat: lightningAddressMinSendableMsat,
    lightning_address_max_sendable_msat: lightningAddressMaxSendableMsat
  })
}
