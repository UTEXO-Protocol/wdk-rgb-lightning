// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.

// Surface coverage for WalletAccountRgbLightning + the read-only façade
// it returns from toReadOnlyAccount(). Most methods are 1-line
// passthroughs to this._node.<x>() (the _node getter calls
// this._binding.ensureNode()) or this._binding.<x>(); these tests assert each
// account method forwards to the right node/binding method with the
// right args and maps the result as documented.
//
// transfer/quoteTransfer, _classifyRecipient, verify/signTransaction,
// and vssStatus/clearVssFence/vssBackup are covered by other suites and
// are NOT re-tested here.

import { jest } from '@jest/globals'
import { WalletAccountReadOnly } from '@tetherto/wdk-wallet'
import WalletAccountRgbLightning from '../src/wallet-account-rgb-lightning.js'
import WalletAccountReadOnlyRgbLightning, {
  createReadOnlyRgbLightningAdapter
} from '../src/wallet-account-read-only-rgb-lightning.js'
import { UnlockError, AccountLockedError, ApayError } from '../src/errors.js'
import { LspClient } from '../src/lsp-client.js'
import { UtexoLsp } from '../src/utexo-lsp.js'

const AUTO_UNLOCK_REQUEST = Object.freeze({
  bitcoind_rpc_username: 'user',
  bitcoind_rpc_password: 'password',
  bitcoind_rpc_host: '127.0.0.1',
  bitcoind_rpc_port: 18443,
  indexer_url: 'tcp://127.0.0.1:50001',
  proxy_endpoint: 'rpc://127.0.0.1:3000/json-rpc',
  announce_addresses: Object.freeze([]),
  announce_alias: 'wallet-test'
})

// Build a fake RLN node whose methods are jest.fn returning canned
// values. Every method the account forwards to is present so we can
// assert forwarding + arg pass-through.
function makeNode (overrides = {}) {
  return {
    nodeInfo: jest.fn(() => ({ pubkey: 'np' })),
    networkInfo: jest.fn(() => ({ height: 100 })),
    sync: jest.fn(() => undefined),
    address: jest.fn(() => ({ address: 'tb1qreal' })),
    rotateAddress: jest.fn(() => ({ address: 'tb1qrotated' })),
    openChannel: jest.fn((r) => ({ opened: r })),
    closeChannel: jest.fn(() => undefined),
    listChannels: jest.fn(() => [{ id: 'c1' }]),
    getChannelId: jest.fn((h) => ({ channel_id: h })),
    connectPeer: jest.fn(() => undefined),
    disconnectPeer: jest.fn(() => undefined),
    listPeers: jest.fn(() => ({ peers: [] })),
    lnInvoice: jest.fn((r) => ({ invoice: 'lnbc1', payment_hash: 'ph', echo: r })),
    decodeLnInvoice: jest.fn((i) => ({ decoded: i })),
    invoiceStatus: jest.fn((i) => ({ status: 'Pending', echo: i })),
    cancelHodlInvoice: jest.fn(() => undefined),
    claimHodlInvoice: jest.fn((r) => ({ claimed: r })),
    sendPayment: jest.fn((r) => ({ payment_hash: 'sp', echo: r })),
    keysend: jest.fn((r) => ({ payment_hash: 'ks', echo: r })),
    listPayments: jest.fn(() => [{ p: 1 }]),
    getPayment: jest.fn((h, t) => ({ payment_hash: h, type: t })),
    issueAssetNia: jest.fn((r) => ({ nia: r })),
    issueAssetUda: jest.fn((r) => ({ uda: r })),
    issueAssetCfa: jest.fn((r) => ({ cfa: r })),
    issueAssetIfa: jest.fn((r) => ({ ifa: r })),
    listAssets: jest.fn((f) => ({ assets: f })),
    assetBalance: jest.fn((id) => ({ settled: 7, asset: id })),
    assetMetadata: jest.fn((id) => ({ meta: id })),
    listTransfers: jest.fn((id) => ({ transfers: id })),
    listTransfersByTxid: jest.fn(() => []),
    refreshTransfers: jest.fn(() => undefined),
    failTransfers: jest.fn((r) => ({ failed: r })),
    rgbInvoice: jest.fn((r) => ({ rgbinv: r })),
    decodeRgbInvoice: jest.fn((i) => ({ decodedRgb: i })),
    sendRgb: jest.fn((r) => ({ txid: 'rgbtx', echo: r })),
    inflate: jest.fn((r) => ({ inflated: r })),
    getAssetMedia: jest.fn((d) => ({ media: d })),
    postAssetMedia: jest.fn((r) => ({ posted: r })),
    btcBalance: jest.fn(() => ({ vanilla: { spendable: 1234, settled: 1000 } })),
    sendBtc: jest.fn((r) => ({ txid: 'btctx', echo: r })),
    listTransactions: jest.fn(() => ({ transactions: [] })),
    listTransactionsByTxid: jest.fn(() => []),
    listUnspents: jest.fn(() => ({ unspents: [] })),
    createUtxos: jest.fn(() => undefined),
    estimateFee: jest.fn(() => ({ fee_rate: 12 })),
    sendOnionMessage: jest.fn(() => undefined),
    signMessage: jest.fn((m) => ({ signature: 'sig:' + m })),
    verifyMessage: jest.fn(() => ({ valid: true })),
    checkIndexerUrl: jest.fn((u) => ({ ok: true, url: u })),
    checkProxyEndpoint: jest.fn(() => undefined),
    ...overrides
  }
}

// Build a fake binding around a node. Node-level overrides go via `node`;
// the binding exposes it through ensureNode(), matching the native wrappers.
function makeBinding (overrides = {}) {
  const { node: nodeOverride, ...bindingOverrides } = overrides
  const node = nodeOverride ?? makeNode()
  const binding = {
    ensureNode: jest.fn(() => node),
    unlock: jest.fn(() => undefined),
    bootstrap: jest.fn(() => ({ node_id: 'aa'.repeat(33) })),
    shutdown: jest.fn(() => undefined),
    apayNew: jest.fn(() => ({ order_id: 'o1' })),
    vssStatus: jest.fn(() => ({ configured: false, url: null, allowHttp: false, lastBackupVersion: null })),
    ...bindingOverrides
  }
  return binding
}

function makeAccount (bindingOverrides = {}, options = {}) {
  return new WalletAccountRgbLightning({
    binding: makeBinding(bindingOverrides),
    ...options
  })
}

describe('construction', () => {
  it('throws when no binding is provided', () => {
    expect(() => new WalletAccountRgbLightning()).toThrow(/requires a BareRgbLightningBinding/)
    expect(() => new WalletAccountRgbLightning({})).toThrow(/requires a BareRgbLightningBinding/)
  })

  it('exposes the cached node through binding.ensureNode()', () => {
    const node = makeNode()
    const account = makeAccount({ node })
    expect(account._node).toBe(node)
    expect(account._binding.ensureNode).toHaveBeenCalledTimes(1)
  })

  it('follows the current WDK inheritance chain through the concrete read-only account', () => {
    const account = makeAccount()
    expect(account).toBeInstanceOf(WalletAccountReadOnlyRgbLightning)
    expect(account).toBeInstanceOf(WalletAccountReadOnly)
  })

  it('validates the least-authority read-only adapter at construction time', () => {
    expect(() => createReadOnlyRgbLightningAdapter()).toThrow('binding is required')
    expect(() => new WalletAccountReadOnlyRgbLightning()).toThrow('requires a read-only adapter')
    expect(() => new WalletAccountReadOnlyRgbLightning({ address: jest.fn() })).toThrow('missing assetBalance()')
  })

  it('fails clearly when an installed binding lacks a required read-only node method', async () => {
    const node = makeNode({ verifyMessage: undefined })
    const adapter = createReadOnlyRgbLightningAdapter(makeBinding({ node }))
    const ro = new WalletAccountReadOnlyRgbLightning(adapter)
    await expect(ro.verify('hello', 'sig')).rejects.toThrow('does not expose verifyMessage()')
  })
})

