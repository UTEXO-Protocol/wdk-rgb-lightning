// Copyright 2026 UTEXO. Licensed under the Apache License, Version 2.0.

export const WEBRGB_READ_METHODS = Object.freeze([
  'enable', 'getInfo', 'getAddress', 'blindReceive', 'listAssets',
  'getAssetBalance', 'listTransfers', 'getTransferStatus', 'decodeRgbInvoice'
])

export class WebRgbError extends Error {
  constructor (code, message) {
    super(message)
    this.name = 'WebRgbError'
    this.code = code
  }

  toJSON () { return { name: this.name, code: this.code, message: this.message } }
}

function integer (value, name, min = 1, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new WebRgbError('INVALID_PARAMS', `${name} must be an integer between ${min} and ${max}`)
  }
  return value
}

function assetId (value, required = false) {
  if (value === undefined && !required) return undefined
  if (typeof value !== 'string' || !/^rgb:[^\s\0]+$/.test(value) || value.length > 256) {
    throw new WebRgbError('INVALID_PARAMS', 'Invalid assetId')
  }
  return value
}

function object (value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WebRgbError('INVALID_PARAMS', 'Expected an object')
  }
  return value
}

function nativeInteger (value, name) {
  // C-FFI emits exact decimal strings above MAX_SAFE_INTEGER. WebRGB uses
  // numbers, so reject values it cannot represent instead of rounding them.
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    if (value.length > 16 || BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new WebRgbError('INTERNAL_ERROR', `${name} exceeds the WebRGB exact integer range`)
    }
    value = Number(value)
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new WebRgbError('INTERNAL_ERROR', `Invalid native ${name}`)
  }
  return value
}

function nativeText (value, name) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new WebRgbError('INTERNAL_ERROR', `Invalid native ${name}`)
  }
  return value
}

function optionalText (value, name) {
  return value == null ? undefined : nativeText(value, name)
}

function transferAmount (assignments) {
  if (!Array.isArray(assignments)) throw new WebRgbError('INTERNAL_ERROR', 'Invalid native assignments')
  let sum
  for (const assignment of assignments) {
    const match = typeof assignment === 'string' && /^Fungible\((\d+)\)$/.exec(assignment)
    if (match) {
      sum = (sum ?? 0) + nativeInteger(match[1], 'transfer amount')
      nativeInteger(sum, 'transfer amount')
    } else if (typeof assignment !== 'string' || !/^(Any|NonFungible|ReplaceRight|InflationRight\(\d+\))$/.test(assignment)) {
      throw new WebRgbError('INTERNAL_ERROR', 'Invalid native assignment')
    }
  }
  return sum
}

/** One native-wallet session per dApp. No browser injection or transport. */
export class WebRgbProvider {
  #wallet
  #origin
  #confirm
  #assertAuthorized
  #authorized
  #revision = 0
  #enabling
  #floor
  #network

  constructor (wallet, options) {
    object(options)
    let origin
    try {
      const url = new URL(options.origin)
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
          url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid origin')
      origin = url.origin
    } catch (_) {
      throw new WebRgbError('INVALID_PARAMS', 'A valid HTTP(S) session origin is required')
    }
    if (typeof options.confirm !== 'function' ||
        (options.assertAuthorized !== undefined && typeof options.assertAuthorized !== 'function') ||
        (options.sessionApproved !== undefined && typeof options.sessionApproved !== 'boolean')) {
      throw new WebRgbError('INVALID_PARAMS', 'Invalid session authorization options')
    }
    for (const method of ['getNetwork', 'isDisposed', 'getAddress', 'createRgbInvoice', 'listAssets',
      'getAssetBalance', 'listTransfers', 'refreshTransfers', 'decodeRgbInvoice']) {
      if (typeof wallet?.[method] !== 'function') {
        throw new WebRgbError('INVALID_PARAMS', `Wallet must expose ${method}()`)
      }
    }
    this.#network = wallet.getNetwork()
    if (!['mainnet', 'testnet', 'testnet4', 'signet', 'regtest'].includes(this.#network)) {
      throw new WebRgbError('INVALID_PARAMS', 'Wallet network is required')
    }
    this.#wallet = wallet
    this.#origin = origin
    this.#confirm = options.confirm
    this.#assertAuthorized = options.assertAuthorized
    this.#authorized = options.sessionApproved === true
    this.#floor = Math.max(3, integer(options.minConfirmations === undefined ? 3 : options.minConfirmations, 'minConfirmations', 0, 255))
  }

  get enabled () {
    return this.#transportAuthorized() && this.#authorized && !this.#wallet.isDisposed() && this.#wallet.getNetwork() === this.#network
  }

  #transportAuthorized () {
    try {
      const result = this.#assertAuthorized?.()
      // An accidentally async assertion must not authorize a request before
      // its rejection. The contract is synchronous void-or-throw.
      if (result && typeof result.then === 'function') Promise.resolve(result).catch(() => {})
      return result === undefined
    } catch (_) { return false }
  }

