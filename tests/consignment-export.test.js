import { jest } from '@jest/globals'
import { consignmentLookup, consignmentBytes } from '../src/consignment-export.js'
import WalletAccountRgbLightning from '../src/wallet-account-rgb-lightning.js'

const assetId = 'rgb:expected'
const txid = 'AB'.repeat(32)

test('lookup rejects malformed identifiers before calling native code', () => {
  expect(consignmentLookup(assetId, txid)).toEqual([assetId, txid.toLowerCase()])
  for (const id of [null, '', 'rgb:', 'asset', 'rgb:bad\0id', 'rgb:bad id', 'rgb:' + 'a'.repeat(512)]) {
    expect(() => consignmentLookup(id, txid)).toThrow(TypeError)
  }
  for (const id of [null, '', '0x' + txid, 'aa', 'g'.repeat(64)]) {
    expect(() => consignmentLookup(assetId, id)).toThrow(TypeError)
  }
})

test('hex conversion is exact and fails closed on invalid native data', () => {
  expect(consignmentBytes({ bytes_hex: '00017fff80' })).toEqual(new Uint8Array([0, 1, 127, 255, 128]))
  for (const response of [null, {}, { bytes_hex: 12 }, { bytes_hex: '' }, { bytes_hex: 'f' },
    { bytes_hex: 'FF' }, { bytes_hex: 'zz' }, { bytes_hex: '0xff' }, { bytes_hex: 'ff\n' }]) {
    expect(() => consignmentBytes(response)).toThrow(TypeError)
  }
})

test('writable and read-only accounts export bytes without exposing filesystem paths', async () => {
  const getConsignment = jest.fn(() => ({ bytes_hex: '00ff' }))
  const binding = { ensureNode: () => ({ getConsignment }) }
  const account = new WalletAccountRgbLightning({ binding })
  const readOnly = await account.toReadOnlyAccount()
  for (const wallet of [account, readOnly]) {
    await expect(wallet.getConsignment(assetId, txid)).resolves.toEqual(new Uint8Array([0, 255]))
    expect(getConsignment).toHaveBeenLastCalledWith(assetId, txid.toLowerCase())
    expect(wallet.getConsignmentPath).toBeUndefined()
    await expect(wallet.getConsignment(assetId, 'invalid')).rejects.toThrow('txid')
  }
  expect(getConsignment).toHaveBeenCalledTimes(2)
  const error = new Error('Rln(UnknownTransfer): no local consignment')
  getConsignment.mockImplementation(() => { throw error })
  await expect(account.getConsignment(assetId, txid)).rejects.toBe(error)
})

test('BFA response groups and balances are preserved without enabling unsupported burn', async () => {
  const bfa = { asset_id: assetId, balance: { spendable: '18446744073709551615' }, precision: 6 }
  const account = new WalletAccountRgbLightning({
    binding: {
      ensureNode: () => ({ listAssets: () => ({ nia: null, bfa: [bfa] }), assetBalance: () => bfa.balance })
    }
  })
  await expect(account.listAssets(['Bfa'])).resolves.toEqual({ nia: null, bfa: [bfa] })
  await expect(account.getTokenBalance(assetId)).resolves.toBe(18446744073709551615n)
  expect(account.burn).toBeUndefined()
})