describe('lifecycle', () => {
  it('unlock forwards the request and returns { ok: true }', async () => {
    const unlock = jest.fn()
    const account = makeAccount({ unlock })
    const req = { bitcoind_rpc_username: 'u' }
    await expect(account.unlock(req)).resolves.toEqual({ ok: true })
    expect(unlock).toHaveBeenCalledWith(req)
  })

  it('unlock wraps a binding failure into an UnlockError preserving the message', async () => {
    const account = makeAccount({
      unlock: () => { throw new Error('Rln(NotInitialized): bad creds') }
    })
    const err = await account.unlock({}).catch((e) => e)
    expect(err).toBeInstanceOf(UnlockError)
    expect(err.message).toBe('Rln(NotInitialized): bad creds')
    expect(err.code).toBe('UNLOCK_FAILED')
  })

  it('coalesces concurrent unlock calls at the account boundary', async () => {
    const unlock = jest.fn()
    const account = makeAccount({ unlock })

    await expect(Promise.all([
      account.unlock(AUTO_UNLOCK_REQUEST),
      account.unlock(AUTO_UNLOCK_REQUEST)
    ])).resolves.toEqual([{ ok: true }, { ok: true }])

    expect(unlock).toHaveBeenCalledTimes(1)
  })

  it('rejects a conflicting concurrent unlock request', async () => {
    let release
    const pending = new Promise((resolve) => { release = resolve })
    const unlock = jest.fn(() => pending)
    const account = makeAccount({ unlock })
    const first = account.unlock(AUTO_UNLOCK_REQUEST)
    const conflicting = account.unlock({
      ...AUTO_UNLOCK_REQUEST,
      bitcoind_rpc_host: 'other-host'
    })

    await expect(conflicting).rejects.toMatchObject({
      name: 'UnlockError',
      code: 'UNLOCK_FAILED',
      message: 'A different RGB Lightning unlock request is already in progress.'
    })
    release()
    await expect(first).resolves.toEqual({ ok: true })
    expect(unlock).toHaveBeenCalledTimes(1)
  })

  it('getBootstrap returns the binding bootstrap dictionary verbatim', async () => {
    // Real bootstrap dict (external-signer): node_id + per-keychain xpubs +
    // master_fingerprint. The account must return it unchanged (identity).
    const boot = {
      node_id: 'aa'.repeat(33),
      account_xpub_vanilla: 'tpubVanilla',
      account_xpub_colored: 'tpubColored',
      master_fingerprint: 'deadbeef'
    }
    const account = makeAccount({ bootstrap: () => boot })
    const out = await account.getBootstrap()
    expect(out).toBe(boot)
    expect(out.account_xpub_vanilla).toBe('tpubVanilla')
    expect(out.master_fingerprint).toBe('deadbeef')
  })

  it('shutdown calls the binding and returns { ok: true }', async () => {
    const shutdown = jest.fn()
    const account = makeAccount({ shutdown })
    await expect(account.shutdown()).resolves.toEqual({ ok: true })
    expect(shutdown).toHaveBeenCalledTimes(1)
  })

  it('vssBackup wraps binding failures in a typed VssError', async () => {
    const account = makeAccount({
      vssStatus: () => ({ configured: true }),
      vssBackup: () => { throw new Error('vss unavailable') }
    })
    const err = await account.vssBackup().catch((e) => e)
    expect(err.name).toBe('VssError')
    expect(err.message).toBe('vss unavailable')
  })
})

describe('apayNew', () => {
  it('forwards to the binding and returns the AsyncOrderNewResponse verbatim', async () => {
    // Real apay_new (rgb-lightning-node PR #51) returns an
    // AsyncOrderNewResponse with snake_case fields. Assert the account is a
    // transparent passthrough that neither remaps nor drops fields.
    const orderResp = {
      request_id: 'req-1',
      host_node_id: 'bb'.repeat(33),
      protocol_version: 1,
      order_id: 'order-9',
      status: 'created',
      accepted_through_index: 0,
      next_index_expected: 1,
      unused_hashes: ['h0', 'h1'],
      refill_batch_size: 64,
      first_hash_index: 0
    }
    const apayNew = jest.fn(() => orderResp)
    const account = makeAccount({ apayNew })
    const out = await account.apayNew('host')
    expect(out).toBe(orderResp)
    expect(out.order_id).toBe('order-9')
    expect(out.request_id).toBe('req-1')
    expect(out.status).toBe('created')
    expect(apayNew).toHaveBeenCalledWith('host')
  })

  it('wraps a binding failure into an ApayError', async () => {
    const account = makeAccount({ apayNew: () => { throw new Error('lsp unreachable') } })
    const err = await account.apayNew('host').catch((e) => e)
    expect(err).toBeInstanceOf(ApayError)
    expect(err.message).toBe('lsp unreachable')
  })
})

describe('node info / network / sync', () => {
  it('getNodeInfo forwards to node.nodeInfo', async () => {
    const node = makeNode()
    const account = makeAccount({ node })
    await expect(account.getNodeInfo()).resolves.toEqual({ pubkey: 'np' })
    expect(node.nodeInfo).toHaveBeenCalledTimes(1)
  })

  it('getNetworkInfo forwards to node.networkInfo', async () => {
    const node = makeNode()
    const account = makeAccount({ node })
    await expect(account.getNetworkInfo()).resolves.toEqual({ height: 100 })
    expect(node.networkInfo).toHaveBeenCalledTimes(1)
  })

  it('sync calls node.sync and returns { ok: true }', async () => {
    const node = makeNode()
    const account = makeAccount({ node })
    await expect(account.sync()).resolves.toEqual({ ok: true })
    expect(node.sync).toHaveBeenCalledTimes(1)
  })
})

describe('getAddress', () => {
  it('returns the .address field when node.address returns an object', async () => {
    const account = makeAccount({ node: makeNode({ address: () => ({ address: 'tb1qabc' }) }) })
    await expect(account.getAddress()).resolves.toBe('tb1qabc')
  })

  it('returns the string directly when node.address returns a string', async () => {
    const account = makeAccount({ node: makeNode({ address: () => 'tb1qstr' }) })
    await expect(account.getAddress()).resolves.toBe('tb1qstr')
  })

  it('throws AccountLockedError instead of returning a synthetic address', async () => {
    const account = makeAccount({ node: makeNode({ address: () => { throw new Error('NotInitialized') } }) })
    await expect(account.getAddress()).rejects.toBeInstanceOf(AccountLockedError)
  })

  it('coalesces configured activation and returns only the real native address', async () => {
    let unlocked = false
    const address = jest.fn(() => {
      if (!unlocked) throw new Error('SdkNode not created — call unlock() first')
      return { address: 'tb1qactivated' }
    })
    const unlock = jest.fn(() => { unlocked = true })
    const account = makeAccount(
      { node: makeNode({ address }), unlock },
      { autoUnlockRequest: AUTO_UNLOCK_REQUEST }
    )

    await expect(Promise.all([
      account.getAddress(),
      account.getAddress()
    ])).resolves.toEqual(['tb1qactivated', 'tb1qactivated'])

    expect(unlock).toHaveBeenCalledTimes(1)
    expect(unlock).toHaveBeenCalledWith(AUTO_UNLOCK_REQUEST)
    expect(address).toHaveBeenCalledTimes(4)
  })

  it('does not hide an automatic activation failure behind an address marker', async () => {
    const account = makeAccount(
      {
        node: makeNode({ address: () => { throw new Error('LockedNode') } }),
        unlock: () => { throw new Error('indexer unavailable') }
      },
      { autoUnlockRequest: AUTO_UNLOCK_REQUEST }
    )

    await expect(account.getAddress()).rejects.toMatchObject({
      name: 'UnlockError',
      code: 'UNLOCK_FAILED',
      message: 'indexer unavailable'
    })
  })

  it('returns a non-throwing locked state for pre-unlock UI loaders', async () => {
    const account = makeAccount({ node: makeNode({ address: () => { throw new Error('LockedNode') } }) })
    await expect(account.getAddressState()).resolves.toEqual({ status: 'locked', address: null })
  })

  it('classifies thrown-string locked errors as locked', async () => {
    const account = makeAccount({
      node: makeNode({
        // eslint-disable-next-line no-throw-literal
        address: () => { throw 'LockedNode' }
      })
    })
    await expect(account.getAddress()).rejects.toBeInstanceOf(AccountLockedError)
  })

  it('classifies an uncreated native node as locked', async () => {
    const binding = makeBinding()
    binding.ensureNode.mockImplementation(() => { throw new Error('SdkNode not created — call unlock() first') })
    const account = new WalletAccountRgbLightning({ binding })
    await expect(account.getAddress()).rejects.toBeInstanceOf(AccountLockedError)
    await expect(account.getBalance()).resolves.toBe(0n)
  })

  it('rejects an empty address response', async () => {
    const account = makeAccount({ node: makeNode({ address: () => '' }) })
    await expect(account.getAddress()).rejects.toThrow('invalid receive address')
  })

  it('rejects an object without an address', async () => {
    const account = makeAccount({ node: makeNode({ address: () => ({}) }) })
    await expect(account.getAddress()).rejects.toThrow('invalid receive address')
  })

  it('propagates non-lock address errors through getAddress and getAddressState', async () => {
    const account = makeAccount({ node: makeNode({ address: () => { throw new Error('indexer offline') } }) })
    await expect(account.getAddress()).rejects.toThrow('indexer offline')
    await expect(account.getAddressState()).rejects.toThrow('indexer offline')
  })
})

describe('channels', () => {
  it('openChannel forwards the request and returns the response', async () => {
    const node = makeNode()
    const account = makeAccount({ node })
    const req = { capacity_sat: 100000 }
    await expect(account.openChannel(req)).resolves.toEqual({ opened: req })
    expect(node.openChannel).toHaveBeenCalledWith(req)
  })

  it('closeChannel forwards and returns { ok: true }', async () => {
    const node = makeNode()
    const account = makeAccount({ node })
    const req = { channel_id: 'c1' }
    await expect(account.closeChannel(req)).resolves.toEqual({ ok: true })
    expect(node.closeChannel).toHaveBeenCalledWith(req)
  })

  it('listChannels forwards to node.listChannels', async () => {
    const node = makeNode()
    const account = makeAccount({ node })
    await expect(account.listChannels()).resolves.toEqual([{ id: 'c1' }])
  })

  it('getChannelId forwards the temporary id', async () => {
    const node = makeNode()
    const account = makeAccount({ node })
    await expect(account.getChannelId('tmp')).resolves.toEqual({ channel_id: 'tmp' })
    expect(node.getChannelId).toHaveBeenCalledWith('tmp')
  })
})

