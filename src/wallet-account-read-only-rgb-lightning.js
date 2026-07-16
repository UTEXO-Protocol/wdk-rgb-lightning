// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
'use strict'

import { WalletAccountReadOnly } from '@tetherto/wdk-wallet'

import { AccountLockedError } from './errors.js'

/** @typedef {import('@tetherto/wdk-wallet').Transaction} Transaction */
/** @typedef {import('@tetherto/wdk-wallet').TransferOptions} TransferOptions */

/**
 * Kept as a deprecated export so existing imports do not break. Accounts no
 * longer return a synthetic Bitcoin address while locked.
 * @deprecated Catch `AccountLockedError` or call `getAddressState()`.
 */
export const PENDING_ADDRESS = 'tb1qpendingunlock00000000000000000000000000'

const APPROX_BTC_TX_VBYTES = 141
const LN_FEE_BPS = 50n
const BASIS_POINTS = 10_000n
const DEFAULT_FEE_RATE_SAT_PER_VB = 5

const REQUIRED_READER_METHODS = [
  'address',
  'assetBalance',
  'btcBalance',
  'estimateFee',
  'listPayments',
  'listTransactionsByTxid',
  'verifyMessage'
]

function messageOf (error) {
  return error && typeof error === 'object' && 'message' in error
    ? String(error.message)
    : String(error)
}

function isLockedError (error) {
  return /NotInitialized|LockedNode|SdkNode not created|call unlock|node (?:is )?locked|not initialized/i.test(messageOf(error))
}

function asBigInt (value, label) {
  try {
    const result = BigInt(value)
    if (result < 0n) throw new Error(`${label} must not be negative`)
    return result
  } catch (error) {
    if (error instanceof Error && error.message === `${label} must not be negative`) throw error
    throw new TypeError(`${label} must be an integer`)
  }
}

function asArray (value, property) {
  if (Array.isArray(value)) return value
  return Array.isArray(value?.[property]) ? value[property] : []
}

function isPendingPayment (payment) {
  const status = String(payment?.status ?? payment?.htlc_status ?? '').toLowerCase()
  return status === 'pending' || status === 'inflight' || status === 'in_flight' ||
    status === 'claimable' || status === 'claiming'
}

/**
 * Builds an immutable, least-authority adapter over an RLN binding. The
 * returned object contains query methods only; it deliberately omits node
 * lifecycle, signing, broadcasting, channel mutation, VSS recovery, and LSP
 * credentials.
 *
 * @param {import('./binding-interface.js').IRgbLightningBinding} binding
 */
export function createReadOnlyRgbLightningAdapter (binding) {
  if (!binding) throw new TypeError('A RGB Lightning binding is required')

  const callNode = (method, ...args) => {
    const node = binding.node
    if (!node || typeof node[method] !== 'function') {
      throw new Error(
        `The installed RGB Lightning native binding does not expose ${method}(). ` +
        'Install a binding version compatible with this WDK package.'
      )
    }
    return node[method](...args)
  }

  return Object.freeze({
    bootstrap: () => binding.bootstrap(),
    vssStatus: () => binding.vssStatus(),
    nodeInfo: () => callNode('nodeInfo'),
    networkInfo: () => callNode('networkInfo'),
    address: () => callNode('address'),
    listChannels: () => callNode('listChannels'),
    getChannelId: (temporaryChannelIdHex) => callNode('getChannelId', temporaryChannelIdHex),
    listPeers: () => callNode('listPeers'),
    decodeInvoice: (invoice) => callNode('decodeLnInvoice', invoice),
    invoiceStatus: (invoice) => callNode('invoiceStatus', invoice),
    listPayments: () => callNode('listPayments'),
    getPayment: (paymentHashHex, paymentType) => callNode('getPayment', paymentHashHex, paymentType),
    listAssets: (filterAssetSchemas) => callNode('listAssets', filterAssetSchemas),
    assetBalance: (assetId) => callNode('assetBalance', assetId),
    assetMetadata: (assetId) => callNode('assetMetadata', assetId),
    listTransfers: (assetId) => callNode('listTransfers', assetId),
    listTransfersByTxid: (txid) => callNode('listTransfersByTxid', txid),
    decodeRgbInvoice: (invoice) => callNode('decodeRgbInvoice', invoice),
    getAssetMedia: (digest) => callNode('getAssetMedia', digest),
    btcBalance: (skipSync) => callNode('btcBalance', skipSync),
    listTransactions: (skipSync) => callNode('listTransactions', skipSync),
    listTransactionsByTxid: (txid, skipSync) => callNode('listTransactionsByTxid', txid, skipSync),
    listUnspents: (skipSync) => callNode('listUnspents', skipSync),
    estimateFee: (blocks) => callNode('estimateFee', blocks),
    verifyMessage: (message, signature) => callNode('verifyMessage', message, signature),
    checkIndexerUrl: (indexerUrl) => callNode('checkIndexerUrl', indexerUrl),
    checkProxyEndpoint: (proxyEndpoint) => callNode('checkProxyEndpoint', proxyEndpoint)
  })
}

