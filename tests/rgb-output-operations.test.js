// Copyright 2026 UTEXO. Licensed under the Apache License, Version 2.0.
import { jest } from '@jest/globals'
import WalletAccount from '../src/wallet-account-rgb-lightning.js'
import { AccountLockedError } from '../src/errors.js'
import {
  nativeRgbOutputSetupCapabilities, validateCreateUtxosOperation,
  validateCreateUtxosOperations, validatePendingVanillaTransactions,
  RGB_OUTPUT_OPERATIONS_CAPABILITY
} from '../src/rgb-output-operations.js'

const operationId = 'ab'.repeat(16)
const txid = 'cd'.repeat(32)
const input = { txid: 'ef'.repeat(32), vout: 1 }
const request = { operation_id: operationId, up_to: false, num: 4, size: 20000, fee_rate: 2, skip_sync: false }
const operation = (overrides = {}) => ({
  operation_id: operationId,
  txid,
  status: 'prepared',
  can_cancel: overrides.status === undefined || overrides.status === 'prepared',
  can_commit: overrides.status === undefined || ['prepared', 'submitting'].includes(overrides.status),
  inputs: [{ ...input }],
  num_outputs: 4,
  size_sat: 20000,
  fee_sat: 382,
  fee_rate: 2,
  ...overrides
})
const deferred = () => {
  let resolveDeferred, rejectDeferred
  const promise = new Promise((resolve, reject) => { resolveDeferred = resolve; rejectDeferred = reject })
  return { promise, resolve: resolveDeferred, reject: rejectDeferred }
}
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
function fixture (native = {}, bindingOptions = {}) {
  const node = {
    prepareCreateUtxos: jest.fn(() => operation()),
    commitPreparedCreateUtxos: jest.fn(() => operation({ status: 'broadcast' })),
    cancelCreateUtxosPlan: jest.fn(() => operation({ status: 'cancelled' })),
    getCreateUtxosOperation: jest.fn(() => operation()),
    listCreateUtxosOperations: jest.fn(() => [operation()]),
    listPendingVanillaTransactions: jest.fn(() => [{ txid, type: 'CreateUtxos' }]),
    createUtxos: jest.fn(),
    ...native
  }
  const binding = {
    ensureNode: jest.fn(() => node),
    getRgbOutputSetupCapabilities: jest.fn(() => ({ supported: true })),
    vssStatus: () => ({ configured: false }),
    shutdown: jest.fn(),
    ...bindingOptions
  }
  return { account: new WalletAccount({ binding }), node, binding }
}