describe('peers', () => {
  it('connectPeer forwards and returns { ok: true } on success', async () => {
    const node = makeNode()
    const account = makeAccount({ node })
    await expect(account.connectPeer('pk@host:9735')).resolves.toEqual({ ok: true })
    expect(node.connectPeer).toHaveBeenCalledWith('pk@host:9735')
  })

  it('connectPeer swallows a Conflict error and returns { ok: true }', async () => {
    const account = makeAccount({
      node: makeNode({ connectPeer: () => { throw new Error('Rln(Conflict): peer known') } })
    })
    await expect(account.connectPeer('pk@host')).resolves.toEqual({ ok: true })
  })

  it('connectPeer rethrows non-Conflict errors', async () => {
    const account = makeAccount({
      node: makeNode({ connectPeer: () => { throw new Error('connection refused') } })
    })
    await expect(account.connectPeer('pk@host')).rejects.toThrow('connection refused')
  })

  it('disconnectPeer forwards and returns { ok: true }', async () => {
    const node = makeNode()
    const account = makeAccount({ node })
    const req = { peer_pubkey: 'pk' }
    await expect(account.disconnectPeer(req)).resolves.toEqual({ ok: true })
    expect(node.disconnectPeer).toHaveBeenCalledWith(req)
  })

  it('listPeers forwards to node.listPeers', async () => {
    const node = makeNode({ listPeers: () => ({ peers: [{ pubkey: 'p' }] }) })
    const account = makeAccount({ node })
    await expect(account.listPeers()).resolves.toEqual({ peers: [{ pubkey: 'p' }] })
  })
})

describe('invoices', () => {
  it('createInvoice forwards to node.lnInvoice', async () => {
    const node = makeNode()
    const account = makeAccount({ node })
    const req = { expiry_sec: 3600 }
    await expect(account.createInvoice(req)).resolves.toMatchObject({ invoice: 'lnbc1' })
    expect(node.lnInvoice).toHaveBeenCalledWith(req)
  })

  it('createLightningInvoice maps camelCase keys to snake_case before lnInvoice', async () => {
    const node = makeNode()
    const account = makeAccount({ node })
    await account.createLightningInvoice({
      amountMsat: 1000,
      expirySec: 3600,
      assetId: 'aid',
      assetAmount: 5,
      paymentHash: 'ph',
      descriptionHash: 'dh',
      minFinalCltvExpiryDelta: 18
    })
    expect(node.lnInvoice).toHaveBeenCalledWith({
      amt_msat: 1000,
      expiry_sec: 3600,
      asset_id: 'aid',
      asset_amount: 5,
      payment_hash: 'ph',
      description_hash: 'dh',
      min_final_cltv_expiry_delta: 18
    })
  })

  it('_toLnInvoiceRequest passes snake_case keys through untouched', () => {
    const snake = { amt_msat: 1, expiry_sec: 2, asset_id: 'a' }
    expect(WalletAccountRgbLightning._toLnInvoiceRequest(snake)).toEqual(snake)
  })

  it('_toLnInvoiceRequest returns non-object input unchanged', () => {
    expect(WalletAccountRgbLightning._toLnInvoiceRequest(undefined)).toBeUndefined()
    expect(WalletAccountRgbLightning._toLnInvoiceRequest('x')).toBe('x')
  })

  it('_toLnInvoiceRequest keeps an existing snake_case value when both forms present', () => {
    const out = WalletAccountRgbLightning._toLnInvoiceRequest({ amountMsat: 1, amt_msat: 999 })
    // snake already present → camel is left in place, not overwritten
    expect(out.amt_msat).toBe(999)
    expect(out.amountMsat).toBe(1)
  })

  it('decodeInvoice forwards to node.decodeLnInvoice', async () => {
    const node = makeNode()
    const account = makeAccount({ node })
    await expect(account.decodeInvoice('lnbc1')).resolves.toEqual({ decoded: 'lnbc1' })
    expect(node.decodeLnInvoice).toHaveBeenCalledWith('lnbc1')
  })

  it('getInvoiceStatus forwards to node.invoiceStatus', async () => {
    const node = makeNode()
    const account = makeAccount({ node })
    await expect(account.getInvoiceStatus('lnbc1')).resolves.toMatchObject({ status: 'Pending' })
    expect(node.invoiceStatus).toHaveBeenCalledWith('lnbc1')
  })

  it('createHodlInvoice throws TypeError when paymentHash is missing', async () => {
    const account = makeAccount()
    await expect(account.createHodlInvoice({})).rejects.toBeInstanceOf(TypeError)
    await expect(account.createHodlInvoice()).rejects.toBeInstanceOf(TypeError)
    await expect(account.createHodlInvoice({ paymentHash: '' })).rejects.toBeInstanceOf(TypeError)
  })

  it('createHodlInvoice shapes { bolt11, paymentHash } from RLN response', async () => {
    const node = makeNode({ lnInvoice: () => ({ invoice: 'lnbc-hodl', payment_hash: 'returnedhash' }) })
    const account = makeAccount({ node })
    await expect(account.createHodlInvoice({
      paymentHash: 'ph',
      amtMsat: 2000,
      expirySec: 900,
      assetId: 'aid',
      assetAmount: 3,
      minFinalCltvExpiryDelta: 40
    })).resolves.toEqual({ bolt11: 'lnbc-hodl', paymentHash: 'returnedhash' })
  })

  it('createHodlInvoice falls back to res.bolt11 and the supplied hash', async () => {
    const node = makeNode({ lnInvoice: () => ({ bolt11: 'fromBolt11' }) })
    const account = makeAccount({ node })
    await expect(account.createHodlInvoice({ paymentHash: 'mine', expirySec: 60 }))
      .resolves.toEqual({ bolt11: 'fromBolt11', paymentHash: 'mine' })
  })

  it('createHodlInvoice prefers res.invoice over res.bolt11 when BOTH are present', async () => {
    // Precedence guard: `res?.invoice ?? res?.bolt11`. RLN's real lnInvoice
    // returns `invoice`; a defensive `bolt11` fallback exists. With BOTH keys
    // present the `invoice` value MUST win — swapping the operands
    // (`bolt11 ?? invoice`) would yield 'fromBolt11' and fail this.
    const node = makeNode({
      lnInvoice: () => ({ invoice: 'fromInvoice', bolt11: 'fromBolt11', payment_hash: 'h' })
    })
    const account = makeAccount({ node })
    await expect(account.createHodlInvoice({ paymentHash: 'mine', expirySec: 60 }))
      .resolves.toEqual({ bolt11: 'fromInvoice', paymentHash: 'h' })
  })

  it('createHodlInvoice prefers res.payment_hash over the supplied hash', async () => {
    // `res?.payment_hash ?? params.paymentHash`: RLN echoes back the real hash.
    // When present it must win over the caller-supplied one.
    const node = makeNode({
      lnInvoice: () => ({ invoice: 'lnbc-x', payment_hash: 'rlnHash' })
    })
    const account = makeAccount({ node })
    await expect(account.createHodlInvoice({ paymentHash: 'mine', expirySec: 60 }))
      .resolves.toEqual({ bolt11: 'lnbc-x', paymentHash: 'rlnHash' })
  })

  it('createHodlInvoice yields empty bolt11 when neither invoice nor bolt11 present', async () => {
    const node = makeNode({ lnInvoice: () => ({}) })
    const account = makeAccount({ node })
    await expect(account.createHodlInvoice({ paymentHash: 'mine', expirySec: 60 }))
      .resolves.toEqual({ bolt11: '', paymentHash: 'mine' })
  })

  it('cancelHodlInvoice forwards and returns { ok: true }', async () => {
    const node = makeNode()
    const account = makeAccount({ node })
    const req = { payment_hash: 'ph' }
    await expect(account.cancelHodlInvoice(req)).resolves.toEqual({ ok: true })
    expect(node.cancelHodlInvoice).toHaveBeenCalledWith(req)
  })

  it('claimHodlInvoice forwards and returns the response', async () => {
    const node = makeNode()
    const account = makeAccount({ node })
    const req = { payment_hash: 'ph', preimage: 'pi' }
    await expect(account.claimHodlInvoice(req)).resolves.toEqual({ claimed: req })
  })
})

describe('payments', () => {
  it('sendPayment forwards to node.sendPayment', async () => {
    const node = makeNode()
    const account = makeAccount({ node })
    const req = { invoice: 'lnbc1' }
    await expect(account.sendPayment(req)).resolves.toMatchObject({ payment_hash: 'sp' })
    expect(node.sendPayment).toHaveBeenCalledWith(req)
  })

  it('keysend forwards to node.keysend', async () => {
    const node = makeNode()
    const account = makeAccount({ node })
    const req = { dest_pubkey: 'pk', amt_msat: 1 }
    await expect(account.keysend(req)).resolves.toMatchObject({ payment_hash: 'ks' })
    expect(node.keysend).toHaveBeenCalledWith(req)
  })

  it('listPayments forwards to node.listPayments', async () => {
    const account = makeAccount()
    await expect(account.listPayments()).resolves.toEqual([{ p: 1 }])
  })

  it('getPayment forwards the hash + type', async () => {
    const node = makeNode()
    const account = makeAccount({ node })
    await expect(account.getPayment('h', 'Outbound')).resolves.toEqual({ payment_hash: 'h', type: 'Outbound' })
    expect(node.getPayment).toHaveBeenCalledWith('h', 'Outbound')
  })
})

