import { jest } from '@jest/globals'
import WalletAccountReadOnlyRgbLightning from '../src/wallet-account-read-only-rgb-lightning.js'
import WalletAccountRgbLightning from '../src/wallet-account-rgb-lightning.js'

function fixture (estimateFee = jest.fn()) {
  const reader = Object.fromEntries(['address', 'assetBalance', 'btcBalance', 'listPayments',
    'listTransactionsByTxid', 'verifyMessage'].map(name => [name, jest.fn()]))
  reader.estimateFee = estimateFee
  return { reader, account: new WalletAccountReadOnlyRgbLightning(reader) }
}

it('is inherited by writable accounts without adding native methods or changing legacy estimation', () => {
  expect(WalletAccountRgbLightning.prototype.estimateFeeResult)
    .toBe(WalletAccountReadOnlyRgbLightning.prototype.estimateFeeResult)
})

it('retains the original native object and fractional estimate through JSON transport', async () => {
  const estimate = { fee_rate: 2.1 }
  const f = fixture(jest.fn(async () => estimate))
  const result = await f.account.estimateFeeResult(6)
  expect(result).toEqual({ status: 'available', estimate })
  expect(result.estimate).toBe(estimate)
  expect(JSON.parse(JSON.stringify(result))).toEqual(result)
  expect(f.reader.estimateFee).toHaveBeenCalledTimes(1)
  expect(f.reader.estimateFee).toHaveBeenCalledWith(6)
})

it.each(['Cannot estimate fees', 'Rln(Conflict): Cannot estimate fees'])(
  'returns explicit absence only for exact native no-estimate message %s', async message => {
    const error = new Error(message)
    const f = fixture(jest.fn(async () => { throw error }))
    await expect(f.account.estimateFeeResult(1)).resolves.toEqual({ status: 'unavailable' })
    // The original API continues throwing the original native error.
    await expect(f.account.estimateFee(1)).rejects.toBe(error)
  })

it.each([
  new Error('Indexer request failed: Cannot estimate fees'),
  new Error('Cannot estimate fees: connection timed out'),
  new Error('Rln(Conflict { details: "CannotEstimateFees" })'),
  new Error('Rln(InvalidRequest): Cannot estimate fees'),
  new Error('CannotEstimateFees'),
  new Error('cannot estimate fees'),
  new Error('Cannot estimate fees\n'),
  new Error('Wallet is locked'),
  new Error('Internal native failure'),
  { message: 'Cannot estimate fees' },
  'Cannot estimate fees'
])('does not reinterpret unexpected failures as absence: %p', async error => {
  const f = fixture(jest.fn(async () => { throw error }))
  await expect(f.account.estimateFeeResult(6)).rejects.toBe(error)
})

it.each([null, undefined, [], 1, {}, { fee_rate: '1' }, { fee_rate: 0 },
  { fee_rate: -1 }, { fee_rate: NaN }, { fee_rate: Infinity },
  { fee_rate: Number.MAX_VALUE }, { fee_rate: 1, extra: true }])(
  'rejects malformed native success without manufacturing absence: %p', async estimate => {
    const f = fixture(jest.fn(async () => estimate))
    await expect(f.account.estimateFeeResult(6)).rejects.toThrow(TypeError)
    await expect(f.account.estimateFee(6)).resolves.toBe(estimate)
  })

it.each([undefined, null, '6', 0, -1, 1.5, 1009, 65535, NaN, Infinity])(
  'rejects invalid confirmation target before invoking native code: %p', async blocks => {
    const f = fixture()
    await expect(f.account.estimateFeeResult(blocks)).rejects.toThrow(RangeError)
    expect(f.reader.estimateFee).not.toHaveBeenCalled()
  })

it.each([1, 1008])('accepts target boundary %s', async blocks => {
  const f = fixture(jest.fn(async () => ({ fee_rate: 1 })))
  await expect(f.account.estimateFeeResult(blocks)).resolves.toMatchObject({ status: 'available' })
})
