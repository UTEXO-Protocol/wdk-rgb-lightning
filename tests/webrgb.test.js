import { jest } from '@jest/globals'
import { WebRgbProvider, WebRgbError, WEBRGB_READ_METHODS } from '../src/webrgb.js'

const ID = 'rgb:asset'
const TXID = 'ab'.repeat(32)
const ASSET = { asset_id: ID, name: 'Asset', ticker: 'TEST', precision: 6 }
const TRANSFER = { idx: 3, status: 'Settled', kind: 'ReceiveBlind', assignments: ['Fungible(10)', 'Fungible(2)'], recipient_id: 'utxob:recipient', txid: TXID }

function deferred () {
  let resolve
  const promise = new Promise(_resolve => { resolve = _resolve })
  return { promise, resolve }
}

function fixture (options = {}, overrides = {}) {
  const wallet = {
    getNetwork: jest.fn(() => 'mainnet'),
    isDisposed: jest.fn(() => false),
    getAddress: jest.fn(async () => 'bc1address'),
    createRgbInvoice: jest.fn(async () => ({ invoice: 'rgb:invoice', recipient_id: 'utxob:recipient', expiration_timestamp: 2000 })),
    listAssets: jest.fn(async () => ({ nia: [ASSET], ifa: null, uda: [], cfa: [], bfa: [] })),
    getAssetBalance: jest.fn(async () => ({ spendable: 12, settled: 12, future: 12 })),
    listTransfers: jest.fn(async () => [TRANSFER]),
    refreshTransfers: jest.fn(async () => ({ transfers: {} })),
    decodeRgbInvoice: jest.fn(async () => ({ asset_id: ID, recipient_id: 'utxob:recipient', assignment: { type: 'Fungible', value: 12 }, expiration_timestamp: null, network: 'mainnet', transport_endpoints: ['rpcs://proxy.example.com'] })),
    ...overrides
  }
  const confirm = jest.fn(async () => true)
  const provider = new WebRgbProvider(wallet, { origin: 'https://example.com', confirm, ...options })
  return { wallet, confirm, provider }
}

const sessionCalls = [
  ['getInfo'], ['getAddress'], ['blindReceive'], ['listAssets'], ['getAssetBalance', ID],
  ['listTransfers', ID], ['getTransferStatus', 3, ID], ['decodeRgbInvoice', 'rgb:invoice']
]