describe('RGB issuance passthroughs', () => {
  it.each([
    ['issueAssetNia', 'issueAssetNia', 'nia'],
    ['issueAssetUda', 'issueAssetUda', 'uda'],
    ['issueAssetCfa', 'issueAssetCfa', 'cfa'],
    ['issueAssetIfa', 'issueAssetIfa', 'ifa'],
    ['inflate', 'inflate', 'inflated']
  ])('%s forwards to node.%s', async (method, nodeMethod, key) => {
    const node = makeNode()
    const account = makeAccount({ node })
    const req = { x: 1 }
    const res = await account[method](req)
    expect(res).toEqual({ [key]: req })
    expect(node[nodeMethod]).toHaveBeenCalledWith(req)
  })
})

describe('RGB assets', () => {
  it('listAssets forwards the schema filter', async () => {
    const node = makeNode()
    const account = makeAccount({ node })
    await expect(account.listAssets(['Nia'])).resolves.toEqual({ assets: ['Nia'] })
    expect(node.listAssets).toHaveBeenCalledWith(['Nia'])
  })

  it('getAssetBalance forwards to node.assetBalance', async () => {
    const node = makeNode()
    const account = makeAccount({ node })
    await expect(account.getAssetBalance('aid')).resolves.toEqual({ settled: 7, asset: 'aid' })
    expect(node.assetBalance).toHaveBeenCalledWith('aid')
  })

  it('getAssetMetadata forwards to node.assetMetadata', async () => {
    const node = makeNode()
    const account = makeAccount({ node })
    await expect(account.getAssetMetadata('aid')).resolves.toEqual({ meta: 'aid' })
  })

  it('listTransfers forwards to node.listTransfers', async () => {
    const node = makeNode()
    const account = makeAccount({ node })
    await expect(account.listTransfers('aid')).resolves.toEqual({ transfers: 'aid' })
  })

  it('refreshTransfers forwards and returns { ok: true }', async () => {
    const node = makeNode()
    const account = makeAccount({ node })
    const req = { asset_id: 'aid' }
    await expect(account.refreshTransfers(req)).resolves.toEqual({ ok: true })
    expect(node.refreshTransfers).toHaveBeenCalledWith(req)
  })

  it('failTransfers forwards to node.failTransfers', async () => {
    const node = makeNode()
    const account = makeAccount({ node })
    const req = { batch_transfer_idx: 1 }
    await expect(account.failTransfers(req)).resolves.toEqual({ failed: req })
  })
})

describe('RGB invoices / transfers / media', () => {
  it('createRgbInvoice forwards to node.rgbInvoice', async () => {
    const node = makeNode()
    const account = makeAccount({ node })
    const req = { asset_id: 'aid' }
    await expect(account.createRgbInvoice(req)).resolves.toEqual({ rgbinv: req })
  })

  it('decodeRgbInvoice forwards to node.decodeRgbInvoice', async () => {
    const node = makeNode()
    const account = makeAccount({ node })
    await expect(account.decodeRgbInvoice('rgb:abc')).resolves.toEqual({ decodedRgb: 'rgb:abc' })
  })

  it('sendRgbAsset forwards to node.sendRgb', async () => {
    const node = makeNode()
    const account = makeAccount({ node })
    const req = { recipient_id: 'rgb:abc' }
    await expect(account.sendRgbAsset(req)).resolves.toMatchObject({ txid: 'rgbtx' })
    expect(node.sendRgb).toHaveBeenCalledWith(req)
  })

  it('getAssetMedia forwards the digest', async () => {
    const node = makeNode()
    const account = makeAccount({ node })
    await expect(account.getAssetMedia('digest')).resolves.toEqual({ media: 'digest' })
  })

  it('postAssetMedia forwards the request', async () => {
    const node = makeNode()
    const account = makeAccount({ node })
    const req = { file_path: '/x' }
    await expect(account.postAssetMedia(req)).resolves.toEqual({ posted: req })
  })
})

describe('BTC ops', () => {
  it('getBalance parses vanilla.spendable to a bigint', async () => {
    const account = makeAccount({
      node: makeNode({ btcBalance: () => ({ vanilla: { spendable: 4242, settled: 100 } }) })
    })
    await expect(account.getBalance()).resolves.toBe(4242n)
  })

  it('getBalance falls back to vanilla.settled when spendable is absent', async () => {
    const account = makeAccount({
      node: makeNode({ btcBalance: () => ({ vanilla: { settled: 77 } }) })
    })
    await expect(account.getBalance()).resolves.toBe(77n)
  })

  it('getBalance returns 0n for a locked node', async () => {
    const account = makeAccount({
      node: makeNode({ btcBalance: () => { throw new Error('NotInitialized') } })
    })
    await expect(account.getBalance()).resolves.toBe(0n)
  })

  it('getBalance does not hide non-locking backend failures', async () => {
    const account = makeAccount({ node: makeNode({ btcBalance: () => { throw new Error('indexer unavailable') } }) })
    await expect(account.getBalance()).rejects.toThrow('indexer unavailable')
  })

  it('getBalance forwards the skipSync flag', async () => {
    const btcBalance = jest.fn(() => ({ vanilla: { spendable: 1 } }))
    const account = makeAccount({ node: makeNode({ btcBalance }) })
    await account.getBalance(true)
    expect(btcBalance).toHaveBeenCalledWith(true)
  })

  it('getBalance coerces a truthy non-boolean skipSync to a real boolean', async () => {
    // Passing the literal `true` cannot distinguish `btcBalance(!!skipSync)`
    // from `btcBalance(skipSync)`. Pass a truthy *non-boolean* (1): under the
    // documented `!!` coercion the node must receive the boolean `true`, NOT 1.
    const btcBalance = jest.fn(() => ({ vanilla: { spendable: 1 } }))
    const account = makeAccount({ node: makeNode({ btcBalance }) })
    await account.getBalance(1)
    expect(btcBalance).toHaveBeenCalledWith(true)
    // Strict identity: the argument is the primitive boolean true, not 1.
    const arg = btcBalance.mock.calls[0][0]
    expect(arg).toBe(true)
    expect(typeof arg).toBe('boolean')
  })

  it('getBalance coerces a falsy non-boolean skipSync to false', async () => {
    const btcBalance = jest.fn(() => ({ vanilla: { spendable: 1 } }))
    const account = makeAccount({ node: makeNode({ btcBalance }) })
    await account.getBalance(0)
    const arg = btcBalance.mock.calls[0][0]
    expect(arg).toBe(false)
    expect(typeof arg).toBe('boolean')
  })

  it('getBalance returns 0n via the absent-vanilla path (not the catch)', async () => {
    // btcBalance succeeds but the result has no `vanilla` at all → the
    // `?? 0` final default fires (String(0)='0'), a DIFFERENT code path than
    // the catch-block '0'. Spy proves btcBalance was actually invoked.
    const btcBalance = jest.fn(() => ({}))
    const account = makeAccount({ node: makeNode({ btcBalance }) })
    await expect(account.getBalance()).resolves.toBe(0n)
    expect(btcBalance).toHaveBeenCalledTimes(1)
  })

  it('getBalanceDetails forwards to node.btcBalance with coerced skipSync', async () => {
    const btcBalance = jest.fn(() => ({ vanilla: { spendable: 5 } }))
    const account = makeAccount({ node: makeNode({ btcBalance }) })
    await expect(account.getBalanceDetails(true)).resolves.toEqual({ vanilla: { spendable: 5 } })
    expect(btcBalance).toHaveBeenCalledWith(true)
  })

  it('getBalanceDetails coerces a truthy non-boolean skipSync to a real boolean', async () => {
    const btcBalance = jest.fn(() => ({ vanilla: { spendable: 5 } }))
    const account = makeAccount({ node: makeNode({ btcBalance }) })
    await account.getBalanceDetails(1)
    const arg = btcBalance.mock.calls[0][0]
    expect(arg).toBe(true)
    expect(typeof arg).toBe('boolean')
  })

  it('sendTransaction maps the WDK transaction and result shapes', async () => {
    const node = makeNode()
    const account = makeAccount({ node })
    await expect(account.sendTransaction({ to: 'tb1q', value: 1000, feeRate: 2 })).resolves.toEqual({
      hash: 'btctx',
      fee: 282n
    })
    expect(node.sendBtc).toHaveBeenCalledWith({
      address: 'tb1q',
      amount: 1000,
      fee_rate: 2,
      skip_sync: false
    })
  })

  it('sendTransaction accepts legacy RLN aliases and response hash fallback during beta migration', async () => {
    const node = makeNode({ sendBtc: jest.fn(() => ({ hash: 'legacyhash' })) })
    const account = makeAccount({ node })
    await expect(account.sendTransaction({
      address: 'tb1qlegacy',
      amount: 2000,
      fee_rate: 3,
      skip_sync: true
    })).resolves.toEqual({ hash: 'legacyhash', fee: 423n })
    expect(node.sendBtc).toHaveBeenCalledWith({
      address: 'tb1qlegacy',
      amount: 2000,
      fee_rate: 3,
      skip_sync: true
    })
  })

  it('sendTransaction validates the WDK transaction shape before touching the node', async () => {
    const node = makeNode()
    const account = makeAccount({ node })
    await expect(account.sendTransaction()).rejects.toThrow('requires a transaction object')
    await expect(account.sendTransaction({ value: 1 })).rejects.toThrow('requires a non-empty to address')
    await expect(account.sendTransaction({ to: 'tb1q', value: Number.MAX_SAFE_INTEGER + 1 })).rejects.toThrow('non-negative safe integer')
    expect(node.sendBtc).not.toHaveBeenCalled()
  })

  it('rotateAddress requires a compatible binding method and a concrete address response', async () => {
    const missing = makeAccount({ node: makeNode({ rotateAddress: undefined }) })
    await expect(missing.rotateAddress()).rejects.toThrow('does not expose rotateAddress()')

    const invalid = makeAccount({ node: makeNode({ rotateAddress: () => ({}) }) })
    await expect(invalid.rotateAddress()).rejects.toThrow('invalid rotated address')
  })

  it('rotateAddress accepts the native string response form', async () => {
    const account = makeAccount({ node: makeNode({ rotateAddress: () => 'tb1qstringrotated' }) })
    await expect(account.rotateAddress()).resolves.toBe('tb1qstringrotated')
  })

  it('getTransactions forwards to node.listTransactions with coerced skipSync', async () => {
    const listTransactions = jest.fn(() => ({ transactions: [] }))
    const account = makeAccount({ node: makeNode({ listTransactions }) })
    await account.getTransactions(true)
    expect(listTransactions).toHaveBeenCalledWith(true)
  })

  it('getTransactions normalizes skipSync to boolean', async () => {
    // Unlike getBalance/getBalanceDetails, getTransactions passes skipSync
    // through verbatim. A non-boolean truthy (1) must reach the node AS 1,
    // not coerced to `true` — this catches an accidental `!!` being added.
    const listTransactions = jest.fn(() => ({ transactions: [] }))
    const account = makeAccount({ node: makeNode({ listTransactions }) })
    await account.getTransactions(1)
    const arg = listTransactions.mock.calls[0][0]
    expect(arg).toBe(true)
    expect(typeof arg).toBe('boolean')
  })

  it('listUnspents forwards to node.listUnspents', async () => {
    const listUnspents = jest.fn(() => ({ unspents: [] }))
    const account = makeAccount({ node: makeNode({ listUnspents }) })
    await expect(account.listUnspents(false)).resolves.toEqual({ unspents: [] })
    expect(listUnspents).toHaveBeenCalledWith(false)
  })

  it('listUnspents normalizes skipSync to boolean', async () => {
    const listUnspents = jest.fn(() => ({ unspents: [] }))
    const account = makeAccount({ node: makeNode({ listUnspents }) })
    await account.listUnspents(1)
    const arg = listUnspents.mock.calls[0][0]
    expect(arg).toBe(true)
    expect(typeof arg).toBe('boolean')
  })

  it('createUtxos forwards and returns { ok: true }', async () => {
    const node = makeNode()
    const account = makeAccount({ node })
    const req = { num: 4 }
    await expect(account.createUtxos(req)).resolves.toEqual({ ok: true })
    expect(node.createUtxos).toHaveBeenCalledWith(req)
  })

  it('estimateFee forwards the blocks target', async () => {
    const node = makeNode()
    const account = makeAccount({ node })
    await expect(account.estimateFee(6)).resolves.toEqual({ fee_rate: 12 })
    expect(node.estimateFee).toHaveBeenCalledWith(6)
  })
})

