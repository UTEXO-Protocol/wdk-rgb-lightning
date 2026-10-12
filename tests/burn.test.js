import { jest } from '@jest/globals'
import WalletAccount from '../src/wallet-account-rgb-lightning.js'
import { NodeRgbLightningBinding } from '../src/node-binding.js'
import { BareRgbLightningBinding } from '../src/bare-binding.js'
import { WebRgbProvider, WEBRGB_READ_METHODS } from '../src/webrgb.js'

const request = { asset_id: 'rgb:asset', amount: 10, fee_rate: 1, min_confirmations: 3 }
const result = { txid: 'ab'.repeat(32), batch_transfer_idx: 7 }

function fixture (network = 'regtest') {
  const node = { burn: jest.fn(() => result) }
  const binding = {
    _config: { network },
    ensureNode: jest.fn(() => node),
    unlock: jest.fn(),
    shutdown: jest.fn()
  }
  return { node, binding, account: new WalletAccount({ binding }) }
}

describe('native burn account contract', () => {
  test.each(['mainnet', 'signet', 'regtest'])('%s burns exactly once with the native request', async network => {
    const { node, account } = fixture(network)
    await expect(account.burnAsset(request)).resolves.toBe(result)
    expect(node.burn).toHaveBeenCalledTimes(1)
    expect(node.burn).toHaveBeenCalledWith(request)
    const forwarded = node.burn.mock.calls[0][0]
    expect(forwarded).not.toBe(request)
    expect(Object.isFrozen(forwarded)).toBe(true)
  })

  test.each([undefined, null, 'AB'.repeat(32)])('preserves the native optional burn_recipient: %p', async recipient => {
    const { node, account } = fixture()
    await account.burnAsset({ ...request, burn_recipient: recipient })
    expect(node.burn.mock.calls[0][0].burn_recipient).toBe(recipient)
  })

  test.each([Number.MAX_SAFE_INTEGER, '9007199254740992', '18446744073709551615'])('preserves exact amount and fee integers: %p', async value => {
    const { account, node } = fixture()
    await account.burnAsset({ ...request, amount: value, fee_rate: value })
    expect(node.burn).toHaveBeenCalledWith({ ...request, amount: value, fee_rate: value })
  })

  test.each([0, 255])('accepts native confirmation boundary %i without imposing app policy', async value => {
    const { account, node } = fixture()
    await account.burnAsset({ ...request, min_confirmations: value })
    expect(node.burn).toHaveBeenCalledWith({ ...request, min_confirmations: value })
  })

  const invalid = [
    null, undefined, [], 'burn', {},
    { ...request, recipient: 'ab'.repeat(32) },
    { ...request, sweep: true },
    { ...request, assetId: 'rgb:asset' },
    { ...request, toJSON: () => request },
    ...[null, '', 'rgb:', 'asset', 'rgb:bad\0id', 'rgb:bad id', 'rgb:' + 'a'.repeat(509)]
      .map(assetId => ({ ...request, asset_id: assetId })),
    ...['amount', 'fee_rate'].flatMap(field => [
      undefined, null, false, 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1,
      1n, '', '0', '01', '-1', '1.5', '1e3', ' 1', '1\n', '18446744073709551616', {}, []
    ].map(value => ({ ...request, [field]: value }))),
    ...[undefined, null, -1, 256, 0.5, NaN, Infinity, '3', true]
      .map(value => ({ ...request, min_confirmations: value })),
    ...['', '0x' + 'ab'.repeat(32), 'ab'.repeat(20), 'ab'.repeat(33), 'gg'.repeat(32), 'ab'.repeat(32) + '\n', 1, {}]
      .map(value => ({ ...request, burn_recipient: value }))
  ]
  test.each(invalid)('rejects invalid inputs before native access: %p', async value => {
    const { account, node, binding } = fixture()
    await expect(account.burnAsset(value)).rejects.toBeInstanceOf(TypeError)
    expect(binding.ensureNode).not.toHaveBeenCalled()
    expect(node.burn).not.toHaveBeenCalled()
  })

  test.each([null, {}, [], { ...result, txid: '' }, { ...result, txid: 'ab' },
    { ...result, txid: result.txid + '\n' }, { ...result, batch_transfer_idx: '7' },
    { ...result, batch_transfer_idx: 1.5 }, { ...result, batch_transfer_idx: 2147483648 },
    { ...result, batch_transfer_idx: -2147483649 }])('does not retry malformed native results: %p', async value => {
    const { account, node } = fixture()
    node.burn.mockReturnValue(value)
    await expect(account.burnAsset(request)).rejects.toThrow('reconcile wallet history')
    expect(node.burn).toHaveBeenCalledTimes(1)
  })

  test('preserves native error identity and reconciliation detail, never replaying the burn', async () => {
    const { node, account } = fixture()
    const error = Object.assign(new Error('external burn completion failed (batch_transfer_idx=7); reconcile the transfer before retrying'), { code: 'Rln(Internal)' })
    node.burn.mockImplementation(() => { throw error })
    await expect(account.burnAsset(request)).rejects.toBe(error)
    await Promise.resolve()
    expect(node.burn).toHaveBeenCalledTimes(1)
  })

  test('fails explicitly when a custom native binding lacks burn', async () => {
    const { account, node } = fixture()
    delete node.burn
    await expect(account.burnAsset(request)).rejects.toMatchObject({ code: 'ERR_RLN_UNSUPPORTED_CAPABILITY' })
  })

  test('does not admit or queue burns while unlock is pending', async () => {
    const { account, node, binding } = fixture()
    let finish
    binding.unlock.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const unlock = account.unlock({ indexer_url: 'electrum://localhost:50001' })
    await expect(account.burnAsset(request)).rejects.toThrow('Await account unlock')
    expect(binding.ensureNode).not.toHaveBeenCalled()
    finish()
    await unlock
    expect(node.burn).not.toHaveBeenCalled()
    await expect(account.burnAsset(request)).resolves.toBe(result)
  })

  test('completes synchronous native dispatch before shutdown; rejects all later burns', async () => {
    const { account, node, binding } = fixture()
    const order = []
    node.burn.mockImplementation(() => { order.push('burn'); return result })
    binding.shutdown.mockImplementation(() => order.push('shutdown'))
    const burn = account.burnAsset(request)
    expect(order).toEqual(['burn'])
    const shutdown = account.shutdown()
    await expect(account.burnAsset(request)).rejects.toThrow('closed')
    await expect(burn).resolves.toBe(result)
    await shutdown
    await expect(account.burnAsset(request)).rejects.toThrow('closed')
    expect(order).toEqual(['burn', 'shutdown'])
    expect(node.burn).toHaveBeenCalledTimes(1)
  })

  test.each([NodeRgbLightningBinding, BareRgbLightningBinding])('uses the shared %p node and rejects disposed bindings', async Binding => {
    const binding = new Binding({ dataDir: '/unused', network: 'regtest' })
    const burn = jest.fn(() => result)
    binding._node = { burn }
    const account = new WalletAccount({ binding })
    await expect(account.burnAsset(request)).resolves.toBe(result)
    binding._closed = true
    await expect(account.burnAsset(request)).rejects.toThrow('closed')
    expect(burn).toHaveBeenCalledTimes(1)
  })

  test('read-only accounts have no burn authority and the optional WebRGB subset is unchanged', async () => {
    const { account, binding } = fixture()
    const reader = await account.toReadOnlyAccount()
    expect(reader.burnAsset).toBeUndefined()
    expect(reader._reader.burn).toBeUndefined()
    expect(reader.getCapabilities().burn).toBe(false)
    await expect(reader.getBfaCapabilities()).resolves.toMatchObject({ burn: false })
    expect(account.getCapabilities().burn).toBe(true)
    expect(binding.ensureNode).not.toHaveBeenCalled()
    expect(WebRgbProvider.prototype.burnAsset).toBeUndefined()
    expect(WEBRGB_READ_METHODS).toEqual([
      'enable', 'getInfo', 'getAddress', 'blindReceive', 'listAssets',
      'getAssetBalance', 'listTransfers', 'getTransferStatus', 'decodeRgbInvoice'
    ])
  })
})
