import { jest } from '@jest/globals'
import { NodeRgbLightningBinding } from '../src/node-binding.js'
import { BareRgbLightningBinding } from '../src/bare-binding.js'
import WalletAccount from '../src/wallet-account-rgb-lightning.js'
import { addressOperationPending } from '../src/receive-address.js'

describe('released receive address policies', () => {
  it.each([NodeRgbLightningBinding, BareRgbLightningBinding])('forwards native non-reuse and rejects ambiguous config', Binding => {
    expect(new Binding({ dataDir: '/unused', network: 'regtest', reuseAddresses: false })._initRequest.reuse_addresses).toBe(false)
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

  it('reveals every rotated address natively before returning it', async () => {
    const calls = []
    let index = 0
    const node = {
      rotateAddress: () => { calls.push('rotate'); return { address: `address-${++index}` } },
      address: () => { calls.push('reveal'); return { address: `address-${index}` } }
    }
    const account = new WalletAccount({ binding: { ensureNode: () => node } })
    expect(await Promise.all([account.rotateAddress(), account.getNewAddress()])).toEqual(['address-1', 'address-2'])
    expect(calls).toEqual(['rotate', 'reveal', 'rotate', 'reveal'])
  })

  it('fails closed on reveal errors or identity mismatch without poisoning subsequent calls', async () => {
    const node = { rotateAddress: () => 'next', address: jest.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValueOnce('different').mockResolvedValue('next') }
    const account = new WalletAccount({ binding: { ensureNode: () => node } })
    await expect(account.rotateAddress()).rejects.toThrow('disk full')
    await expect(account.rotateAddress()).rejects.toThrow('differs')
    await expect(account.rotateAddress()).resolves.toBe('next')
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