describe('diagnostics / onion / signing', () => {
  it('sendOnionMessage forwards and returns { ok: true }', async () => {
    const node = makeNode()
    const account = makeAccount({ node })
    const req = { node_id: 'pk' }
    await expect(account.sendOnionMessage(req)).resolves.toEqual({ ok: true })
    expect(node.sendOnionMessage).toHaveBeenCalledWith(req)
  })

  it('sign forwards to node.signMessage', async () => {
    const node = makeNode()
    const account = makeAccount({ node })
    await expect(account.sign('hello')).resolves.toBe('sig:hello')
    expect(node.signMessage).toHaveBeenCalledWith('hello')
  })

  it('sign accepts the signed_message field used by native bindings', async () => {
    const account = makeAccount({ node: makeNode({ signMessage: () => ({ signed_message: 'zbase32sig' }) }) })
    await expect(account.sign('hello')).resolves.toBe('zbase32sig')
  })

  it('rejects an invalid native signature response', async () => {
    const account = makeAccount({ node: makeNode({ signMessage: () => ({}) }) })
    await expect(account.sign('hello')).rejects.toThrow('invalid message signature')
  })

  it('checkIndexerUrl forwards the url and returns the indexer response verbatim', async () => {
    // Pure passthrough: the account must forward the url and return whatever
    // the node returns (the indexer's own response), not synthesise a shape.
    // Use a realistic indexer payload and assert object identity to pin the
    // passthrough — a mutant that wrapped/remapped the result would fail.
    const indexerResp = { indexer_protocol: 'Electrum', block_height: 102 }
    const checkIndexerUrl = jest.fn(() => indexerResp)
    const account = makeAccount({ node: makeNode({ checkIndexerUrl }) })
    const out = await account.checkIndexerUrl('http://idx')
    expect(out).toBe(indexerResp)
    expect(checkIndexerUrl).toHaveBeenCalledWith('http://idx')
  })

  it('checkProxyEndpoint forwards and returns { ok: true }', async () => {
    const node = makeNode()
    const account = makeAccount({ node })
    await expect(account.checkProxyEndpoint('http://proxy')).resolves.toEqual({ ok: true })
    expect(node.checkProxyEndpoint).toHaveBeenCalledWith('http://proxy')
  })
})

describe('quoteSendTransaction', () => {
  it('uses estimateFee-derived rate × vbytes', async () => {
    const account = makeAccount()
    // override _defaultFeeRate to avoid relying on node fee shape
    account._defaultFeeRate = async () => 10
    await expect(account.quoteSendTransaction({})).resolves.toEqual({ fee: BigInt(10 * 141) })
  })

  it('rejects non-positive fee rates', async () => {
    const account = makeAccount()
    await expect(account.quoteSendTransaction({ feeRate: 0 })).rejects.toThrow('feeRate must be a positive number')
  })
})

describe('_defaultFeeRate', () => {
  it('reads fee_rate from estimateFee (the real RLN shape)', async () => {
    // Real estimateFee contract: Promise<{ fee_rate?: number }>.
    const account = makeAccount({ node: makeNode({ estimateFee: () => ({ fee_rate: 9 }) }) })
    await expect(account._defaultFeeRate(6)).resolves.toBe(9)
  })

  it('prefers fee_rate over the feerate alias when BOTH are present', async () => {
    // Precedence in `r?.fee_rate ?? r?.feerate ?? r`: the canonical
    // snake_case `fee_rate` must win. Reordering the operands would
    // surface the alias (8) instead of the real field (9) and fail here.
    const account = makeAccount({
      node: makeNode({ estimateFee: () => ({ fee_rate: 9, feerate: 8 }) })
    })
    await expect(account._defaultFeeRate(6)).resolves.toBe(9)
  })

  it('reads feerate alias (defensive fallback when fee_rate absent)', async () => {
    const account = makeAccount({ node: makeNode({ estimateFee: () => ({ feerate: 8 }) }) })
    await expect(account._defaultFeeRate(6)).resolves.toBe(8)
  })

  it('accepts a bare numeric estimateFee result (final fallback arm)', async () => {
    const account = makeAccount({ node: makeNode({ estimateFee: () => 3 }) })
    await expect(account._defaultFeeRate(6)).resolves.toBe(3)
  })

  it('forwards the blocks target to estimateFee', async () => {
    // Guards against dropping/altering the `blocks` argument in the source.
    const estimateFee = jest.fn(() => ({ fee_rate: 9 }))
    const account = makeAccount({ node: makeNode({ estimateFee }) })
    await account._defaultFeeRate(6)
    expect(estimateFee).toHaveBeenCalledWith(6)
  })

  it('falls back to the default rate when estimateFee returns a non-positive value', async () => {
    const account = makeAccount({ node: makeNode({ estimateFee: () => ({ fee_rate: 0 }) }) })
    await expect(account._defaultFeeRate(6)).resolves.toBe(5)
  })

  it('falls back to the default rate when estimateFee throws', async () => {
    const account = makeAccount({ node: makeNode({ estimateFee: () => { throw new Error('no') } }) })
    await expect(account._defaultFeeRate(6)).resolves.toBe(5)
  })
})