/**
 * Read-only RGB Lightning account for the current WDK account architecture.
 * All methods operate through a least-authority adapter and cannot reach the
 * full account or its mutating binding surface.
 */
export default class WalletAccountReadOnlyRgbLightning extends WalletAccountReadOnly {
  /** @param {object} reader */
  constructor (reader) {
    super()

    if (!reader || typeof reader !== 'object') {
      throw new TypeError('WalletAccountReadOnlyRgbLightning requires a read-only adapter')
    }
    for (const method of REQUIRED_READER_METHODS) {
      if (typeof reader[method] !== 'function') {
        throw new TypeError(`Read-only RGB Lightning adapter is missing ${method}()`)
      }
    }

    /** @protected */
    this._reader = reader
  }

  async getBootstrap () { return this._reader.bootstrap() }

  async vssStatus () { return this._reader.vssStatus() }

  async getNodeInfo () { return this._reader.nodeInfo() }

  async getNetworkInfo () { return this._reader.networkInfo() }

  /**
   * Returns the stable current receive address. Address rotation is an
   * explicit full-account operation and is intentionally absent here.
   */
  async getAddress () {
    let result
    try {
      result = await this._reader.address()
    } catch (error) {
      if (isLockedError(error)) {
        throw new AccountLockedError('Unlock the RGB Lightning account before requesting its receive address.', { cause: error })
      }
      throw error
    }

    const address = typeof result === 'string' ? result : result?.address
    if (typeof address !== 'string' || address.length === 0) {
      throw new Error('RGB Lightning node returned an invalid receive address')
    }
    return address
  }

  async getAddressState () {
    try {
      return { status: 'ready', address: await this.getAddress() }
    } catch (error) {
      if (error instanceof AccountLockedError) return { status: 'locked', address: null }
      throw error
    }
  }

  async listChannels () { return this._reader.listChannels() }

  async getChannelId (temporaryChannelIdHex) {
    return this._reader.getChannelId(temporaryChannelIdHex)
  }

  async listPeers () { return this._reader.listPeers() }

  async decodeInvoice (invoice) { return this._reader.decodeInvoice(invoice) }

  async getInvoiceStatus (invoice) { return this._reader.invoiceStatus(invoice) }

  async listPayments () { return this._reader.listPayments() }

  async getPayment (paymentHashHex, paymentType) {
    return this._reader.getPayment(paymentHashHex, paymentType)
  }

  async listAssets (filterAssetSchemas) {
    return this._reader.listAssets(filterAssetSchemas)
  }

  async getAssetBalance (assetId) { return this._reader.assetBalance(assetId) }

  async getAssetMetadata (assetId) { return this._reader.assetMetadata(assetId) }

  async listTransfers (assetId) {
    if (typeof assetId !== 'string' || assetId.length === 0) {
      throw new TypeError('listTransfers(assetId) requires a non-empty RGB asset id')
    }
    return this._reader.listTransfers(assetId)
  }

  async listTransfersByTxid (txid) {
    return this._reader.listTransfersByTxid(txid)
  }

  async decodeRgbInvoice (invoice) { return this._reader.decodeRgbInvoice(invoice) }

  async getAssetMedia (digest) { return this._reader.getAssetMedia(digest) }

  /** @returns {Promise<bigint>} Spendable vanilla balance in satoshis. */
  async getBalance (skipSync = false) {
    try {
      const result = await this._reader.btcBalance(Boolean(skipSync))
      return BigInt(result?.vanilla?.spendable ?? result?.vanilla?.settled ?? 0)
    } catch (error) {
      if (isLockedError(error)) return 0n
      throw error
    }
  }

  async getBalanceDetails (skipSync = false) {
    return this._reader.btcBalance(Boolean(skipSync))
  }

  async getTokenBalance (assetId) {
    const result = await this.getAssetBalance(assetId)
    return BigInt(result?.spendable ?? result?.settled ?? 0)
  }

