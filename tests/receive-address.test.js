import { jest } from '@jest/globals'
import { NodeRgbLightningBinding } from '../src/node-binding.js'
import { BareRgbLightningBinding } from '../src/bare-binding.js'
import WalletAccount from '../src/wallet-account-rgb-lightning.js'
import { addressOperationPending } from '../src/receive-address.js'

describe('rgb-lib-bfa receive address policy', () => {
  it.each([NodeRgbLightningBinding, BareRgbLightningBinding])('forwards native non-reuse and rejects ambiguous config', Binding => {
    expect(new Binding({ dataDir: '/unused', network: 'regtest', reuseAddresses: false })._initRequest.reuse_addresses).toBe(false)
    expect(new Binding({ dataDir: '/unused', network: 'regtest' })._initRequest.reuse_addresses).toBe(false)
    expect(() => new Binding({ dataDir: '/unused', network: 'regtest', reuseAddresses: true })).toThrow('not supported by rgb-lib-bfa')
    for (const reuseAddresses of [null, 0, 'false']) {
      expect(() => new Binding({ dataDir: '/unused', network: 'regtest', reuseAddresses })).toThrow('boolean')
    }
  })

  it('shares the current non-reuse address with the read-only facade and explicitly allocates fresh addresses', async () => {
    let index = 0
    const node = { address: jest.fn(() => ({ address: `address-${++index}` })), rotateAddress: jest.fn() }
    const binding = { _config: { reuseAddresses: false }, ensureNode: () => node }
    const account = new WalletAccount({ binding })
    const readOnly = await account.toReadOnlyAccount()
    expect(await Promise.all([account.getAddress(), readOnly.getAddress()])).toEqual(['address-1', 'address-1'])
    expect(await Promise.all([account.getNewAddress(), account.getNewAddress()])).toEqual(['address-2', 'address-3'])
    expect(await readOnly.getAddress()).toBe('address-3')
    expect(node.address).toHaveBeenCalledTimes(3)
    await expect(account.rotateAddress()).rejects.toThrow('getNewAddress')
    expect(node.rotateAddress).not.toHaveBeenCalled()
    expect(readOnly.getNewAddress).toBeUndefined()
  })

  it('persists fresh non-reuse addresses and rejects legacy rotation without touching native state', async () => {
    const calls = []
    let index = 0
    const node = {
      rotateAddress: () => { calls.push('rotate'); return { address: `address-${++index}` } },
      address: () => { calls.push('reveal'); return { address: `address-${index}` } }
    }
    node.address = () => { calls.push('reveal'); return { address: `address-${++index}` } }
    const account = new WalletAccount({ binding: { ensureNode: () => node } })
    await expect(account.rotateAddress()).rejects.toThrow('getNewAddress')
    expect(await Promise.all([account.getNewAddress(), account.getNewAddress()])).toEqual(['address-1', 'address-2'])
    expect(calls).toEqual(['reveal', 'reveal'])
  })

  it('does not cache invalid or unpersisted addresses and allows subsequent allocation', async () => {
    const node = { address: jest.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValueOnce({ address: '' }).mockResolvedValue('next') }
    const account = new WalletAccount({ binding: { ensureNode: () => node } })
    await expect(account.getNewAddress()).rejects.toThrow('disk full')
    await expect(account.getAddress()).rejects.toThrow('invalid receive address')
    await expect(account.getAddress()).resolves.toBe('next')
  })

  it('joins in-flight address persistence before shutdown and rejects new allocations during shutdown', async () => {
    let finish
    const node = { address: () => new Promise(resolve => { finish = resolve }) }
    const binding = { _config: { reuseAddresses: false }, ensureNode: () => node, shutdown: jest.fn() }
    const account = new WalletAccount({ binding })
    const allocation = account.getNewAddress()
    const readOnly = await account.toReadOnlyAccount()
    expect(addressOperationPending(binding)).toBe(true)
    await Promise.resolve()
    const shutdown = account.shutdown()
    await Promise.resolve()
    expect(binding.shutdown).not.toHaveBeenCalled()
    await expect(account.getNewAddress()).rejects.toThrow('closed')
    await expect(readOnly.getAddress()).rejects.toThrow('closed')
    finish('persisted')
    await Promise.all([allocation, shutdown])
    expect(addressOperationPending(binding)).toBe(false)
    expect(binding.shutdown).toHaveBeenCalledTimes(1)
  })
})