describe('operation-owned RGB output native boundary', () => {
  it('returns exact native transaction, fee, input and actual output count instead of history inference', async () => {
    const result = operation({ num_outputs: 3, fee_sat: '9007199254740993', fee_rate: '18446744073709551615' })
    const { account, node } = fixture({ prepareCreateUtxos: jest.fn(() => result) })
    await expect(account.prepareCreateUtxos(request)).resolves.toEqual(result)
    expect(node.prepareCreateUtxos).toHaveBeenCalledWith(request)
    expect(node.createUtxos).not.toHaveBeenCalled()
    expect(result.inputs).toEqual([input])
  })

  it.each(['commitPreparedCreateUtxos', 'cancelCreateUtxosPlan', 'getCreateUtxosOperation'])(
    '%s forwards only exact durable operation identity once', async method => {
      const { account, node } = fixture()
      await expect(account[method]({ operation_id: operationId })).resolves.toMatchObject({ operation_id: operationId, txid })
      expect(node[method]).toHaveBeenCalledTimes(1)
      expect(node[method]).toHaveBeenCalledWith({ operation_id: operationId })
      expect(node.createUtxos).not.toHaveBeenCalled()
    })

  it('preserves missing operation null and the full recovery inventory', async () => {
    const { account, node } = fixture({ getCreateUtxosOperation: jest.fn(() => null) })
    await expect(account.getCreateUtxosOperation({ operation_id: operationId })).resolves.toBeNull()
    await expect(account.listCreateUtxosOperations()).resolves.toEqual([operation()])
    await expect(account.listPendingVanillaTransactions()).resolves.toEqual([{ txid, type: 'CreateUtxos' }])
    expect(node.listCreateUtxosOperations).toHaveBeenCalledWith()
    expect(node.listPendingVanillaTransactions).toHaveBeenCalledWith()
  })

  it.each(['prepareCreateUtxos', 'commitPreparedCreateUtxos', 'cancelCreateUtxosPlan', 'getCreateUtxosOperation'])(
    '%s passes native rejection through without retry or legacy fallback', async method => {
      const failure = new Error('broadcast outcome unknown; retain signed transaction')
      const { account, node } = fixture({ [method]: jest.fn(() => { throw failure }) })
      await expect(account[method](method === 'prepareCreateUtxos' ? request : { operation_id: operationId })).rejects.toBe(failure)
      expect(node[method]).toHaveBeenCalledTimes(1)
      expect(node.createUtxos).not.toHaveBeenCalled()
    })

  it('does not transform submitting into success, cancellation or a replacement transaction', async () => {
    const result = operation({ status: 'submitting' })
    const { account, node } = fixture({ commitPreparedCreateUtxos: jest.fn(() => result) })
    await expect(account.commitPreparedCreateUtxos({ operation_id: operationId })).resolves.toEqual(result)
    expect(node.prepareCreateUtxos).not.toHaveBeenCalled()
    expect(node.cancelCreateUtxosPlan).not.toHaveBeenCalled()
  })

  it.each([undefined, null, {}, [], 'ab', { ...request, operation_id: 'AB'.repeat(16) },
    { ...request, operation_id: 'a'.repeat(31) }, { ...request, operation_id: 'a'.repeat(65) },
    { ...request, up_to: 1 }, { ...request, skip_sync: 'false' }, { ...request, num: 0 },
    { ...request, num: 256 }, { ...request, size: 0 }, { ...request, size: 4294967296 },
    { ...request, fee_rate: 0 }, { ...request, fee_rate: 1.5 }, { ...request, fee_rate: 2 ** 53 },
    { ...request, fee_rate: '01' }, { ...request, fee_rate: '18446744073709551616' },
    { ...request, plan_id: 'wrong-owner' }])('rejects invalid prepare %j before native access', async bad => {
    const { account, binding, node } = fixture()
    await expect(account.prepareCreateUtxos(bad)).rejects.toThrow()
    expect(binding.ensureNode).not.toHaveBeenCalled()
    expect(node.prepareCreateUtxos).not.toHaveBeenCalled()
  })

  it.each(['commitPreparedCreateUtxos', 'cancelCreateUtxosPlan', 'getCreateUtxosOperation'])(
    '%s rejects extra transaction material or another plan before native access', async method => {
      const { account, binding } = fixture()
      for (const bad of [{ plan_id: operationId }, { operation_id: operationId, txid },
        { operation_id: operationId, psbt: 'attacker-supplied' }]) {
        await expect(account[method](bad)).rejects.toThrow()
      }
      expect(binding.ensureNode).not.toHaveBeenCalled()
    })

  it.each(['prepareCreateUtxos', 'commitPreparedCreateUtxos', 'cancelCreateUtxosPlan',
    'getCreateUtxosOperation', 'listCreateUtxosOperations', 'listPendingVanillaTransactions'])(
    '%s refuses missing native operation capability without creating a handle', async method => {
      const { account, binding } = fixture({}, { getRgbOutputSetupCapabilities: () => ({ supported: false }) })
      await expect(account[method](method === 'prepareCreateUtxos' ? request : { operation_id: operationId }))
        .rejects.toMatchObject({ code: 'ERR_RGB_OUTPUT_OPERATIONS_UNAVAILABLE' })
      expect(binding.ensureNode).not.toHaveBeenCalled()
    })

  it.each(['prepareCreateUtxos', 'commitPreparedCreateUtxos', 'cancelCreateUtxosPlan',
    'getCreateUtxosOperation', 'listCreateUtxosOperations', 'listPendingVanillaTransactions'])(
    '%s cannot access native state after shutdown', async method => {
      const { account, binding } = fixture()
      await account.shutdown()
      await expect(account[method](method === 'prepareCreateUtxos' ? request : { operation_id: operationId }))
        .rejects.toBeInstanceOf(AccountLockedError)
      expect(binding.ensureNode).not.toHaveBeenCalled()
    })
})

