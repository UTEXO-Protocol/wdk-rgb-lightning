import { jest } from '@jest/globals'
import { normalizeUnlockRequest, sameUnlockRequest } from '../src/node-unlock-request.js'
import { validateUnspents, validateRefreshResult, exactUnsignedNumber } from '../src/released-native-contract.js'
import WalletAccount from '../src/wallet-account-rgb-lightning.js'
import { NodeRgbLightningBinding } from '../src/node-binding.js'
import rln from '@utexo/rgb-lightning-node-nodejs'

const rpc = { bitcoind_rpc_username: 'user', bitcoind_rpc_password: 'secret-do-not-print', bitcoind_rpc_host: 'localhost', bitcoind_rpc_port: 18443 }
const legacy = { indexer_url: 'electrum://localhost:50001' }

describe('released unlock contract', () => {
  it('normalizes legacy transaction sync and deeply freezes its copy', () => {
    const addresses = ['localhost:9735']
    const result = normalizeUnlockRequest({ ...legacy, announce_addresses: addresses })
    addresses.push('changed')
    expect(result.ldk_chain_sync).toEqual({ mode: 'TransactionSync', config: legacy })
    expect(result.announce_addresses).toEqual(['localhost:9735'])
    expect(Object.isFrozen(result.ldk_chain_sync.config)).toBe(true)
  })
  it('allows bitcoind with an independent RGB indexer', () => {
    const result = normalizeUnlockRequest({ ...rpc, ...legacy })
    expect(result.ldk_chain_sync).toEqual({ mode: 'BlockSync', config: rpc })
    expect(result.indexer_url).toBe(legacy.indexer_url)
  })
  it('keeps canonical LDK and RGB indexers independent', () => {
    const request = { ldk_chain_sync: { mode: 'TransactionSync', config: { indexer_url: 'esplora://localhost:3000' } }, ...legacy }
    expect(normalizeUnlockRequest(request)).toMatchObject(request)
  })
  it('compares canonical requests independently of input key order', () => {
    expect(sameUnlockRequest(normalizeUnlockRequest({ ...rpc, ...legacy }), normalizeUnlockRequest({ ...legacy, ...rpc }))).toBe(true)
  })
  it.each([
    {}, { bitcoind_rpc_password: rpc.bitcoind_rpc_password }, { ...legacy, announce_addresses: null },
    { ...legacy, password: 'unsupported' }, { ...legacy, gossip_rgs_server_url: 'unsupported' },
    { ...rpc, bitcoind_rpc_port: 65536 },
    { ...rpc, ldk_chain_sync: { mode: 'BlockSync', config: rpc } },
    { ldk_chain_sync: { mode: 'Other', config: legacy } },
    { ldk_chain_sync: { mode: 'TransactionSync', config: { ...legacy, secret: 'ignored?' } } }
  ])('rejects incomplete or unsupported inputs without printing credentials %p', (request) => {
    expect(() => normalizeUnlockRequest(request)).toThrow()
    try { normalizeUnlockRequest(request) } catch (error) { expect(error.message).not.toContain(rpc.bitcoind_rpc_password) }
  })
})

describe('released account boundaries', () => {
  it('coalesces address-triggered activation and never activates without opt-in', async () => {
    let unlocked = false
    const node = {
      address: jest.fn(() => {
        if (!unlocked) throw new Error('LockedNode')
        return { address: 'bcrt1test' }
      })
    }
    const binding = {
      ensureNode: jest.fn(() => node),
      unlock: jest.fn(async () => { unlocked = true }),
      shutdown: jest.fn()
    }
    const locked = new WalletAccount({ binding })
    await expect(locked.getAddress()).rejects.toThrow('Unlock')
    expect(binding.unlock).not.toHaveBeenCalled()
    const account = new WalletAccount({ binding, autoUnlockRequest: legacy })
    await expect(Promise.all([account.getAddress(), account.getAddress()])).resolves.toEqual(['bcrt1test', 'bcrt1test'])
    expect(binding.unlock).toHaveBeenCalledTimes(1)
    await account.shutdown()
    await expect(account.getAddress()).rejects.toThrow('closed')
  })
  it('coalesces normalized unlock and serializes shutdown behind it', async () => {
    let finish
    const binding = { ensureNode: jest.fn(() => ({})), unlock: jest.fn(() => new Promise(resolve => { finish = resolve })), shutdown: jest.fn() }
    const account = new WalletAccount({ binding })
    const first = account.unlock(legacy)
    const second = account.unlock(normalizeUnlockRequest(legacy))
    await Promise.resolve()
    expect(binding.unlock).toHaveBeenCalledTimes(1)
    await expect(account.unlock({ indexer_url: 'different' })).rejects.toThrow('different')
    const shutdown = account.shutdown()
    await Promise.resolve()
    expect(binding.shutdown).not.toHaveBeenCalled()
    finish()
    await Promise.all([first, second, shutdown])
    expect(binding.shutdown).toHaveBeenCalledTimes(1)
    await expect(account.unlock(legacy)).rejects.toThrow('closed')
  })
  it('rejects fee caps before obtaining a native node', async () => {
    const binding = { ensureNode: jest.fn() }
    const account = new WalletAccount({ binding })
    await expect(account.sendPayment({ invoice: 'unused', max_total_routing_fee_msat: 0 })).rejects.toMatchObject({ code: 'ERR_RLN_UNSUPPORTED_CAPABILITY' })
    expect(binding.ensureNode).not.toHaveBeenCalled()
  })
  it('rejects stale native capabilities before constructing any handles', () => {
    const spy = jest.spyOn(rln, 'getRuntimeInfo').mockReturnValue({ rln_version: '0.11.0-beta.3' })
    try { expect(() => new NodeRgbLightningBinding({ dataDir: '/unused', network: 'regtest' })).toThrow('Incompatible') } finally { spy.mockRestore() }
  })
  it('preserves exists=false and validates allocation state', () => {
    const value = [{ utxo: { outpoint: 'ab'.repeat(32) + ':0', btc_amount: 100, exists: false, colorable: true }, rgb_allocations: [{ asset_id: null, assignment: 'Fungible(1)', settled: false }] }]
    expect(validateUnspents(value)).toBe(value)
    expect(value[0].utxo.exists).toBe(false)
    expect(() => validateUnspents([{ ...value[0], utxo: { ...value[0].utxo, exists: undefined } }])).toThrow()
    expect(() => validateUnspents([{ ...value[0], rgb_allocations: [{ assignment: 'Any', settled: 'false' }] }])).toThrow()
  })
  it('preserves WaitingBroadcast/failures and rejects unknown refresh states', () => {
    const value = { transfers: { 1: { updated_status: 'WaitingBroadcast', failure: { name: 'Network', message: 'offline' } } } }
    expect(validateRefreshResult(value)).toBe(value)
    expect(() => validateRefreshResult({ transfers: { 1: { updated_status: 'Unknown', failure: null } } })).toThrow()
  })
  it('never treats rounded numeric values as exact', () => {
    for (const value of [Number.MAX_SAFE_INTEGER + 1, 18446744073709551615n, '18446744073709551615', NaN, Infinity, -1, 1.5]) {
      expect(() => exactUnsignedNumber(value, 'amount')).toThrow()
    }
    expect(exactUnsignedNumber(42n, 'amount')).toBe(42)
  })
})