describe('WebRGB session authorization', () => {
  test.each(sessionCalls)('%s requires an approved session', async (method, ...args) => {
    const { provider, wallet, confirm } = fixture()
    await expect(provider[method](...args)).rejects.toMatchObject({ code: 'NOT_ENABLED' })
    expect(confirm).not.toHaveBeenCalled()
    expect(wallet.listAssets).not.toHaveBeenCalled()
    expect(wallet.createRgbInvoice).not.toHaveBeenCalled()
  })

  test('enable coalesces requests and never accepts truthy non-boolean approval', async () => {
    const prompt = deferred()
    const confirm = jest.fn(() => prompt.promise)
    const { provider } = fixture({ confirm })
    const first = provider.enable()
    const second = provider.enable()
    prompt.resolve('yes')
    await expect(first).rejects.toMatchObject({ code: 'USER_REJECTED' })
    await expect(second).rejects.toMatchObject({ code: 'USER_REJECTED' })
    expect(provider.enabled).toBe(false)
    expect(confirm).toHaveBeenCalledTimes(1)
  })

  test('enable and revoke work without opening a native wallet', async () => {
    const { provider, wallet, confirm } = fixture()
    await provider.enable()
    await provider.enable()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(provider.enabled).toBe(true)
    provider.revoke()
    expect(provider.enabled).toBe(false)
    await provider.enable()
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(wallet.getAddress).not.toHaveBeenCalled()
  })

  test.each(['revoke', 'disposed', 'transport', 'network'])('invalidates enable approval after %s', async reason => {
    const prompt = deferred()
    let authorized = true
    const { provider, wallet } = fixture({ confirm: () => prompt.promise, assertAuthorized: () => { if (!authorized) throw new Error('private transport error') } })
    const pending = provider.enable()
    await Promise.resolve()
    if (reason === 'revoke') provider.revoke()
    if (reason === 'disposed') wallet.isDisposed.mockReturnValue(true)
    if (reason === 'transport') authorized = false
    if (reason === 'network') wallet.getNetwork.mockReturnValue('regtest')
    prompt.resolve(true)
    await expect(pending).rejects.toMatchObject({ code: 'NOT_ENABLED' })
    expect(provider.enabled).toBe(false)
  })

  test('does not return pending wallet data after revoke and re-enable', async () => {
    const result = deferred()
    const { provider } = fixture({ sessionApproved: true }, { getAddress: () => result.promise })
    const pending = provider.getAddress()
    provider.revoke()
    await provider.enable()
    result.resolve('bc1private')
    await expect(pending).rejects.toMatchObject({ code: 'NOT_ENABLED' })
  })

  test('revocation during refresh prevents subsequent queries', async () => {
    const refresh = deferred()
    const { provider, wallet } = fixture({ sessionApproved: true }, { refreshTransfers: () => refresh.promise })
    const pending = provider.getTransferStatus(3)
    provider.revoke()
    refresh.resolve({ transfers: {} })
    await expect(pending).rejects.toMatchObject({ code: 'NOT_ENABLED' })
    expect(wallet.listAssets).not.toHaveBeenCalled()
    expect(wallet.listTransfers).not.toHaveBeenCalled()
  })

  test('snapshots origin and callbacks from host options', async () => {
    const options = { origin: 'https://example.com', confirm: jest.fn(async () => true) }
    const { provider } = fixture(options)
    options.origin = 'https://attacker.example'
    const original = options.confirm
    options.confirm = async () => false
    await provider.enable()
    expect(original).toHaveBeenCalledWith({ origin: 'https://example.com', method: 'enable', params: {} })
  })

  test.each(['https://user:pass@example.com', 'https://example.com/path', 'https://example.com/?query=1', 'https://example.com/#hash', 'file:///tmp/test', 'javascript:alert(1)', 'not a URL'])('rejects non-origin %s', origin => {
    expect(() => fixture({ origin })).toThrow(WebRgbError)
  })

  test('rejects invalid options and unknown network', () => {
    expect(() => fixture({ confirm: null })).toThrow(WebRgbError)
    expect(() => fixture({ sessionApproved: 'yes' })).toThrow(WebRgbError)
    expect(() => fixture({ assertAuthorized: false })).toThrow(WebRgbError)
    expect(() => fixture({}, { getNetwork: () => undefined })).toThrow(WebRgbError)
    expect(() => new WebRgbProvider({}, {})).toThrow(WebRgbError)
  })
})