  async getTransactions (skipSync = false) {
    return this._reader.listTransactions(Boolean(skipSync))
  }

  async getTransactionsByTxid (txid, skipSync = false) {
    return this._reader.listTransactionsByTxid(txid, Boolean(skipSync))
  }

  async listUnspents (skipSync = false) {
    return this._reader.listUnspents(Boolean(skipSync))
  }

  async estimateFee (blocks) { return this._reader.estimateFee(blocks) }

  async verify (message, signature) {
    if (typeof message !== 'string') throw new TypeError('verify(message, signature) requires a string message')
    if (typeof signature !== 'string' || signature.length === 0) {
      throw new TypeError('verify(message, signature) requires a non-empty signature')
    }
    let result
    try {
      result = await this._reader.verifyMessage(message, signature)
    } catch (error) {
      if (isLockedError(error)) {
        throw new AccountLockedError('Unlock the RGB Lightning account before verifying a message.', { cause: error })
      }
      throw error
    }
    return typeof result === 'boolean' ? result : result?.valid === true
  }

  async checkIndexerUrl (indexerUrl) {
    return this._reader.checkIndexerUrl(indexerUrl)
  }

  async checkProxyEndpoint (proxyEndpoint) {
    await this._reader.checkProxyEndpoint(proxyEndpoint)
    return { ok: true }
  }

  static _classifyRecipient (recipient) {
    if (typeof recipient !== 'string' || recipient.length === 0) {
      throw new Error('transfer: recipient must be a non-empty string')
    }
    const normalized = recipient.trim()
    if (/^ln(bc|tb|bcrt|sb)/i.test(normalized)) return 'bolt11'
    if (/^(rgb:|utxob:)/i.test(normalized)) return 'rgb-invoice'
    if (/^[0-9a-fA-F]{66}$/.test(normalized)) return 'ln-pubkey'
    return 'btc-address'
  }

  async quoteTransfer (options) {
    if (!options || typeof options !== 'object') {
      throw new Error('quoteTransfer: options must be { recipient, amount, token? }')
    }
    const kind = this.constructor._classifyRecipient(options.recipient)
    if (kind === 'bolt11' || kind === 'ln-pubkey') {
      const amount = asBigInt(options.amount ?? 0, 'quoteTransfer amount')
      const proportionalFee = (amount * LN_FEE_BPS + BASIS_POINTS - 1n) / BASIS_POINTS
      return { fee: proportionalFee > 0n ? proportionalFee : 1n }
    }
    return this.quoteSendTransaction({
      to: options.recipient,
      value: options.amount ?? 0,
      feeRate: options.feeRate,
      confirmationTarget: options.confirmationTarget
    })
  }

  async quoteSendTransaction (tx = {}) {
    const confirmationTarget = tx.confirmationTarget ?? 6
    const feeRate = tx.feeRate ?? await this._defaultFeeRate(confirmationTarget)
    const numericRate = Number(feeRate)
    if (!Number.isFinite(numericRate) || numericRate <= 0) {
      throw new TypeError('quoteSendTransaction feeRate must be a positive number')
    }
    return { fee: BigInt(Math.ceil(numericRate * APPROX_BTC_TX_VBYTES)) }
  }

  async getTransactionReceipt (hash) {
    if (typeof hash !== 'string' || hash.length === 0) {
      throw new Error('getTransactionReceipt: hash is required')
    }

    const transactions = asArray(await this.getTransactionsByTxid(hash, false), 'transactions')
    const transaction = transactions.find((item) => item?.txid === hash)
    if (transaction) return transaction.confirmation_time ? transaction : null

    const transfers = asArray(await this.listTransfersByTxid(hash), 'transfers')
    const transfer = transfers.find((item) => item?.txid === hash)
    if (transfer) {
      const status = String(transfer.status ?? '').toLowerCase()
      return status === 'settled' ? transfer : null
    }

    const payments = asArray(await this.listPayments(), 'payments')
    const payment = payments.find((item) => item?.payment_hash === hash)
    return payment && !isPendingPayment(payment) ? payment : null
  }

  async _defaultFeeRate (blocks) {
    try {
      const result = await this.estimateFee(blocks)
      const numericRate = Number(result?.fee_rate ?? result?.feerate ?? result)
      return Number.isFinite(numericRate) && numericRate > 0
        ? numericRate
        : DEFAULT_FEE_RATE_SAT_PER_VB
    } catch (_error) {
      return DEFAULT_FEE_RATE_SAT_PER_VB
    }
  }
}
