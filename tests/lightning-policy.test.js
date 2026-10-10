import { jest } from '@jest/globals'
import WalletAccount from '../src/wallet-account-rgb-lightning.js'
import { LightningDisabledError } from '../index-node.js'
import { UtexoLsp } from '../src/utexo-lsp.js'
import { payLightningAddress, payRgbViaLsp, requestLspRgbDeposit } from '../src/lsp-helpers.js'

function fixture (network = 'mainnet') {
  const node = new Proxy({}, { get: (target, key) => (target[key] ??= jest.fn(() => ({}))) })
  const binding = {
    _config: { network },
    ensureNode: jest.fn(() => node),
    apayNew: jest.fn(),
    apayNewWithAddress: jest.fn()
  }
  return { node, binding, account: new WalletAccount({ binding }) }
}

const calls = [
  ['listChannels'], ['getChannelId', 'id'], ['listPeers'], ['decodeInvoice', 'invoice'],
  ['getInvoiceStatus', 'invoice'], ['listPayments'], ['getPayment', 'hash', 'Outbound'],
  ['apayNew', 'host'], ['apayNewWithAddress', 'host', 'user', 'domain'], ['bootstrapLsp'],
  ['createLsp'], ['openChannel', {}], ['closeChannel', {}], ['connectPeer', 'peer'],
  ['disconnectPeer', {}], ['createInvoice', {}], ['createLightningInvoice', {}],
  ['createHodlInvoice'], ['cancelHodlInvoice', {}], ['claimHodlInvoice', {}],
  ['sendPayment', {}], ['keysend', {}], ['sendOnionMessage', {}],
  ['payLightningAddress', 'user@example.com', 1n], ['requestLspRgbDeposit'], ['payRgbViaLsp'],
  ['transfer', { recipient: 'lnbc1test' }], ['transfer', { recipient: '02'.repeat(33) }],
  ['quoteTransfer', { recipient: 'lnbc1test' }], ['quoteTransfer', { recipient: '02'.repeat(33) }]
]

describe('mainnet Lightning policy', () => {
  test.each(calls)('%s rejects without constructing a native node', async (method, ...args) => {
    const { account, binding } = fixture()
    await expect(account[method](...args)).rejects.toMatchObject({
      name: 'LightningDisabledError', code: 'LIGHTNING_DISABLED_ON_MAINNET'
    })
    expect(binding.ensureNode).not.toHaveBeenCalled()
    expect(binding.apayNew).not.toHaveBeenCalled()
    expect(binding.apayNewWithAddress).not.toHaveBeenCalled()
  })

  test('guard covers the read-only facade and normalized network snapshot', async () => {
    const { account, binding } = fixture('MAINNET')
    binding._config.network = 'signet'
    const reader = await account.toReadOnlyAccount()
    expect(reader.getNetwork()).toBe('mainnet')
    await expect(reader.listPayments()).rejects.toBeInstanceOf(LightningDisabledError)
    await expect(reader.quoteTransfer({ recipient: 'lnbc1test' })).rejects.toBeInstanceOf(LightningDisabledError)
    expect(binding.ensureNode).not.toHaveBeenCalled()
  })

  test('standalone LSP helpers reject before HTTP side effects', async () => {
    const { account, binding } = fixture()
    const fetch = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Must not fetch'))
    try {
      await expect(payLightningAddress(account, 'user@example.com', 1n)).rejects.toBeInstanceOf(LightningDisabledError)
      await expect(payRgbViaLsp(account)).rejects.toBeInstanceOf(LightningDisabledError)
      await expect(requestLspRgbDeposit(account)).rejects.toBeInstanceOf(LightningDisabledError)
      expect(() => new UtexoLsp(account, {})).toThrow(LightningDisabledError)
      expect(fetch).not.toHaveBeenCalled()
      expect(binding.ensureNode).not.toHaveBeenCalled()
    } finally { fetch.mockRestore() }
  })

  test.each(['connect', 'waitForChannel', 'receiveAsset', 'awaitReceiveSettlement',
    'waitForOutboundLiquidity', 'sendAsset', 'payAddress', 'quoteAddress',
    'enableLightningAddress', 'claimPendingPayments'])('LSP %s rechecks account policy', async method => {
    let network = 'signet'
    const account = { getNetwork: () => network }
    const lsp = new UtexoLsp(account, { baseUrl: 'https://example.com', peerPubkey: '02'.repeat(33), peerHost: 'example.com', peerPort: 9735 })
    network = 'mainnet'
    await expect(lsp[method]()).rejects.toBeInstanceOf(LightningDisabledError)
  })

  test.each(['signet', 'testnet', 'regtest'])('%s preserves direct and generic Lightning calls', async network => {
    const { account, node } = fixture(network)
    await account.listChannels()
    await account.createInvoice({ expiry_sec: 60 })
    await account.sendPayment({ invoice: 'lntb1test' })
    await account.transfer({ recipient: '02'.repeat(33), amount: 1000 })
    expect(node.listChannels).toHaveBeenCalled()
    expect(node.lnInvoice).toHaveBeenCalledWith({ expiry_sec: 60 })
    expect(node.sendPayment).toHaveBeenCalledWith({ invoice: 'lntb1test' })
    expect(node.keysend).toHaveBeenCalledWith({ dest_pubkey: '02'.repeat(33), amt_msat: 1000 })
    expect(account.getCapabilities().lightning).toBe(true)
  })

  test('on-chain queries and sends, node identity and signing remain available', async () => {
    const { account, node } = fixture()
    node.sendBtc.mockReturnValue({ txid: 'btc' })
    node.btcBalance.mockReturnValue({ vanilla: { spendable: 1000 } })
    node.signMessage.mockReturnValue({ signed_message: 'sig' })
    node.verifyMessage.mockReturnValue({ valid: true })
    node.listTransactionsByTxid.mockReturnValue([])
    node.listTransfersByTxid.mockReturnValue([])
    await expect(account.sendTransaction({ to: 'bc1address', value: 100, feeRate: 1 })).resolves.toEqual({ hash: 'btc', fee: 141n })
    await expect(account.getBalance()).resolves.toBe(1000n)
    await account.createRgbInvoice({ min_confirmations: 3, witness: false })
    await account.sendRgbAsset({ recipient_groups: [] })
    await account.getAssetBalance('rgb:asset')
    await account.getNodeInfo()
    await account.getNetworkInfo()
    await expect(account.sign('hello')).resolves.toBe('sig')
    await expect(account.verify('hello', 'sig')).resolves.toBe(true)
    await expect(account.getTransactionReceipt('00'.repeat(32))).resolves.toBeNull()
    expect(node.listPayments).not.toHaveBeenCalled()
  })

  test('capabilities describe BFA build support, keep burn disabled and do not probe readiness', async () => {
    const { account, binding } = fixture()
    expect(account.getCapabilities()).toEqual({
      network: 'mainnet',
      signer: 'external',
      lightning: false,
      consignmentExport: true,
      bfaAssetListing: true,
      bfaValidation: true,
      burn: false
    })
    await expect(account.getBfaCapabilities()).resolves.toEqual({ bfa: true, burn: false, consignment: true })
    expect(binding.ensureNode).not.toHaveBeenCalled()
    expect(new LightningDisabledError().toJSON().code).toBe('LIGHTNING_DISABLED_ON_MAINNET')
  })
})
