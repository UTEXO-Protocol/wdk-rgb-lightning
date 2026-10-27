import { jest } from '@jest/globals'
import WalletAccount from '../src/wallet-account-rgb-lightning.js'

const request = {
  invoice: 'rgb:full-invoice-with-key-and-encryption',
  asset_id: 'rgb:asset',
  amount: '18446744073709551615',
  donation: false,
  fee_rate: 2,
  min_confirmations: 3
}
const response = { txid: 'ab'.repeat(32), batch_transfer_idx: 7 }
function fixture () {
  const node = { sendRgbInvoice: jest.fn(() => response), sendRgb: jest.fn() }
  const binding = { ensureNode: jest.fn(() => node) }
  return { node, binding, account: new WalletAccount({ binding }) }
}

test('retains exact u64 and complete invoice and never dispatches a legacy recipient send', async () => {
  const f = fixture()
  await expect(f.account.sendRgbInvoice(request)).resolves.toBe(response)
  expect(f.node.sendRgbInvoice).toHaveBeenCalledWith(request)
  expect(Object.isFrozen(f.node.sendRgbInvoice.mock.calls[0][0])).toBe(true)
  expect(f.node.sendRgb).not.toHaveBeenCalled()
})

test.each([null, {}, { ...request, invoice: 'rgb:bad invoice' }, { ...request, asset_id: '' },
  { ...request, amount: Number.MAX_SAFE_INTEGER + 1 }, { ...request, amount: '18446744073709551616' },
  { ...request, amount: 0 }, { ...request, fee_rate: 0 }, { ...request, fee_rate: 1.5 },
  { ...request, donation: 1 }, { ...request, min_confirmations: 256 }, { ...request, sender_proxy: 'invented' },
  { ...request, witness_data: { amount_sat: 1000, blinding: 1 } }, { ...request, witness_data: { amount_sat: 0 } }])('rejects invalid complete-invoice requests before native access: %p', async value => {
  const f = fixture()
  await expect(f.account.sendRgbInvoice(value)).rejects.toBeInstanceOf(TypeError)
  expect(f.binding.ensureNode).not.toHaveBeenCalled()
})

test('passes only witness satoshis and snapshots them before dispatch', async () => {
  const f = fixture()
  await f.account.sendRgbInvoice({ ...request, witness_data: { amount_sat: 1000 } })
  const sent = f.node.sendRgbInvoice.mock.calls[0][0]
  expect(sent.witness_data).toEqual({ amount_sat: 1000 })
  expect(Object.isFrozen(sent.witness_data)).toBe(true)
})

test('missing native support or an uncertain result never falls back or retries', async () => {
  const f = fixture()
  const failure = new Error('native uncertain outcome')
  f.node.sendRgbInvoice.mockImplementationOnce(() => { throw failure })
  await expect(f.account.sendRgbInvoice(request)).rejects.toBe(failure)
  expect(f.node.sendRgbInvoice).toHaveBeenCalledTimes(1)
  delete f.node.sendRgbInvoice
  await expect(f.account.sendRgbInvoice(request)).rejects.toMatchObject({ code: 'ERR_RLN_UNSUPPORTED_CAPABILITY' })
  expect(f.node.sendRgb).not.toHaveBeenCalled()
})