  revoke () {
    this.#authorized = false
    this.#revision += 1
  }

  #check (revision = this.#revision) {
    if (!this.enabled || revision !== this.#revision) {
      throw new WebRgbError('NOT_ENABLED', 'Session is no longer active')
    }
  }

  async #confirmRequest (method, params) {
    try {
      if (await this.#confirm(Object.freeze({ origin: this.#origin, method, params: Object.freeze(params) })) === true) return
    } catch (_) {
      throw new WebRgbError('USER_REJECTED', 'Approval did not complete')
    }
    throw new WebRgbError('USER_REJECTED', 'Request declined')
  }

  async enable () {
    if (this.enabled) return
    if (this.#enabling) return this.#enabling
    const revision = this.#revision
    this.#enabling = Promise.resolve().then(async () => {
      await this.#confirmRequest('enable', {})
      if (!this.#transportAuthorized()) {
        throw new WebRgbError('NOT_ENABLED', 'Transport session is no longer active')
      }
      if (revision !== this.#revision || this.#wallet.isDisposed() || this.#wallet.getNetwork() !== this.#network) {
        throw new WebRgbError('NOT_ENABLED', 'Session is no longer active')
      }
      this.#authorized = true
    })
    try { await this.#enabling } finally { this.#enabling = undefined }
  }

  async #call (revision, operation) {
    this.#check(revision)
    try {
      const result = await operation()
      this.#check(revision)
      return result
    } catch (error) {
      this.#check(revision)
      if (error instanceof WebRgbError) throw error
      const message = String(error?.message ?? '')
      if (/^Rln\(NotFound\): Unknown RGB contract ID$/.test(message)) {
        throw new WebRgbError('ASSET_NOT_FOUND', 'Asset is not known to this wallet')
      }
      if (/^Rln\(InvalidRequest\):|^Error parsing string:/.test(message)) {
        throw new WebRgbError('INVALID_PARAMS', 'Invalid wallet request')
      }
      if (/^Rln\(UnsupportedInExternalSignerMode\):/.test(message)) {
        throw new WebRgbError('METHOD_NOT_SUPPORTED', 'Operation is unavailable with this signer')
      }
      // Native errors can contain local paths, endpoints and credentials.
      throw new WebRgbError('INTERNAL_ERROR', 'Wallet operation failed')
    }
  }

  async getInfo () {
    this.#check()
    return { ready: true, network: this.#network, protocol: 'RGB_LN', methods: [...WEBRGB_READ_METHODS] }
  }

  async getAddress () {
    const revision = this.#revision
    const address = await this.#call(revision, () => this.#wallet.getAddress())
    this.#check(revision)
    return { address: nativeText(address, 'address') }
  }

  async blindReceive (args = {}) {
    const revision = this.#revision
    this.#check(revision)
    const raw = object(args)
    const params = {
      assetId: assetId(raw.assetId),
      amount: raw.amount === undefined ? undefined : integer(raw.amount, 'amount'),
      durationSeconds: integer(raw.durationSeconds === undefined ? 3600 : raw.durationSeconds, 'durationSeconds', 1, 2592000),
      minConfirmations: Math.max(this.#floor, integer(raw.minConfirmations === undefined ? this.#floor : raw.minConfirmations, 'minConfirmations', 0, 255))
    }
    await this.#confirmRequest('blindReceive', { ...params })
    const result = await this.#call(revision, () => this.#wallet.createRgbInvoice({
      ...(params.assetId === undefined ? {} : { asset_id: params.assetId }),
      assignment_kind: params.amount === undefined ? 'Any' : 'Fungible',
      ...(params.amount === undefined ? {} : { assignment_amount: params.amount }),
      duration_seconds: params.durationSeconds,
      min_confirmations: params.minConfirmations,
      witness: false
    }))
    this.#check(revision)
    return {
      invoice: nativeText(result?.invoice, 'invoice'),
      recipientId: nativeText(result?.recipient_id, 'recipient ID'),
      expirationTimestamp: result.expiration_timestamp == null ? undefined : nativeInteger(result.expiration_timestamp, 'expiration timestamp'),
      minConfirmations: params.minConfirmations
    }
  }

  async #assets (revision) {
    const groups = await this.#call(revision, () => this.#wallet.listAssets())
    if (!groups || typeof groups !== 'object' || Array.isArray(groups)) {
      throw new WebRgbError('INTERNAL_ERROR', 'Invalid native asset list')
    }
    this.#check(revision)
    return ['nia', 'uda', 'cfa', 'ifa', 'bfa'].flatMap(schema => {
      const group = groups[schema]
      if (group == null) return []
      if (!Array.isArray(group)) throw new WebRgbError('INTERNAL_ERROR', 'Invalid native asset group')
      return group.map(asset => ({
        id: nativeText(asset?.asset_id, 'asset ID'),
        schema,
        ticker: optionalText(asset.ticker, 'ticker'),
        name: nativeText(asset.name, 'asset name'),
        precision: nativeInteger(asset.precision, 'asset precision')
      }))
    })
  }

  async listAssets () { return this.#assets(this.#revision) }

  async getAssetBalance (id) {
    const revision = this.#revision
    this.#check(revision)
    assetId(id, true)
    const raw = await this.#call(revision, () => this.#wallet.getAssetBalance(id))
    this.#check(revision)
    return { assetId: id, balance: nativeInteger(raw?.spendable, 'asset balance'), raw }
  }

  async #transfers (revision, id, txid) {
    const ids = id === undefined && txid === undefined ? (await this.#assets(revision)).map(asset => asset.id) : [id]
    const result = []
    for (const asset of new Set(ids)) {
      const transfers = await this.#call(revision, () => txid === undefined
        ? this.#wallet.listTransfers(asset)
        : this.#wallet.listTransfers(asset, txid))
      if (!Array.isArray(transfers)) throw new WebRgbError('INTERNAL_ERROR', 'Invalid native transfer list')
      for (const transfer of transfers) {
        result.push({
          assetId: asset,
          transferId: nativeInteger(transfer?.idx, 'transfer ID'),
          status: nativeText(transfer.status, 'transfer status'),
          kind: nativeText(transfer.kind, 'transfer kind'),
          amount: transferAmount(transfer.assignments),
          recipientId: optionalText(transfer.recipient_id, 'recipient ID'),
          txid: optionalText(transfer.txid, 'transaction ID')
        })
      }
    }
    this.#check(revision)
    return result
  }

  async listTransfers (id) {
    const revision = this.#revision
    this.#check(revision)
    return this.#transfers(revision, assetId(id))
  }

  async getTransferStatus (transferId, id) {
    const revision = this.#revision
    this.#check(revision)
    if (typeof transferId === 'number') integer(transferId, 'transferId', 0)
    else if (typeof transferId !== 'string' || transferId.length === 0 || transferId.length > 512 || /[\s\0]/.test(transferId)) {
      throw new WebRgbError('INVALID_PARAMS', 'Invalid transferId')
    }
    assetId(id)
    await this.#call(revision, () => this.#wallet.refreshTransfers({ skip_sync: false }))
    const txid = typeof transferId === 'string' && /^[a-f\d]{64}$/i.test(transferId) ? transferId.toLowerCase() : undefined
    const transfer = (await this.#transfers(revision, id, txid)).find(item =>
      String(item.transferId) === String(transferId) || item.txid === (txid ?? transferId) || item.recipientId === transferId)
    this.#check(revision)
    return { found: Boolean(transfer), status: transfer?.status ?? null, transfer: transfer ?? null }
  }

  async decodeRgbInvoice (args) {
    const revision = this.#revision
    this.#check(revision)
    const invoice = typeof args === 'string' ? args : object(args).invoice
    if (typeof invoice !== 'string' || !invoice.startsWith('rgb:') || invoice.length > 16384 || /[\s\0]/.test(invoice)) {
      throw new WebRgbError('INVALID_PARAMS', 'Invalid RGB invoice')
    }
    const raw = await this.#call(revision, () => this.#wallet.decodeRgbInvoice(invoice))
    this.#check(revision)
    const assignment = raw?.assignment
    if (!['Fungible', 'NonFungible', 'InflationRight', 'Any'].includes(assignment?.type)) {
      throw new WebRgbError('INTERNAL_ERROR', 'Invalid native invoice assignment')
    }
    const amount = assignment.type === 'Fungible' ? nativeInteger(assignment.value, 'invoice amount') || null : null
    if (!Array.isArray(raw.transport_endpoints) || raw.transport_endpoints.some(value => typeof value !== 'string')) {
      throw new WebRgbError('INTERNAL_ERROR', 'Invalid native transport endpoints')
    }
    return {
      assetId: optionalText(raw.asset_id, 'asset ID'),
      amount,
      recipientId: nativeText(raw.recipient_id, 'recipient ID'),
      expirationTimestamp: raw.expiration_timestamp == null ? undefined : nativeInteger(raw.expiration_timestamp, 'expiration timestamp'),
      network: nativeText(raw.network, 'network'),
      transportEndpoints: [...raw.transport_endpoints]
    }
  }
}
