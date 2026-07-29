// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.

import { jest } from '@jest/globals'

import {
  validateNativeOperationStatus,
  waitForNativeOperation
} from '../src/native-operation.js'

function status (state, overrides = {}) {
  return {
    contract_version: 1,
    operation_id: 'operation-1',
    kind: 'unlock_with_native_external_signer',
    state,
    cancellation_requested: state === 'cancel_requested',
    ...overrides
  }
}

describe('native operation lifecycle', () => {
  it('polls an adoptable operation until native success', async () => {
    const node = {
      nativeOperationStatus: jest.fn()
        .mockReturnValueOnce(status('running'))
        .mockReturnValueOnce(status('succeeded')),
      cancelNativeOperation: jest.fn()
    }

    await expect(waitForNativeOperation(node, status('queued')))
      .resolves.toMatchObject({ state: 'succeeded' })
    expect(node.nativeOperationStatus).toHaveBeenCalledTimes(2)
    expect(node.cancelNativeOperation).not.toHaveBeenCalled()
  })

  it('requests cancellation once and waits for the native terminal state', async () => {
    const signal = { aborted: true }
    const node = {
      cancelNativeOperation: jest.fn(() => status('cancel_requested')),
      nativeOperationStatus: jest.fn(() => status('cancelled', {
        cancellation_requested: true
      }))
    }

    await expect(waitForNativeOperation(node, status('running'), signal))
      .rejects.toThrow('cancelled before it started')
    expect(node.cancelNativeOperation).toHaveBeenCalledTimes(1)
    expect(node.nativeOperationStatus).toHaveBeenCalledTimes(1)
  })

  it('surfaces the sanitized native terminal failure', async () => {
    await expect(waitForNativeOperation({}, status('failed', {
      error: 'INDEXER_UNAVAILABLE'
    }))).rejects.toThrow('INDEXER_UNAVAILABLE')
  })

  it('rejects unknown states and unsupported contract versions', () => {
    expect(() => validateNativeOperationStatus(status('unknown')))
      .toThrow('Unknown native operation state')
    expect(() => validateNativeOperationStatus(status('queued', {
      contract_version: 2
    }))).toThrow('Unsupported native operation contract version')
  })
})