describe('getTransactionReceipt', () => {
  it('throws when the hash is empty', async () => {
    const account = makeAccount()
    await expect(account.getTransactionReceipt('')).rejects.toThrow(/hash is required/)
    await expect(account.getTransactionReceipt(undefined)).rejects.toThrow(/hash is required/)
  })

  it('returns a confirmed on-chain transaction from the txid-filtered query', async () => {
    const hit = { txid: 'abc', confirmation_time: { height: 10, timestamp: 20 } }
    const listTransactionsByTxid = jest.fn(() => [hit])
    const account = makeAccount({ node: makeNode({ listTransactionsByTxid }) })
    await expect(account.getTransactionReceipt('abc')).resolves.toBe(hit)
    expect(listTransactionsByTxid).toHaveBeenCalledWith('abc', false)
  })

  it('returns null for an unconfirmed on-chain transaction', async () => {
    const account = makeAccount({
      node: makeNode({ listTransactionsByTxid: () => [{ txid: 'abc', confirmation_time: null }] })
    })
    await expect(account.getTransactionReceipt('abc')).resolves.toBeNull()
  })

  it('returns a settled RGB transfer', async () => {
    const transfer = { txid: 'rgbtx', status: 'Settled' }
    const account = makeAccount({
      node: makeNode({ listTransfersByTxid: () => ({ transfers: [transfer] }) })
    })
    await expect(account.getTransactionReceipt('rgbtx')).resolves.toBe(transfer)
  })

  it('returns a completed Lightning payment and hides pending payments', async () => {
    const completed = { payment_hash: 'done', status: 'Succeeded' }
    const pending = { payment_hash: 'wait', status: 'Pending' }
    const inflight = { payment_hash: 'inflight', htlc_status: 'InFlight' }
    const claimable = { payment_hash: 'claimable', status: 'Claimable' }
    const claiming = { payment_hash: 'claiming', status: 'Claiming' }
    const account = makeAccount({ node: makeNode({ listPayments: () => [completed, pending, inflight, claimable, claiming] }) })
    await expect(account.getTransactionReceipt('done')).resolves.toBe(completed)
    await expect(account.getTransactionReceipt('wait')).resolves.toBeNull()
    await expect(account.getTransactionReceipt('inflight')).resolves.toBeNull()
    await expect(account.getTransactionReceipt('claimable')).resolves.toBeNull()
    await expect(account.getTransactionReceipt('claiming')).resolves.toBeNull()
  })

  it('handles absent receipt wrappers and unsettled transfer statuses as null', async () => {
    const account = makeAccount({
      node: makeNode({
        listTransactionsByTxid: () => ({}),
        listTransfersByTxid: () => ({ transfers: [{ txid: 'rgbtx' }] }),
        listPayments: () => ({ payments: [] })
      })
    })
    await expect(account.getTransactionReceipt('rgbtx')).resolves.toBeNull()
    await expect(account.getTransactionReceipt('missing')).resolves.toBeNull()
  })

  it('returns null when the hash is absent from every read model', async () => {
    await expect(makeAccount().getTransactionReceipt('nope')).resolves.toBeNull()
  })

  it('does not hide transaction-query failures', async () => {
    const account = makeAccount({
      node: makeNode({ listTransactionsByTxid: () => { throw new Error('indexer unavailable') } })
    })
    await expect(account.getTransactionReceipt('abc')).rejects.toThrow('indexer unavailable')
  })
})

describe('WDK account properties', () => {
  it('returns index, path, and the node id as a Uint8Array keyPair', () => {
    const account = makeAccount({ bootstrap: () => ({ node_id: 'aabbcc' }) })
    expect(account.index).toBe(0)
    expect(account.path).toBe('m')
    const kp = account.keyPair
    expect(kp.publicKey).toEqual(Uint8Array.from([0xaa, 0xbb, 0xcc]))
    expect(kp.privateKey).toBeNull()
    expect(account.getKeyPair()).toEqual(kp)
  })

  it('throws when bootstrap has no node_id', () => {
    const account = makeAccount({ bootstrap: () => ({}) })
    expect(() => account.getKeyPair()).toThrow(/did not return a node_id/)
  })

  it('throws when bootstrap returns null', () => {
    const account = makeAccount({ bootstrap: () => null })
    expect(() => account.getKeyPair()).toThrow(/did not return a node_id/)
  })
})

describe('getLspConfig', () => {
  it('reads lspBaseUrl / lspBearerToken from binding._config', () => {
    const account = makeAccount({ _config: { lspBaseUrl: 'https://lsp', lspBearerToken: 'tok' } })
    expect(account.getLspConfig()).toEqual({ baseUrl: 'https://lsp', bearerToken: 'tok' })
  })

  it('returns nulls when config is absent', () => {
    const account = makeAccount()
    expect(account.getLspConfig()).toEqual({ baseUrl: null, bearerToken: null })
  })

  it('returns nulls when individual fields are absent', () => {
    const account = makeAccount({ _config: {} })
    expect(account.getLspConfig()).toEqual({ baseUrl: null, bearerToken: null })
  })
})

describe('createLsp', () => {
  it('returns a UtexoLsp for an explicit peer without auto-discovery', async () => {
    const account = makeAccount()
    const peer = {
      baseUrl: 'https://lsp.example',
      peerPubkey: 'pk',
      peerHost: 'lsp.example',
      peerPort: 9735
    }
    const lsp = await account.createLsp(peer)
    expect(lsp).toBeTruthy()
    expect(lsp.peer).toBe(peer)
    expect(lsp.account).toBe(account)
  })

  it('throws when no peer is given and lspBaseUrl is not configured', async () => {
    const account = makeAccount()
    await expect(account.createLsp()).rejects.toThrow(/lspBaseUrl not set/)
  })

  it('auto-discovers the peer from lspBaseUrl via GET /get_info', async () => {
    // No-arg form: pubkey from /get_info, host from the base URL hostname,
    // port from the peerPort default (9735). Real LSP /get_info returns the
    // node pubkey (hex 33-byte compressed key); stub getInfo so no network.
    const getInfoSpy = jest.spyOn(LspClient.prototype, 'getInfo')
      .mockResolvedValue({ pubkey: 'ab'.repeat(33), num_channels: 4 })
    try {
      const account = makeAccount({
        _config: { lspBaseUrl: 'https://lsp.example:8443/api', lspBearerToken: 'tok' }
      })
      const lsp = await account.createLsp()
      expect(lsp).toBeInstanceOf(UtexoLsp)
      expect(lsp.account).toBe(account)
      // peer must be assembled from /get_info + base URL hostname + default port.
      expect(lsp.peer).toEqual({
        baseUrl: 'https://lsp.example:8443/api',
        peerPubkey: 'ab'.repeat(33),
        peerHost: 'lsp.example',
        peerPort: 9735,
        bearerToken: 'tok'
      })
      expect(getInfoSpy).toHaveBeenCalledTimes(1)
    } finally {
      getInfoSpy.mockRestore()
    }
  })

  it('honours an explicit peerPort override in the no-arg form', async () => {
    const getInfoSpy = jest.spyOn(LspClient.prototype, 'getInfo')
      .mockResolvedValue({ pubkey: 'cd'.repeat(33) })
    try {
      const account = makeAccount({ _config: { lspBaseUrl: 'https://lsp.example' } })
      const lsp = await account.createLsp(undefined, 9999)
      expect(lsp.peer.peerPort).toBe(9999)
      expect(lsp.peer.peerHost).toBe('lsp.example')
      // No bearer token configured → undefined, not null/'' .
      expect(lsp.peer.bearerToken).toBeUndefined()
    } finally {
      getInfoSpy.mockRestore()
    }
  })

  it('throws when /get_info returns no pubkey', async () => {
    const getInfoSpy = jest.spyOn(LspClient.prototype, 'getInfo')
      .mockResolvedValue({ num_channels: 0 })
    try {
      const account = makeAccount({ _config: { lspBaseUrl: 'https://lsp.example' } })
      await expect(account.createLsp()).rejects.toThrow(/returned no pubkey/)
    } finally {
      getInfoSpy.mockRestore()
    }
  })
})

