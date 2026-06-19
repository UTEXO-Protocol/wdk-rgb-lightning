// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.

// Surface coverage for WalletAccountRgbLightning + the read-only façade
// it returns from toReadOnlyAccount(). Most methods are 1-line
// passthroughs to this._node.<x>() (the _node getter returns
// this._binding.node) or this._binding.<x>(); these tests assert each
// account method forwards to the right node/binding method with the
// right args and maps the result as documented.
//
// transfer/quoteTransfer, _classifyRecipient, verify/signTransaction,
// and vssStatus/clearVssFence/vssBackup are covered by other suites and
// are NOT re-tested here.

import { jest } from '@jest/globals'
import WalletAccountRgbLightning, {
  PENDING_ADDRESS
} from '../src/wallet-account-rgb-lightning.js'
import { UnlockError, ApayError, NotImplementedError } from '../src/errors.js'

// Build a fake RLN node whose methods are jest.fn returning canned
// values. Every method the account forwards to is present so we can
// assert forwarding + arg pass-through.
function makeNode (overrides = {}) {
  return {
    nodeInfo: jest.fn(() => ({ pubkey: 'np' })),
    networkInfo: jest.fn(() => ({ height: 100 })),
    sync: jest.fn(() => undefined),
    address: jest.fn(() => ({ address: 'tb1qreal' })),
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
    listUnspents: jest.fn(() => ({ unspents: [] })),
    createUtxos: jest.fn(() => undefined),
    estimateFee: jest.fn(() => ({ fee_rate: 12 })),
    sendOnionMessage: jest.fn(() => undefined),
    signMessage: jest.fn((m) => ({ signature: 'sig:' + m })),
    checkIndexerUrl: jest.fn((u) => ({ ok: true, url: u })),
    checkProxyEndpoint: jest.fn(() => undefined),
    ...overrides
  }
}

// Build a fake binding around a node. node-level overrides go via
// `node`; binding-level overrides spread on top.
function makeBinding (overrides = {}) {
  const node = overrides.node ?? makeNode()
  const binding = {
    unlock: jest.fn(() => undefined),
    bootstrap: jest.fn(() => ({ node_id: 'aa'.repeat(33) })),
    shutdown: jest.fn(() => undefined),
    apayNew: jest.fn(() => ({ order_id: 'o1' })),
    ...overrides
  }
  // Ensure the binding's `node` getter target is the resolved node even
  // when overrides supplied one (or none).
  binding.node = node
  return binding
}

function makeAccount (bindingOverrides = {}) {
  return new WalletAccountRgbLightning({ binding: makeBinding(bindingOverrides) })
}