describe('native recovery evidence admission', () => {
  it.each(['preparing', 'prepared', 'submitting', 'broadcast', 'confirmed', 'cancelled', 'failed'])(
    'admits documented status %s without inventing phase transitions', status => {
      expect(validateCreateUtxosOperation(operation({ status }))).toEqual(operation({ status }))
    })

  it('preserves restored prepared evidence with exact commit but no cancellation permission', () => {
    const restored = operation({ can_cancel: false, can_commit: true })
    expect(validateCreateUtxosOperation(restored)).toEqual(restored)
  })

  it('admits interrupted preparing before transaction identity exists', () => {
    const result = operation({ status: 'preparing', txid: null, inputs: [], num_outputs: 0, fee_sat: 0 })
    expect(validateCreateUtxosOperation(result)).toEqual(result)
  })

  it.each([null, {}, [], operation({ operation_id: 'AB'.repeat(16) }), operation({ status: 'ok' }),
    operation({ txid: null }), operation({ inputs: [] }), operation({ inputs: [input, input] }),
    operation({ inputs: [{ ...input, vout: -1 }] }), operation({ inputs: [{ ...input, private_key: 'secret' }] }),
    operation({ can_cancel: 'true' }), operation({ can_commit: false }),
    operation({ status: 'broadcast', can_cancel: true }), operation({ status: 'cancelled', can_commit: true }),
    operation({ num_outputs: 0 }), operation({ num_outputs: 256 }), operation({ size_sat: 0 }),
    operation({ fee_sat: 0 }), operation({ fee_sat: 2 ** 53 }), operation({ fee_sat: '1e3' }),
    operation({ fee_rate: '18446744073709551616' }), operation({ psbt: 'private-transport' })])(
    'rejects invalid recovery evidence %j', value => {
      expect(() => validateCreateUtxosOperation(value)).toThrow()
    })

  it('rejects a well-formed response for a different durable operation', async () => {
    const { account } = fixture({ prepareCreateUtxos: jest.fn(() => operation({ operation_id: '01'.repeat(16) })) })
    await expect(account.prepareCreateUtxos(request)).rejects.toThrow('identity')
  })

  it('rejects duplicate and malformed operation/reservation inventories', () => {
    expect(() => validateCreateUtxosOperations([operation(), operation()])).toThrow('repeat')
    expect(() => validateCreateUtxosOperations(new Array(10001).fill(operation()))).toThrow()
    expect(() => validatePendingVanillaTransactions([{ txid, type: 'CreateUtxos' }, { txid, type: 'CreateUtxos' }])).toThrow('repeat')
    expect(() => validatePendingVanillaTransactions([{ txid, type: 'unknown' }])).toThrow()
    expect(() => validatePendingVanillaTransactions([{ txid, type: 'SendBtc', inputs: [] }])).toThrow()
  })
})

describe('capability truth and native operation ownership', () => {
  it('requires both compiled native capability and every real facade method without creating a wallet', () => {
    const SdkNode = {
      prototype: Object.fromEntries(['prepareCreateUtxos', 'commitPreparedCreateUtxos',
        'cancelCreateUtxosPlan', 'getCreateUtxosOperation', 'listCreateUtxosOperations', 'listPendingVanillaTransactions']
        .map(method => [method, jest.fn()]))
    }
    const native = { getRuntimeInfo: () => ({ capabilities: [RGB_OUTPUT_OPERATIONS_CAPABILITY] }), SdkNode }
    expect(nativeRgbOutputSetupCapabilities(native)).toEqual({ supported: true })
    expect(nativeRgbOutputSetupCapabilities({ ...native, getRuntimeInfo: () => ({ capabilities: [] }) })).toEqual({ supported: false })
    for (const method of Object.keys(SdkNode.prototype)) {
      expect(nativeRgbOutputSetupCapabilities({
        ...native,
        SdkNode: { prototype: { ...SdkNode.prototype, [method]: undefined } }
      })).toEqual({ supported: false })
    }
    for (const method of Object.values(SdkNode.prototype)) expect(method).not.toHaveBeenCalled()
  })

  it('does not let a pending remote backup hold the unsigned output review', async () => {
    const cloud = deferred()
    const { account, binding, node } = fixture({}, {
      vssStatus: () => ({ configured: true }),
      getVssBackupMetadata: () => ({ automatic_backup_enabled: true }),
      vssBackup: jest.fn(() => cloud.promise)
    })
    await expect(account.prepareCreateUtxos(request)).resolves.toEqual(operation())
    await flush()
    expect(binding.vssBackup).toHaveBeenCalledTimes(1)
    const stopping = account.shutdown()
    await flush()
    expect(binding.shutdown).not.toHaveBeenCalled()
    cloud.resolve({ version: 1 })
    await stopping
    expect(binding.shutdown).toHaveBeenCalledTimes(1)
    expect(node.prepareCreateUtxos).toHaveBeenCalledTimes(1)
  })

  it.each(['getCreateUtxosOperation', 'listCreateUtxosOperations', 'listPendingVanillaTransactions'])(
    'joins %s at shutdown without manufacturing a new cloud backup', async method => {
      const read = deferred()
      const { account, binding } = fixture({ [method]: jest.fn(() => read.promise) }, {
        vssStatus: () => ({ configured: true }), vssBackup: jest.fn()
      })
      const pending = account[method]({ operation_id: operationId })
      await flush()
      const stopping = account.shutdown()
      await flush()
      expect(binding.shutdown).not.toHaveBeenCalled()
      const result = method === 'getCreateUtxosOperation'
        ? operation()
        : method === 'listCreateUtxosOperations' ? [operation()] : [{ txid, type: 'CreateUtxos' }]
      read.resolve(result)
      await pending
      await stopping
      expect(binding.vssBackup).not.toHaveBeenCalled()
      expect(binding.shutdown).toHaveBeenCalledTimes(1)
    })
})