describe('bootstrapLsp', () => {
  it('throws TypeError when peerPubkeyAndAddr is missing', async () => {
    const account = makeAccount()
    await expect(account.bootstrapLsp({})).rejects.toBeInstanceOf(TypeError)
    await expect(account.bootstrapLsp()).rejects.toBeInstanceOf(TypeError)
  })

  it('throws TypeError when peerPubkeyAndAddr is not a string', async () => {
    const account = makeAccount()
    await expect(account.bootstrapLsp({ peerPubkeyAndAddr: 123 })).rejects.toBeInstanceOf(TypeError)
  })

  it('treats the whole string as the pubkey when no @ separator is present', async () => {
    // No '@' → peerPubkey is the full string; we just exercise the
    // connect + (immediate, waitForPeerMs:0) poll path without hanging.
    const account = makeAccount()
    account.connectPeer = jest.fn(async () => ({ ok: true }))
    account.listPeers = jest.fn(async () => ({ peers: [] }))
    const res = await account.bootstrapLsp({ peerPubkeyAndAddr: 'BAREPUBKEY', waitForPeerMs: 0 })
    expect(res).toEqual({ connect: { ok: true }, peerVisible: false })
    expect(account.connectPeer).toHaveBeenCalledWith('BAREPUBKEY')
  })

  it('treats a leading-@ string as a full pubkey (atIdx>0, not >=0) without throwing', async () => {
    // '@host' → indexOf('@') === 0. The guard is `atIdx > 0`, so the
    // condition is FALSE and peerPubkey becomes the FULL string '@host'
    // (non-empty → no TypeError). If the guard were `atIdx >= 0`, the
    // slice(0,0) would yield '' and trip the second `length === 0` guard,
    // throwing 'must be in pubkey@host:port form'. So this must NOT throw,
    // and the empty matcher means no peer is ever found.
    const account = makeAccount()
    account.connectPeer = jest.fn(async () => ({ ok: true }))
    const listPeers = jest.fn(async () => ({ peers: [{ pubkey: '@host' }] }))
    account.listPeers = listPeers
    const res = await account.bootstrapLsp({ peerPubkeyAndAddr: '@host', waitForPeerMs: 1000 })
    // peerVisible true confirms the matcher compared against the full
    // '@host' pubkey — only possible if peerPubkey === '@host', i.e. the
    // `atIdx > 0` (false) branch was taken.
    expect(res).toEqual({ connect: { ok: true }, peerVisible: true })
    expect(account.connectPeer).toHaveBeenCalledWith('@host')
  })

  it('connects and reports peerVisible when listPeers shows the peer immediately', async () => {
    const account = makeAccount()
    account.connectPeer = jest.fn(async () => ({ ok: true }))
    account.listPeers = jest.fn(async () => ({ peers: [{ pubkey: 'PK' }] }))
    const apaySpy = jest.fn()
    account.apayNew = apaySpy
    const res = await account.bootstrapLsp({ peerPubkeyAndAddr: 'PK@host:9735', waitForPeerMs: 1000 })
    expect(res).toEqual({ connect: { ok: true }, peerVisible: true })
    expect(account.connectPeer).toHaveBeenCalledWith('PK@host:9735')
    expect(apaySpy).not.toHaveBeenCalled()
  })

  it('accepts a bare-array listPeers shape', async () => {
    const account = makeAccount()
    account.connectPeer = jest.fn(async () => ({ ok: true }))
    account.listPeers = jest.fn(async () => [{ pubkey: 'PK' }])
    const res = await account.bootstrapLsp({ peerPubkeyAndAddr: 'PK@host:9735', waitForPeerMs: 1000 })
    expect(res.peerVisible).toBe(true)
  })

  it('calls apayNew when hostNodeId is set and the peer is visible', async () => {
    const account = makeAccount()
    account.connectPeer = jest.fn(async () => ({ ok: true }))
    account.listPeers = jest.fn(async () => ({ peers: [{ pubkey: 'PK' }] }))
    account.apayNew = jest.fn(async () => ({ order_id: 'o9' }))
    const res = await account.bootstrapLsp({
      peerPubkeyAndAddr: 'PK@host:9735',
      hostNodeId: 'host',
      waitForPeerMs: 1000
    })
    expect(res).toEqual({ connect: { ok: true }, peerVisible: true, apay: { order_id: 'o9' } })
    expect(account.apayNew).toHaveBeenCalledWith('host')
  })

  it('throws ApayError when hostNodeId is set but the peer never appears', async () => {
    const account = makeAccount()
    account.connectPeer = jest.fn(async () => ({ ok: true }))
    account.listPeers = jest.fn(async () => ({ peers: [] }))
    account.apayNew = jest.fn()
    const err = await account.bootstrapLsp({
      peerPubkeyAndAddr: 'PK@host:9735',
      hostNodeId: 'host',
      waitForPeerMs: 0
    }).catch((e) => e)
    expect(err).toBeInstanceOf(ApayError)
    expect(err.code).toBe('APAY_PEER_NOT_VISIBLE')
    expect(account.apayNew).not.toHaveBeenCalled()
  })

  it('returns peerVisible:false (no apay) when peer absent and no hostNodeId', async () => {
    const account = makeAccount()
    account.connectPeer = jest.fn(async () => ({ ok: true }))
    account.listPeers = jest.fn(async () => ({ peers: [] }))
    const res = await account.bootstrapLsp({ peerPubkeyAndAddr: 'PK@host:9735', waitForPeerMs: 0 })
    expect(res).toEqual({ connect: { ok: true }, peerVisible: false })
  })

  it('keeps polling until the peer appears on a later poll', async () => {
    const account = makeAccount()
    account.connectPeer = jest.fn(async () => ({ ok: true }))
    let calls = 0
    account.listPeers = jest.fn(async () => {
      calls += 1
      return calls >= 2 ? { peers: [{ pubkey: 'PK' }] } : { peers: [] }
    })
    const res = await account.bootstrapLsp({
      peerPubkeyAndAddr: 'PK@host:9735',
      waitForPeerMs: 5000,
      pollIntervalMs: 100
    })
    expect(res.peerVisible).toBe(true)
    expect(calls).toBeGreaterThanOrEqual(2)
  })

  it('clamps the poll interval to a 100ms floor for sub-floor pollIntervalMs', async () => {
    // The source clamps: pollMs = Math.max(100, Number(pollIntervalMs) || 1000).
    // Passing pollIntervalMs:1 (below the floor) must produce a 100ms gap
    // between polls. Under a lowered floor (e.g. Math.max(10, …)) the second
    // poll would already have fired by t=50ms — so we pin the exact 100ms.
    jest.useFakeTimers()
    try {
      const account = makeAccount()
      account.connectPeer = jest.fn(async () => ({ ok: true }))
      // Never returns the peer → polling continues for the whole window.
      account.listPeers = jest.fn(async () => ({ peers: [] }))
      const p = account.bootstrapLsp({
        peerPubkeyAndAddr: 'PK@host:9735',
        waitForPeerMs: 1000,
        pollIntervalMs: 1
      })
      // Let the first (immediate, t=0) poll run.
      await Promise.resolve()
      await Promise.resolve()
      expect(account.listPeers).toHaveBeenCalledTimes(1)
      // Advance well past a 10ms floor but short of the real 100ms floor:
      // with the correct floor NO new poll has fired yet.
      await jest.advanceTimersByTimeAsync(50)
      expect(account.listPeers).toHaveBeenCalledTimes(1)
      // Reaching exactly 100ms triggers the second poll.
      await jest.advanceTimersByTimeAsync(50)
      expect(account.listPeers).toHaveBeenCalledTimes(2)
      // Drain the remaining window so the promise settles cleanly.
      await jest.advanceTimersByTimeAsync(1000)
      const res = await p
      expect(res.peerVisible).toBe(false)
    } finally {
      jest.useRealTimers()
    }
  })

  it('tolerates a listPeers rejection during polling', async () => {
    const account = makeAccount()
    account.connectPeer = jest.fn(async () => ({ ok: true }))
    account.listPeers = jest.fn(async () => { throw new Error('rpc down') })
    const res = await account.bootstrapLsp({ peerPubkeyAndAddr: 'PK@host:9735', waitForPeerMs: 0 })
    expect(res.peerVisible).toBe(false)
  })
})

describe('LSP helper passthroughs', () => {
  it('payLightningAddress / requestLspRgbDeposit / payRgbViaLsp are callable methods', () => {
    const account = makeAccount()
    expect(typeof account.payLightningAddress).toBe('function')
    expect(typeof account.requestLspRgbDeposit).toBe('function')
    expect(typeof account.payRgbViaLsp).toBe('function')
  })

  it('payLightningAddress forwards to the helper (rejects on a malformed address)', async () => {
    const account = makeAccount()
    // A malformed Lightning Address rejects early in the helper's
    // resolveAddressToInvoice — no network reached; the passthrough
    // line still executes.
    await expect(account.payLightningAddress('not-an-address', 1000n)).rejects.toBeDefined()
  })

  it('requestLspRgbDeposit forwards to the helper (rejects when rgb params missing)', async () => {
    const account = makeAccount()
    await expect(account.requestLspRgbDeposit({})).rejects.toBeInstanceOf(TypeError)
  })

  it('payRgbViaLsp forwards to the helper (rejects when rgbInvoice missing)', async () => {
    const account = makeAccount()
    await expect(account.payRgbViaLsp({ rgbInvoice: '' })).rejects.toBeInstanceOf(TypeError)
  })
})

describe('dispose', () => {
  it('is a no-op that does not throw', () => {
    const account = makeAccount()
    expect(account.dispose()).toBeUndefined()
  })
})

