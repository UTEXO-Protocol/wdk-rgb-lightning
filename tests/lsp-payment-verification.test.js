import { jest } from '@jest/globals'
import { paymentExpectation, verifyPaymentInvoice } from '../src/lsp-payment-verification.js'

const request = {
  amtMsat: 5000,
  paymentHash: 'AB'.repeat(32),
  descriptionHash: 'CD'.repeat(32),
  minFinalCltvExpiryDelta: 42,
  expirySec: 3600
}
const invoice = {
  amt_msat: 5000,
  payment_hash: 'ab'.repeat(32),
  description_hash: 'cd'.repeat(32),
  min_final_cltv_expiry_delta: 42,
  expiry_sec: 3600,
  timestamp: Math.floor(Date.now() / 1000),
  network: 'regtest'
}

describe('bridge payment invoice constraints', () => {
  it('normalizes and verifies every requested signed invoice constraint', async () => {
    const expected = paymentExpectation(request)
    expect(expected.paymentHash).toBe('ab'.repeat(32))
    expect(expected.descriptionHash).toBe('cd'.repeat(32))
    await expect(verifyPaymentInvoice({ decodeInvoice: jest.fn(async () => invoice) }, 'invoice', expected)).resolves.toBeUndefined()
  })

  it.each([
    ['payment_hash', 'ef'.repeat(32)],
    ['description_hash', 'ef'.repeat(32)],
    ['description_hash', undefined],
    ['min_final_cltv_expiry_delta', 864],
    ['min_final_cltv_expiry_delta', undefined],
    ['expiry_sec', 7200]
  ])('refuses a changed or missing %s', async (field, value) => {
    const account = { decodeInvoice: jest.fn(async () => ({ ...invoice, [field]: value })) }
    await expect(verifyPaymentInvoice(account, 'invoice', paymentExpectation(request))).rejects.toThrow()
  })

  it.each([
    { paymentHash: 'not-hex' },
    { descriptionHash: '01' },
    { minFinalCltvExpiryDelta: 65536 },
    { expirySec: -1 }
  ])('rejects malformed caller constraints before requesting a quote: %p', (change) => {
    expect(() => paymentExpectation({ ...request, ...change })).toThrow()
  })
})
