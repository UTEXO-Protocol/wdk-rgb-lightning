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
    const node = binding.ensureNode()
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
  /**
   * Creates a read-only RGB Lightning account backed by a query-only adapter.
   *
   * @param {object} reader - The adapter that supplies the account's read
   *   operations.
   * @throws {TypeError} If the adapter is missing or does not implement every
   *   required WDK read method.
   */
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

    /**
     * The query-only adapter used by this account.
     *
     * @protected
     * @type {object}
     */
    this._reader = reader
  }

  /**
   * Returns the account's public signer bootstrap metadata.
   *
   * @returns {Promise<object>} The native bootstrap payload, including the
   *   node ID, account xpubs, and master fingerprint.
   */
  async getBootstrap () { return this._reader.bootstrap() }

  /**
   * Returns the local VSS configuration and backup status.
   *
   * This query does not contact the VSS server.
   *
   * @returns {Promise<{
   *   configured: boolean,
   *   url: string | null,
   *   allowHttp: boolean,
   *   lastBackupVersion: number | null
   * }>} The local VSS status.
   */
  async vssStatus () { return this._reader.vssStatus() }

  /**
   * Returns identity and runtime information for the Lightning node.
   *
   * @returns {Promise<object>} The native node information response.
   */
  async getNodeInfo () { return this._reader.nodeInfo() }

  /**
   * Returns the node's current Bitcoin network and chain information.
   *
   * @returns {Promise<object>} The native network information response.
   */
  async getNetworkInfo () { return this._reader.networkInfo() }

  /**
   * Returns the account's stable current Bitcoin receive address.
   *
   * Address rotation is an explicit full-account operation and is
   * intentionally absent from the read-only account.
   *
   * @returns {Promise<string>} The current receive address.
   * @throws {AccountLockedError} If the RGB Lightning node is locked.
   * @throws {Error} If the node returns an invalid address.
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

  /**
   * Returns the current address or a non-throwing locked state.
   *
   * Errors unrelated to the account's lock state are propagated.
   *
   * @returns {Promise<
   *   {status: 'ready', address: string} |
   *   {status: 'locked', address: null}
   * >} The current address state.
   */
  async getAddressState () {
    try {
      return { status: 'ready', address: await this.getAddress() }
    } catch (error) {
      if (error instanceof AccountLockedError) return { status: 'locked', address: null }
      throw error
    }
  }

  /**
   * Returns all Lightning channels known to the node.
   *
   * @returns {Promise<object>} The native channel-list response.
   */
  async listChannels () { return this._reader.listChannels() }

  /**
   * Resolves a temporary channel ID to its permanent channel ID.
   *
   * @param {string} temporaryChannelIdHex - The temporary channel ID in
   *   hexadecimal form.
   * @returns {Promise<object>} The native channel ID lookup response.
   */
  async getChannelId (temporaryChannelIdHex) {
    return this._reader.getChannelId(temporaryChannelIdHex)
  }

  /**
   * Returns all Lightning peers known to the node.
   *
   * @returns {Promise<object>} The native peer-list response.
   */
  async listPeers () { return this._reader.listPeers() }

  /**
   * Decodes a BOLT11 Lightning invoice without paying it.
   *
   * @param {string} invoice - The BOLT11 invoice to decode.
   * @returns {Promise<object>} The decoded invoice response.
   */
  async decodeInvoice (invoice) { return this._reader.decodeInvoice(invoice) }

  /**
   * Returns the node's current status for a Lightning invoice.
   *
   * @param {string} invoice - The BOLT11 invoice to inspect.
   * @returns {Promise<object>} The native invoice status response.
   */
  async getInvoiceStatus (invoice) { return this._reader.invoiceStatus(invoice) }

  /**
   * Returns the node's Lightning payment history.
   *
   * @returns {Promise<object>} The native payment-list response.
   */
  async listPayments () { return this._reader.listPayments() }

  /**
   * Returns one Lightning payment by hash and payment type.
   *
   * @param {string} paymentHashHex - The payment hash in hexadecimal form.
   * @param {'Outbound' | 'InboundAutoClaim' | 'InboundHodl'} paymentType - The
   *   native payment type.
   * @returns {Promise<object>} The native payment response.
   */
  async getPayment (paymentHashHex, paymentType) {
    return this._reader.getPayment(paymentHashHex, paymentType)
  }

  /**
   * Returns RGB assets, optionally filtered by asset schema.
   *
   * @param {string[]} [filterAssetSchemas] - Asset schema names to include.
   * @returns {Promise<object>} The native asset-list response.
   */
  async listAssets (filterAssetSchemas) {
    return this._reader.listAssets(filterAssetSchemas)
  }

  /**
   * Returns the settled and spendable balances for an RGB asset.
   *
   * @param {string} assetId - The RGB asset ID.
   * @returns {Promise<object>} The native asset balance response.
   */
  async getAssetBalance (assetId) { return this._reader.assetBalance(assetId) }

  /**
   * Returns metadata for an RGB asset.
   *
   * @param {string} assetId - The RGB asset ID.
   * @returns {Promise<object>} The native asset metadata response.
   */
  async getAssetMetadata (assetId) { return this._reader.assetMetadata(assetId) }

  /**
   * Returns transfers associated with one RGB asset.
   *
   * @param {string} assetId - The RGB asset ID.
   * @returns {Promise<object>} The native transfer-list response.
   * @throws {TypeError} If the asset ID is empty or is not a string.
   */
  async listTransfers (assetId) {
    if (typeof assetId !== 'string' || assetId.length === 0) {
      throw new TypeError('listTransfers(assetId) requires a non-empty RGB asset id')
    }
    return this._reader.listTransfers(assetId)
  }

  /**
   * Returns RGB transfers associated with an on-chain transaction ID.
   *
   * @param {string} txid - The Bitcoin transaction ID.
   * @returns {Promise<object>} The native transfer lookup response.
   */
  async listTransfersByTxid (txid) {
    return this._reader.listTransfersByTxid(txid)
  }

  /**
   * Decodes an RGB invoice without creating a transfer.
   *
   * @param {string} invoice - The RGB invoice to decode.
   * @returns {Promise<object>} The decoded RGB invoice response.
   */
  async decodeRgbInvoice (invoice) { return this._reader.decodeRgbInvoice(invoice) }

  /**
   * Returns RGB asset media identified by its content digest.
   *
   * @param {string} digest - The media content digest.
   * @returns {Promise<object>} The native asset media response.
   */
  async getAssetMedia (digest) { return this._reader.getAssetMedia(digest) }

  /**
   * Returns the spendable vanilla Bitcoin balance in satoshis.
   *
   * A locked account reports zero so callers can render its pre-unlock state.
   *
   * @param {boolean} [skipSync=false] - Whether to skip a network sync before
   *   reading the balance.
   * @returns {Promise<bigint>} The spendable balance in satoshis.
   */
  async getBalance (skipSync = false) {
    try {
      const result = await this._reader.btcBalance(Boolean(skipSync))
      return BigInt(result?.vanilla?.spendable ?? result?.vanilla?.settled ?? 0)
    } catch (error) {
      if (isLockedError(error)) return 0n
      throw error
    }
  }

  /**
   * Returns the complete native Bitcoin balance breakdown.
   *
   * @param {boolean} [skipSync=false] - Whether to skip a network sync before
   *   reading the balance.
   * @returns {Promise<object>} The native Bitcoin balance response.
   */
  async getBalanceDetails (skipSync = false) {
    return this._reader.btcBalance(Boolean(skipSync))
  }

  /**
   * Returns the spendable balance for an RGB asset.
   *
   * The settled balance is used when the native response does not expose a
   * separate spendable value.
   *
   * @param {string} assetId - The RGB asset ID.
   * @returns {Promise<bigint>} The asset balance in its base unit.
   */
  async getTokenBalance (assetId) {
    const result = await this.getAssetBalance(assetId)
    return BigInt(result?.spendable ?? result?.settled ?? 0)
  }

  /**
   * Returns the account's on-chain Bitcoin transaction history.
   *
   * @param {boolean} [skipSync=false] - Whether to skip a network sync before
   *   reading transactions.
   * @returns {Promise<object>} The native transaction-list response.
   */
  async getTransactions (skipSync = false) {
    return this._reader.listTransactions(Boolean(skipSync))
  }

  /**
   * Returns on-chain Bitcoin transactions matching a transaction ID.
   *
   * @param {string} txid - The Bitcoin transaction ID.
   * @param {boolean} [skipSync=false] - Whether to skip a network sync before
   *   reading transactions.
   * @returns {Promise<object>} The native transaction lookup response.
   */
  async getTransactionsByTxid (txid, skipSync = false) {
    return this._reader.listTransactionsByTxid(txid, Boolean(skipSync))
  }

  /**
   * Returns the account's unspent Bitcoin outputs.
   *
   * @param {boolean} [skipSync=false] - Whether to skip a network sync before
   *   reading unspent outputs.
   * @returns {Promise<object>} The native unspent-output response.
   */
  async listUnspents (skipSync = false) {
    return this._reader.listUnspents(Boolean(skipSync))
  }

  /**
   * Estimates the Bitcoin fee rate for a confirmation target.
   *
   * @param {number} blocks - The target number of blocks until confirmation.
   * @returns {Promise<object>} The native fee estimate response.
   */
  async estimateFee (blocks) { return this._reader.estimateFee(blocks) }

  /**
   * Verifies a Lightning message signature for this account.
   *
   * @param {string} message - The original message.
   * @param {string} signature - The signature to verify.
   * @returns {Promise<boolean>} Whether the signature is valid.
   * @throws {TypeError} If the message or signature has an invalid type or is
   *   empty where prohibited.
   * @throws {AccountLockedError} If the RGB Lightning node is locked.
   */
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

  /**
   * Checks whether an indexer URL is reachable and compatible with the node.
   *
   * @param {string} indexerUrl - The indexer URL to check.
   * @returns {Promise<object>} The native indexer diagnostic response.
   */
  async checkIndexerUrl (indexerUrl) {
    return this._reader.checkIndexerUrl(indexerUrl)
  }

  /**
   * Checks whether an RGB proxy endpoint is reachable.
   *
   * @param {string} proxyEndpoint - The RGB proxy endpoint to check.
   * @returns {Promise<{ok: true}>} A success result after the native check
   *   completes.
   */
  async checkProxyEndpoint (proxyEndpoint) {
    await this._reader.checkProxyEndpoint(proxyEndpoint)
    return { ok: true }
  }

  /**
   * Classifies a recipient for the generic transfer quote router.
   *
   * @protected
   * @param {string} recipient - A BOLT11 invoice, Lightning node public key,
   *   Bitcoin address, or RGB invoice.
   * @returns {'bolt11' | 'ln-pubkey' | 'btc-address' | 'rgb-invoice'} The
   *   recipient category.
   * @throws {Error} If the recipient is empty or is not a string.
   */
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

  /**
   * Quotes the fee for a generic Lightning, Bitcoin, or RGB transfer.
   *
   * Lightning quotes use a proportional routing allowance. Bitcoin and RGB
   * quotes use the on-chain fee estimator.
   *
   * @param {TransferOptions} options - The transfer options.
   * @returns {Promise<{fee: bigint}>} The estimated fee in millisatoshis for
   *   Lightning recipients or satoshis for on-chain recipients.
   * @throws {Error} If the options or recipient are invalid.
   * @throws {TypeError} If a Lightning amount is not a non-negative integer.
   */
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

  /**
   * Quotes an approximate fee for a standard on-chain Bitcoin transaction.
   *
   * The quote uses a stable 141-vbyte transaction size and either the supplied
   * fee rate or a rate estimated for the requested confirmation target.
   *
   * @param {Transaction} [tx={}] - The transaction and optional fee settings.
   * @returns {Promise<{fee: bigint}>} The estimated fee in satoshis.
   * @throws {TypeError} If the effective fee rate is not a positive finite
   *   number.
   */
  async quoteSendTransaction (tx = {}) {
    const confirmationTarget = tx.confirmationTarget ?? 6
    const feeRate = tx.feeRate ?? await this._defaultFeeRate(confirmationTarget)
    const numericRate = Number(feeRate)
    if (!Number.isFinite(numericRate) || numericRate <= 0) {
      throw new TypeError('quoteSendTransaction feeRate must be a positive number')
    }
    return { fee: BigInt(Math.ceil(numericRate * APPROX_BTC_TX_VBYTES)) }
  }

  /**
   * Returns a terminal receipt from the account's Bitcoin, RGB, or Lightning
   * read models.
   *
   * Pending, unconfirmed, and unknown operations return null.
   *
   * @param {string} hash - A Bitcoin transaction ID, RGB transfer transaction
   *   ID, or Lightning payment hash.
   * @returns {Promise<unknown | null>} The terminal native record, or null when
   *   no terminal record exists.
   * @throws {Error} If the hash is empty or is not a string.
   */
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

  /**
   * Resolves a positive fee rate and falls back to the package default.
   *
   * @protected
   * @param {number} blocks - The target number of blocks until confirmation.
   * @returns {Promise<number>} The fee rate in satoshis per virtual byte.
   */
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