describe('WebRGB native mappings', () => {
  test('advertises exactly the read/receive subset, never burn, send or Lightning', async () => {
    const { provider } = fixture({ sessionApproved: true })
    expect(await provider.getInfo()).toEqual({ ready: true, network: 'mainnet', protocol: 'RGB_LN', methods: [...WEBRGB_READ_METHODS] })
    for (const method of WEBRGB_READ_METHODS) expect(typeof provider[method]).toBe('function')
    expect(provider.burnAsset).toBeUndefined()
    expect(provider.sendAsset).toBeUndefined()
    expect(provider.makeLnInvoice).toBeUndefined()
    expect(Object.isFrozen(WEBRGB_READ_METHODS)).toBe(true)
    const info = await provider.getInfo()
    info.methods.push('burnAsset')
    expect((await provider.getInfo()).methods).not.toContain('burnAsset')
  })

  test('maps blind receive with approval, immutable params and a confirmation floor', async () => {
    const { provider, wallet, confirm } = fixture({ sessionApproved: true })
    const result = await provider.blindReceive({ assetId: ID, amount: 12, minConfirmations: 0 })
    expect(result).toEqual({ invoice: 'rgb:invoice', recipientId: 'utxob:recipient', expirationTimestamp: 2000, minConfirmations: 3 })
    expect(wallet.createRgbInvoice).toHaveBeenCalledWith({ asset_id: ID, assignment_kind: 'Fungible', assignment_amount: 12, duration_seconds: 3600, min_confirmations: 3, witness: false })
    expect(confirm.mock.calls[0][0].method).toBe('blindReceive')
    expect(Object.isFrozen(confirm.mock.calls[0][0].params)).toBe(true)
    expect(Object.isFrozen(confirm.mock.calls[0][0])).toBe(true)
  })

  test('unknown-asset receive uses Any and preserves a higher floor', async () => {
    const { provider, wallet } = fixture({ sessionApproved: true, minConfirmations: 6 })
    await provider.blindReceive()
    expect(wallet.createRgbInvoice).toHaveBeenCalledWith({ assignment_kind: 'Any', duration_seconds: 3600, min_confirmations: 6, witness: false })
  })

  test('caller mutation and request origin cannot change approved invoice parameters', async () => {
    const prompt = deferred()
    const confirm = jest.fn(() => prompt.promise)
    const { provider, wallet } = fixture({ sessionApproved: true, confirm })
    const args = { amount: 12, assetId: ID, origin: 'https://attacker.example' }
    const pending = provider.blindReceive(args)
    args.amount = 5000
    args.assetId = 'rgb:other'
    prompt.resolve(true)
    await pending
    expect(confirm.mock.calls[0][0].origin).toBe('https://example.com')
    expect(wallet.createRgbInvoice.mock.calls[0][0].assignment_amount).toBe(12)
    expect(wallet.createRgbInvoice.mock.calls[0][0].asset_id).toBe(ID)
  })

  test('rejected or revoked invoice approval cannot reserve a UTXO', async () => {
    const prompt = deferred()
    const { provider, wallet } = fixture({ sessionApproved: true, confirm: () => prompt.promise })
    const pending = provider.blindReceive()
    provider.revoke()
    prompt.resolve(true)
    await expect(pending).rejects.toMatchObject({ code: 'NOT_ENABLED' })
    expect(wallet.createRgbInvoice).not.toHaveBeenCalled()
    const declined = fixture({ sessionApproved: true, confirm: async () => false })
    await expect(declined.provider.blindReceive()).rejects.toMatchObject({ code: 'USER_REJECTED' })
    expect(declined.wallet.createRgbInvoice).not.toHaveBeenCalled()
  })

  test.each([{ amount: 0 }, { amount: -1 }, { amount: 1.2 }, { amount: '12' }, { amount: Number.MAX_SAFE_INTEGER + 1 },
    { assetId: '' }, { assetId: 'rgb:' }, { assetId: 'rgb:bad id' }, { durationSeconds: 0 }, { durationSeconds: 2592001 },
    { minConfirmations: 256 }, { minConfirmations: null }, null, []].map(value => [value]))('rejects invalid receive %j before approval', async args => {
    const { provider, wallet, confirm } = fixture({ sessionApproved: true })
    await expect(provider.blindReceive(args)).rejects.toMatchObject({ code: 'INVALID_PARAMS' })
    expect(confirm).not.toHaveBeenCalled()
    expect(wallet.createRgbInvoice).not.toHaveBeenCalled()
  })

  test('preserves all five asset groups including BFA without claiming BFA workflow support', async () => {
    const groups = Object.fromEntries(['nia', 'uda', 'cfa', 'ifa', 'bfa'].map(schema => [schema, [{ ...ASSET, asset_id: `rgb:${schema}` }]]))
    const { provider } = fixture({ sessionApproved: true }, { listAssets: async () => groups })
    const assets = await provider.listAssets()
    expect(assets.map(asset => asset.schema)).toEqual(['nia', 'uda', 'cfa', 'ifa', 'bfa'])
    expect(assets[4].id).toBe('rgb:bfa')
  })

  test('balances preserve spendable semantics and exact safe integers', async () => {
    const { provider, wallet } = fixture({ sessionApproved: true })
    expect((await provider.getAssetBalance(ID)).balance).toBe(12)
    wallet.getAssetBalance.mockResolvedValue({ spendable: '9007199254740991' })
    expect((await provider.getAssetBalance(ID)).balance).toBe(Number.MAX_SAFE_INTEGER)
    for (const value of ['9007199254740992', 9007199254740992, -1, null, undefined, '1.0']) {
      wallet.getAssetBalance.mockResolvedValue({ spendable: value })
      await expect(provider.getAssetBalance(ID)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' })
    }
  })

  test('lists transfers by asset and enumerates known assets when asset is omitted', async () => {
    const { provider, wallet } = fixture({ sessionApproved: true })
    expect(await provider.listTransfers()).toEqual([{ assetId: ID, transferId: 3, status: 'Settled', kind: 'ReceiveBlind', amount: 12, recipientId: 'utxob:recipient', txid: TXID }])
    expect(wallet.listTransfers).toHaveBeenCalledWith(ID)
    expect(wallet.listTransfers).not.toHaveBeenCalledWith(undefined)
    wallet.listAssets.mockClear()
    await provider.listTransfers(ID)
    expect(wallet.listAssets).not.toHaveBeenCalled()
  })

  test.each([['Fungible(9007199254740992)'], ['Fungible(9007199254740991)', 'Fungible(1)'], ['prefixFungible(1)'], ['Fungible(-1)'], [null]].map(value => [value]))('rejects unsafe or malformed assignments %j', async assignments => {
    const { provider } = fixture({ sessionApproved: true }, { listTransfers: async () => [{ ...TRANSFER, assignments }] })
    await expect(provider.listTransfers(ID)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' })
  })

  test('nonfungible and inflation assignments are not counted as fungible amounts', async () => {
    const { provider } = fixture({ sessionApproved: true }, { listTransfers: async () => [{ ...TRANSFER, assignments: ['NonFungible', 'InflationRight(100)', 'Any'] }] })
    expect((await provider.listTransfers(ID))[0].amount).toBeUndefined()
  })

  test.each([3, '3', TXID, 'utxob:recipient'])('refreshes and resolves status by %s', async id => {
    const { provider, wallet } = fixture({ sessionApproved: true })
    const result = await provider.getTransferStatus(id, ID)
    expect(wallet.refreshTransfers).toHaveBeenCalledWith({ skip_sync: false })
    expect(result.found).toBe(true)
    expect(result.status).toBe('Settled')
    expect(await provider.getTransferStatus('missing', ID)).toEqual({ found: false, status: null, transfer: null })
  })

  test('invoice decoding maps tagged assignments and any-amount invoices', async () => {
    const { provider, wallet } = fixture({ sessionApproved: true })
    const decoded = await provider.decodeRgbInvoice({ invoice: 'rgb:invoice' })
    expect(decoded).toEqual({ assetId: ID, amount: 12, recipientId: 'utxob:recipient', expirationTimestamp: undefined, network: 'mainnet', transportEndpoints: ['rpcs://proxy.example.com'] })
    const raw = await wallet.decodeRgbInvoice()
    for (const assignment of [{ type: 'Any' }, { type: 'NonFungible' }, { type: 'InflationRight', value: 100 }, { type: 'Fungible', value: 0 }]) {
      wallet.decodeRgbInvoice.mockResolvedValue({ ...raw, assignment })
      expect((await provider.decodeRgbInvoice('rgb:invoice')).amount).toBeNull()
    }
    wallet.decodeRgbInvoice.mockResolvedValue({ ...raw, assignment: { type: 'Fungible', value: '18446744073709551615' } })
    await expect(provider.decodeRgbInvoice('rgb:invoice')).rejects.toMatchObject({ code: 'INTERNAL_ERROR' })
  })

  test('sanitizes wallet and transport errors without exposing paths or credentials', async () => {
    const { provider, wallet } = fixture({ sessionApproved: true })
    wallet.getAddress.mockRejectedValue(new Error('secret /private/wallet password=secret'))
    const error = await provider.getAddress().catch(error => error)
    expect(error).toBeInstanceOf(WebRgbError)
    expect(error.toJSON()).toEqual({ name: 'WebRgbError', code: 'INTERNAL_ERROR', message: 'Wallet operation failed' })
    expect(error.cause).toBeUndefined()
    wallet.getAssetBalance.mockRejectedValue(new Error('Rln(NotFound): Unknown RGB contract ID'))
    await expect(provider.getAssetBalance(ID)).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' })
  })

  test.each([
    ['Rln(InvalidRequest): Invalid invoice: private data', 'INVALID_PARAMS'],
    ['Error parsing string: invalid contract ID', 'INVALID_PARAMS'],
    ['Rln(UnsupportedInExternalSignerMode): private data', 'METHOD_NOT_SUPPORTED'],
    ['Rln(NotFound): Unknown channel ID', 'INTERNAL_ERROR'],
    ['Rln(Conflict): Network unavailable', 'INTERNAL_ERROR']
  ])('maps released native error category %s', async (message, code) => {
    const { provider } = fixture({ sessionApproved: true }, { getAssetBalance: async () => { throw new Error(message) } })
    await expect(provider.getAssetBalance(ID)).rejects.toMatchObject({ code })
  })

  test('status by txid works without listing known assets and normalizes hex case', async () => {
    const { provider, wallet } = fixture({ sessionApproved: true })
    expect((await provider.getTransferStatus(TXID.toUpperCase())).found).toBe(true)
    expect(wallet.listTransfers).toHaveBeenCalledWith(undefined, TXID)
    expect(wallet.listAssets).not.toHaveBeenCalled()
  })

  test('normal address result and immutable wallet lifetime', async () => {
    const { provider, wallet } = fixture({ sessionApproved: true })
    expect(await provider.getAddress()).toEqual({ address: 'bc1address' })
    wallet.isDisposed.mockReturnValue(true)
    expect(provider.enabled).toBe(false)
    await expect(provider.getInfo()).rejects.toMatchObject({ code: 'NOT_ENABLED' })
  })

  test('missing required wallet method is rejected', () => {
    expect(() => fixture({}, { refreshTransfers: undefined })).toThrow(/refreshTransfers/)
  })

  test.each([() => false, async () => {}, async () => { throw new Error('private session failure') }])('fails closed for non-void/async authorization assertions', async assertAuthorized => {
    const { provider, wallet } = fixture({ sessionApproved: true, assertAuthorized })
    expect(provider.enabled).toBe(false)
    await expect(provider.getAddress()).rejects.toMatchObject({ code: 'NOT_ENABLED' })
    await expect(provider.enable()).rejects.toMatchObject({ code: 'NOT_ENABLED' })
    expect(wallet.getAddress).not.toHaveBeenCalled()
  })

  test('throwing approval is a sanitized rejection and can be retried', async () => {
    const confirm = jest.fn().mockRejectedValueOnce(new Error('private UI detail')).mockResolvedValue(true)
    const { provider } = fixture({ confirm })
    await expect(provider.enable()).rejects.toMatchObject({ code: 'USER_REJECTED', message: 'Approval did not complete' })
    await provider.enable()
    expect(provider.enabled).toBe(true)
  })

  test.each([null, [], { nia: {} }, { nia: [null] }, { nia: [{ ...ASSET, precision: null }] }].map(value => [value]))('rejects malformed asset response %j', async value => {
    const { provider } = fixture({ sessionApproved: true }, { listAssets: async () => value })
    await expect(provider.listAssets()).rejects.toMatchObject({ code: 'INTERNAL_ERROR' })
  })

  test.each([null, {}, [null], [{ ...TRANSFER, assignments: null }]].map(value => [value]))('rejects malformed transfer response %j', async value => {
    const { provider } = fixture({ sessionApproved: true }, { listTransfers: async () => value })
    await expect(provider.listTransfers(ID)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' })
  })

  test.each([null, '', -1, 0.1, 'a'.repeat(513), 'bad id'])('rejects invalid status ID %j without refresh', async value => {
    const { provider, wallet } = fixture({ sessionApproved: true })
    await expect(provider.getTransferStatus(value)).rejects.toMatchObject({ code: 'INVALID_PARAMS' })
    expect(wallet.refreshTransfers).not.toHaveBeenCalled()
  })

  test.each([null, {}, '', 'not-rgb', 'rgb:bad invoice', 'rgb:' + 'a'.repeat(16384)])('rejects invalid invoice %j', async value => {
    const { provider, wallet } = fixture({ sessionApproved: true })
    await expect(provider.decodeRgbInvoice(value)).rejects.toMatchObject({ code: 'INVALID_PARAMS' })
    expect(wallet.decodeRgbInvoice).not.toHaveBeenCalled()
  })

  test('rejects malformed native invoice assignments and endpoints', async () => {
    const { provider, wallet } = fixture({ sessionApproved: true })
    const raw = await wallet.decodeRgbInvoice()
    for (const patch of [{ assignment: { type: 'Unknown' } }, { transport_endpoints: null }, { transport_endpoints: [null] }, { recipient_id: '' }]) {
      wallet.decodeRgbInvoice.mockResolvedValue({ ...raw, ...patch })
      await expect(provider.decodeRgbInvoice('rgb:invoice')).rejects.toMatchObject({ code: 'INTERNAL_ERROR' })
    }
  })
})