describe('toReadOnlyAccount / ReadOnlyRgbLightningAccount', () => {
  it('returns a cached WDK read-only account with no mutating capability', async () => {
    const account = makeAccount({ node: makeNode({ address: () => ({ address: 'tb1qro' }) }) })
    const ro = await account.toReadOnlyAccount()
    expect(ro).toBeInstanceOf(WalletAccountReadOnlyRgbLightning)
    expect(ro).toBeInstanceOf(WalletAccountReadOnly)
    expect(await account.toReadOnlyAccount()).toBe(ro)
    expect(ro).not.toHaveProperty('_account')
    for (const method of ['sign', 'sendTransaction', 'sendBtc', 'transfer', 'unlock', 'shutdown', 'openChannel', 'connectPeer', 'clearVssFence', 'getLspConfig']) {
      expect(ro[method]).toBeUndefined()
    }
    await expect(ro.getAddress()).resolves.toBe('tb1qro')
  })

  it('getAddress wraps a synchronous string result in a Promise', async () => {
    const account = makeAccount({ node: makeNode({ address: () => 'tb1qsync' }) })
    const ro = await account.toReadOnlyAccount()
    const p = ro.getAddress()
    expect(p).toBeInstanceOf(Promise)
    await expect(p).resolves.toBe('tb1qsync')
  })

  it('verify forwards to the native verifier and returns its boolean', async () => {
    const verifyMessage = jest.fn(() => ({ valid: false }))
    const account = makeAccount({ node: makeNode({ verifyMessage }) })
    const ro = await account.toReadOnlyAccount()
    await expect(ro.verify('m', 's')).resolves.toBe(false)
    expect(verifyMessage).toHaveBeenCalledWith('m', 's')
  })

  it('verify accepts a bare boolean result from older native bindings', async () => {
    const account = makeAccount({ node: makeNode({ verifyMessage: () => true }) })
    const ro = await account.toReadOnlyAccount()
    await expect(ro.verify('m', 's')).resolves.toBe(true)
  })

  it('verify reports the pre-unlock state with AccountLockedError', async () => {
    const account = makeAccount({
      node: makeNode({ verifyMessage: () => { throw new Error('SdkNode not created — call unlock() first') } })
    })
    const ro = await account.toReadOnlyAccount()
    await expect(ro.verify('m', 's')).rejects.toBeInstanceOf(AccountLockedError)
  })

  it('verify validates inputs and propagates non-lock native verifier errors', async () => {
    const ro = await makeAccount().toReadOnlyAccount()
    await expect(ro.verify(123, 'sig')).rejects.toThrow('requires a string message')
    await expect(ro.verify('m', '')).rejects.toThrow('requires a non-empty signature')

    const account = makeAccount({ node: makeNode({ verifyMessage: () => { throw new Error('bad signature encoding') } }) })
    const failingRo = await account.toReadOnlyAccount()
    await expect(failingRo.verify('m', 'sig')).rejects.toThrow('bad signature encoding')
  })

  it('getBalance returns a BigInt of the account satoshi string', async () => {
    const account = makeAccount({
      node: makeNode({ btcBalance: () => ({ vanilla: { spendable: 5050 } }) })
    })
    const ro = await account.toReadOnlyAccount()
    const bal = await ro.getBalance()
    expect(bal).toBe(5050n)
    expect(typeof bal).toBe('bigint')
  })

  it('getTokenBalance prefers spendable and returns a bigint', async () => {
    const account = makeAccount({ node: makeNode({ assetBalance: () => ({ spendable: 8, settled: 9 }) }) })
    const ro = await account.toReadOnlyAccount()
    await expect(ro.getTokenBalance('aid')).resolves.toBe(8n)
  })

  it('getTokenBalance falls back to settled when spendable is absent', async () => {
    const account = makeAccount({ node: makeNode({ assetBalance: () => ({ settled: 4 }) }) })
    const ro = await account.toReadOnlyAccount()
    await expect(ro.getTokenBalance('aid')).resolves.toBe(4n)
  })

  it('getTokenBalance defaults to 0n when neither field present', async () => {
    const account = makeAccount({ node: makeNode({ assetBalance: () => ({}) }) })
    const ro = await account.toReadOnlyAccount()
    await expect(ro.getTokenBalance('aid')).resolves.toBe(0n)
  })

  it('read-only query methods apply their WDK default skipSync values', async () => {
    const node = makeNode()
    const ro = await makeAccount({ node }).toReadOnlyAccount()
    await ro.getBalanceDetails()
    await ro.getTransactions()
    await ro.getTransactionsByTxid('txid')
    await ro.listUnspents()
    expect(node.btcBalance).toHaveBeenLastCalledWith(false)
    expect(node.listTransactions).toHaveBeenLastCalledWith(false)
    expect(node.listTransactionsByTxid).toHaveBeenLastCalledWith('txid', false)
    expect(node.listUnspents).toHaveBeenLastCalledWith(false)
  })

  it('quoteSendTransaction operates independently through the read adapter', async () => {
    const account = makeAccount({ node: makeNode({ estimateFee: () => ({ fee_rate: 4 }) }) })
    const ro = await account.toReadOnlyAccount()
    await expect(ro.quoteSendTransaction({})).resolves.toEqual({ fee: BigInt(4 * 141) })
  })

  it('quoteSendTransaction accepts its default transaction object', async () => {
    const account = makeAccount({ node: makeNode({ estimateFee: () => ({ fee_rate: 4 }) }) })
    const ro = await account.toReadOnlyAccount()
    await expect(ro.quoteSendTransaction()).resolves.toEqual({ fee: BigInt(4 * 141) })
  })

  it('quoteTransfer proxies to the account quote (LN bolt11 form)', async () => {
    const account = makeAccount()
    const ro = await account.toReadOnlyAccount()
    const res = await ro.quoteTransfer({ recipient: 'lnbc1abc', amount: 1000000 })
    // LN_FEE_BPS = 50 → ceil(1_000_000 * 50 / 10000) = 5000.
    expect(res).toEqual({ fee: 5000n })
  })

  it('quoteTransfer LN ln-pubkey form also uses the bps fee, not the on-chain rate', async () => {
    // 66-hex → classified ln-pubkey → same LN bps branch (not on-chain).
    const account = makeAccount()
    const ro = await account.toReadOnlyAccount()
    const res = await ro.quoteTransfer({ recipient: 'ab'.repeat(33), amount: 2000000 })
    // ceil(2_000_000 * 50 / 10000) = 10000.
    expect(res).toEqual({ fee: 10000n })
  })

  it('quoteTransfer LN form floors the fee at 1 for tiny amounts', async () => {
    // Math.max(1, …): amount 1 → ceil(1*50/10000)=ceil(0.005)=1 already, but
    // amount 0 → ceil(0)=0 → floored to 1. Pins the Math.max(1, …) guard.
    const account = makeAccount()
    const ro = await account.toReadOnlyAccount()
    const res = await ro.quoteTransfer({ recipient: 'lnbc1abc', amount: 0 })
    expect(res).toEqual({ fee: 1n })
  })

  it('quoteTransfer treats an omitted Lightning amount as zero and still returns the minimum fee', async () => {
    const ro = await makeAccount().toReadOnlyAccount()
    await expect(ro.quoteTransfer({ recipient: 'lnbc1abc' })).resolves.toEqual({ fee: 1n })
  })

  it('quoteTransfer treats an omitted on-chain amount as zero for fee estimation', async () => {
    const account = makeAccount({ node: makeNode({ estimateFee: () => ({ fee_rate: 2 }) }) })
    const ro = await account.toReadOnlyAccount()
    await expect(ro.quoteTransfer({ recipient: 'tb1qsomeaddress' })).resolves.toEqual({ fee: BigInt(2 * 141) })
  })

  it('quoteTransfer on-chain (btc-address) uses estimateFee rate × 141 vbytes', async () => {
    // btc-address branch (lines 964-966): rate × APPROX_BTC_TX_VBYTES.
    const account = makeAccount({ node: makeNode({ estimateFee: () => ({ fee_rate: 7 }) }) })
    const ro = await account.toReadOnlyAccount()
    const res = await ro.quoteTransfer({ recipient: 'tb1qsomeaddress', amount: 50000 })
    expect(res).toEqual({ fee: BigInt(7 * 141) })
  })

  it('quoteTransfer RGB invoice routes through the on-chain quote', async () => {
    // RGB invoices settle on-chain → same rate × 141 path, NOT the LN bps.
    const account = makeAccount({ node: makeNode({ estimateFee: () => ({ fee_rate: 3 }) }) })
    const ro = await account.toReadOnlyAccount()
    const res = await ro.quoteTransfer({ recipient: 'rgb:abc123', amount: 50000 })
    expect(res).toEqual({ fee: BigInt(3 * 141) })
  })

  it('quoteTransfer rejects invalid and negative amounts before quoting', async () => {
    const ro = await makeAccount().toReadOnlyAccount()
    await expect(ro.quoteTransfer({ recipient: 'lnbc1abc', amount: 'not-a-number' })).rejects.toThrow('amount must be an integer')
    await expect(ro.quoteTransfer({ recipient: 'lnbc1abc', amount: -1 })).rejects.toThrow('amount must not be negative')
  })

  it('listTransfers requires a concrete RGB asset id', async () => {
    const ro = await makeAccount().toReadOnlyAccount()
    await expect(ro.listTransfers('')).rejects.toThrow('requires a non-empty RGB asset id')
  })

  it('getTransactionReceipt uses the read-only txid query', async () => {
    const hit = { txid: 'roTx', confirmation_time: { height: 1, timestamp: 2 } }
    const account = makeAccount({
      node: makeNode({ listTransactionsByTxid: () => ({ transactions: [hit] }) })
    })
    const ro = await account.toReadOnlyAccount()
    await expect(ro.getTransactionReceipt('roTx')).resolves.toBe(hit)
  })
})
