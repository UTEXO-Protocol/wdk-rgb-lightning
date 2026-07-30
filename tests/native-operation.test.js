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
  const terminal = ['succeeded', 'failed', 'cancelled'].includes(state)
  const started = state !== 'queued'
  return {
    contract_version: 1,
    operation_id: '123e4567-e89b-42d3-a456-426614174000',
    kind: 'unlock_with_native_external_signer',
    state,
    created_at_ms: '1000',
    ...(started ? { started_at_ms: '1001' } : {}),
    ...(terminal ? { finished_at_ms: '1002' } : {}),
    updated_at_ms: terminal ? '1002' : started ? '1001' : '1000',
    cancellation_requested: state === 'cancel_requested',
    can_cancel_immediately: state === 'queued',
    adoption_count: 0,
    ...(state === 'failed' ? { error: 'NATIVE_OPERATION_FAILED' } : {}),
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
        cancellation_requested: true,
        started_at_ms: '1001'
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

  it('rejects identity changes and lifecycle regressions while polling', async () => {
    const node = {
      nativeOperationStatus: jest.fn()
        .mockReturnValueOnce(status('running'))
        .mockReturnValueOnce(status('queued', { updated_at_ms: '1001' }))
    }

    await expect(waitForNativeOperation(node, status('queued')))
      .rejects.toThrow('state regressed')

    node.nativeOperationStatus.mockReset()
    node.nativeOperationStatus.mockReturnValue(status('succeeded', {
      operation_id: '123e4567-e89b-42d3-a456-426614174001'
    }))
    await expect(waitForNativeOperation(node, status('running')))
      .rejects.toThrow('identity changed')
  })

  it('rejects incomplete and internally inconsistent status objects', () => {
    expect(() => validateNativeOperationStatus(status('queued', {
      created_at_ms: undefined
    }))).toThrow('invalid created_at_ms')
    expect(() => validateNativeOperationStatus(status('running', {
      can_cancel_immediately: true
    }))).toThrow('inconsistent state metadata')
    expect(() => validateNativeOperationStatus(status('succeeded', {
      error: 'unexpected'
    }))).toThrow('inconsistent state metadata')
  })
})