describe('construction', () => {
  it('throws when no binding is provided', () => {
    expect(() => new WalletAccountRgbLightning()).toThrow(/requires a BareRgbLightningBinding/)
    expect(() => new WalletAccountRgbLightning({})).toThrow(/requires a BareRgbLightningBinding/)
  })

  it('exposes the node via the _binding.node getter', () => {
    const node = makeNode()
    const account = makeAccount({ node })
    expect(account._node).toBe(node)
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

  it('getBootstrap returns the binding bootstrap dictionary', async () => {
    const boot = { node_id: 'bb', account_xpubs: [] }
    const account = makeAccount({ bootstrap: () => boot })
    await expect(account.getBootstrap()).resolves.toBe(boot)
  })

  it('shutdown calls the binding and returns { ok: true }', async () => {
    const shutdown = jest.fn()
    const account = makeAccount({ shutdown })
    await expect(account.shutdown()).resolves.toEqual({ ok: true })
    expect(shutdown).toHaveBeenCalledTimes(1)
  })
})

describe('apayNew', () => {
  it('forwards to the binding and returns the order response', async () => {
    const apayNew = jest.fn(() => ({ order_id: 'X' }))
    const account = makeAccount({ apayNew })
    await expect(account.apayNew('host')).resolves.toEqual({ order_id: 'X' })
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
  it('returns the .address field when node.address returns an object', () => {
    const account = makeAccount({ node: makeNode({ address: () => ({ address: 'tb1qabc' }) }) })
    expect(account.getAddress()).toBe('tb1qabc')
  })

  it('returns the string directly when node.address returns a string', () => {
    const account = makeAccount({ node: makeNode({ address: () => 'tb1qstr' }) })
    expect(account.getAddress()).toBe('tb1qstr')
  })

  it('returns PENDING_ADDRESS when node.address throws', () => {
    const account = makeAccount({ node: makeNode({ address: () => { throw new Error('NotInitialized') } }) })
    expect(account.getAddress()).toBe(PENDING_ADDRESS)
  })

  it('returns PENDING_ADDRESS when node.address returns an empty string', () => {
    const account = makeAccount({ node: makeNode({ address: () => '' }) })
    expect(account.getAddress()).toBe(PENDING_ADDRESS)
  })

  it('returns PENDING_ADDRESS when node.address returns an object without .address', () => {
    const account = makeAccount({ node: makeNode({ address: () => ({}) }) })
    expect(account.getAddress()).toBe(PENDING_ADDRESS)
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
    await expect(account.getPayment('h', 'sent')).resolves.toEqual({ payment_hash: 'h', type: 'sent' })
    expect(node.getPayment).toHaveBeenCalledWith('h', 'sent')
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
  it('getBalance parses vanilla.spendable to a string', async () => {
    const account = makeAccount({
      node: makeNode({ btcBalance: () => ({ vanilla: { spendable: 4242, settled: 100 } }) })
    })
    await expect(account.getBalance()).resolves.toBe('4242')
  })

  it('getBalance falls back to vanilla.settled when spendable is absent', async () => {
    const account = makeAccount({
      node: makeNode({ btcBalance: () => ({ vanilla: { settled: 77 } }) })
    })
    await expect(account.getBalance()).resolves.toBe('77')
  })

  it('getBalance returns "0" when node.btcBalance throws', async () => {
    const account = makeAccount({
      node: makeNode({ btcBalance: () => { throw new Error('NotInitialized') } })
    })
    await expect(account.getBalance()).resolves.toBe('0')
  })

  it('getBalance forwards the skipSync flag', async () => {
    const btcBalance = jest.fn(() => ({ vanilla: { spendable: 1 } }))
    const account = makeAccount({ node: makeNode({ btcBalance }) })
    await account.getBalance(true)
    expect(btcBalance).toHaveBeenCalledWith(true)
  })

  it('getBalanceDetails forwards to node.btcBalance with coerced skipSync', async () => {
    const btcBalance = jest.fn(() => ({ vanilla: { spendable: 5 } }))
    const account = makeAccount({ node: makeNode({ btcBalance }) })
    await expect(account.getBalanceDetails(true)).resolves.toEqual({ vanilla: { spendable: 5 } })
    expect(btcBalance).toHaveBeenCalledWith(true)
  })

  it('sendTransaction forwards to node.sendBtc', async () => {
    const node = makeNode()
    const account = makeAccount({ node })
    const req = { address: 'tb1q', amount: 1000 }
    await expect(account.sendTransaction(req)).resolves.toMatchObject({ txid: 'btctx' })
    expect(node.sendBtc).toHaveBeenCalledWith(req)
  })

  it('getTransactions forwards to node.listTransactions with coerced skipSync', async () => {
    const listTransactions = jest.fn(() => ({ transactions: [] }))
    const account = makeAccount({ node: makeNode({ listTransactions }) })
    await account.getTransactions(true)
    expect(listTransactions).toHaveBeenCalledWith(true)
  })

  it('listUnspents forwards to node.listUnspents', async () => {
    const listUnspents = jest.fn(() => ({ unspents: [] }))
    const account = makeAccount({ node: makeNode({ listUnspents }) })
    await expect(account.listUnspents(false)).resolves.toEqual({ unspents: [] })
    expect(listUnspents).toHaveBeenCalledWith(false)
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
    await expect(account.sign('hello')).resolves.toEqual({ signature: 'sig:hello' })
    expect(node.signMessage).toHaveBeenCalledWith('hello')
  })

  it('checkIndexerUrl forwards the url', async () => {
    const node = makeNode()
    const account = makeAccount({ node })
    await expect(account.checkIndexerUrl('http://idx')).resolves.toEqual({ ok: true, url: 'http://idx' })
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
})

describe('_defaultFeeRate', () => {
  it('reads fee_rate from estimateFee', async () => {
    const account = makeAccount({ node: makeNode({ estimateFee: () => ({ fee_rate: 9 }) }) })
    await expect(account._defaultFeeRate(6)).resolves.toBe(9)
  })

  it('reads feerate alias', async () => {
    const account = makeAccount({ node: makeNode({ estimateFee: () => ({ feerate: 8 }) }) })
    await expect(account._defaultFeeRate(6)).resolves.toBe(8)
  })

  it('accepts a bare numeric estimateFee result', async () => {
    const account = makeAccount({ node: makeNode({ estimateFee: () => 3 }) })
    await expect(account._defaultFeeRate(6)).resolves.toBe(3)
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

  it('finds an on-chain tx via getTransactions ({ transactions })', async () => {
    const hit = { txid: 'abc', confirmations: 3 }
    const account = makeAccount({
      node: makeNode({ listTransactions: () => ({ transactions: [{ txid: 'zzz' }, hit] }) })
    })
    await expect(account.getTransactionReceipt('abc')).resolves.toBe(hit)
  })

  it('finds an on-chain tx when getTransactions returns a bare array', async () => {
    const hit = { txid: 'def' }
    const account = makeAccount({
      node: makeNode({ listTransactions: () => [hit] })
    })
    await expect(account.getTransactionReceipt('def')).resolves.toBe(hit)
  })

  it('falls back to a sent LN payment when not found on-chain', async () => {
    const sent = { payment_hash: 'ph1', amt_msat: 1 }
    const account = makeAccount({
      node: makeNode({
        listTransactions: () => ({ transactions: [] }),
        getPayment: (h, t) => (t === 'sent' ? sent : null)
      })
    })
    await expect(account.getTransactionReceipt('ph1')).resolves.toBe(sent)
  })

  it('falls back to a received LN payment when not sent', async () => {
    const recv = { payment_hash: 'ph2' }
    const account = makeAccount({
      node: makeNode({
        listTransactions: () => ({ transactions: [] }),
        getPayment: (h, t) => {
          if (t === 'sent') throw new Error('not a sent payment')
          return recv
        }
      })
    })
    await expect(account.getTransactionReceipt('ph2')).resolves.toBe(recv)
  })

  it('returns null when found nowhere', async () => {
    const account = makeAccount({
      node: makeNode({
        listTransactions: () => ({ transactions: [] }),
        getPayment: () => { throw new Error('not found') }
      })
    })
    await expect(account.getTransactionReceipt('nope')).resolves.toBeNull()
  })

  it('continues to LN lookup when getTransactions itself throws', async () => {
    const sent = { payment_hash: 'ph3' }
    const account = makeAccount({
      node: makeNode({
        listTransactions: () => { throw new Error('boom') },
        getPayment: (h, t) => (t === 'sent' ? sent : null)
      })
    })
    await expect(account.getTransactionReceipt('ph3')).resolves.toBe(sent)
  })
})

describe('getKeyPair', () => {
  it('returns the node_id as a Buffer publicKey with null privateKey', () => {
    const account = makeAccount({ bootstrap: () => ({ node_id: 'aabbcc' }) })
    const kp = account.getKeyPair()
    expect(kp.publicKey).toEqual(Buffer.from('aabbcc', 'hex'))
    expect(kp.privateKey).toBeNull()
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
  it('returns a façade whose getAddress proxies the account', async () => {
    const account = makeAccount({ node: makeNode({ address: () => ({ address: 'tb1qro' }) }) })
    const ro = await account.toReadOnlyAccount()
    await expect(ro.getAddress()).resolves.toBe('tb1qro')
  })

  it('getAddress wraps a synchronous string result in a Promise', async () => {
    const account = makeAccount({ node: makeNode({ address: () => 'tb1qsync' }) })
    const ro = await account.toReadOnlyAccount()
    const p = ro.getAddress()
    expect(p).toBeInstanceOf(Promise)
    await expect(p).resolves.toBe('tb1qsync')
  })

  it('verify rejects with NotImplementedError', async () => {
    const account = makeAccount()
    const ro = await account.toReadOnlyAccount()
    await expect(ro.verify('m', 's')).rejects.toBeInstanceOf(NotImplementedError)
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

  it('getTokenBalance returns a BigInt from settled', async () => {
    const account = makeAccount({ node: makeNode({ assetBalance: () => ({ settled: 9 }) }) })
    const ro = await account.toReadOnlyAccount()
    await expect(ro.getTokenBalance('aid')).resolves.toBe(9n)
  })

  it('getTokenBalance falls back to spendable when settled absent', async () => {
    const account = makeAccount({ node: makeNode({ assetBalance: () => ({ spendable: 4 }) }) })
    const ro = await account.toReadOnlyAccount()
    await expect(ro.getTokenBalance('aid')).resolves.toBe(4n)
  })

  it('getTokenBalance defaults to 0n when neither field present', async () => {
    const account = makeAccount({ node: makeNode({ assetBalance: () => ({}) }) })
    const ro = await account.toReadOnlyAccount()
    await expect(ro.getTokenBalance('aid')).resolves.toBe(0n)
  })

  it('quoteSendTransaction proxies to the account quote', async () => {
    const account = makeAccount()
    account._defaultFeeRate = async () => 4
    const ro = await account.toReadOnlyAccount()
    await expect(ro.quoteSendTransaction({})).resolves.toEqual({ fee: BigInt(4 * 141) })
  })

  it('quoteTransfer proxies to the account quote (LN form)', async () => {
    const account = makeAccount()
    const ro = await account.toReadOnlyAccount()
    const res = await ro.quoteTransfer({ recipient: 'lnbc1abc', amount: 1000000 })
    expect(res).toEqual({ fee: BigInt(Math.max(1, Math.ceil(1000000 * 50 / 10000))) })
  })

  it('getTransactionReceipt proxies to the account lookup', async () => {
    const hit = { txid: 'roTx' }
    const account = makeAccount({
      node: makeNode({ listTransactions: () => ({ transactions: [hit] }) })
    })
    const ro = await account.toReadOnlyAccount()
    await expect(ro.getTransactionReceipt('roTx')).resolves.toBe(hit)
  })
})
