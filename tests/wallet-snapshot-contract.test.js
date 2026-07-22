// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.

import { jest } from '@jest/globals'

import WalletAccountRgbLightning from '../src/wallet-account-rgb-lightning.js'
import {
  WalletSnapshotError,
  WalletSyncError
} from '../src/errors.js'
import {
  normalizeWalletSnapshotOptions,
  validateWalletSnapshotResponse,
  validateWalletSyncResponse
} from '../src/wallet-snapshot-contract.js'

function syncResult (overrides = {}) {
  return {
    contract_version: 1,
    mode: 'routine',
    vanilla: { status: 'succeeded' },
    colored: { status: 'succeeded' },
    ...overrides
  }
}

function snapshot (overrides = {}) {
  return {
    contract_version: 1,
    native_source: 'rgb-lightning-node-v0.9.0-beta.3+utexo-wallet-v1',
    capture_sequence: '1',
    started_at_ms: '1000',
    completed_at_ms: '1001',
    network_before: { network: 'regtest', height: 100 },
    network_after: { network: 'regtest', height: 100 },
    node: {
      pubkey: '02abc',
      num_channels: '1',
      num_usable_channels: '1',
      claimable_onchain_sat: '9007199254740993',
      eventual_close_fees_sat: '10',
      pending_outbound_payments_sat: '0',
      num_peers: '1',
      latest_rgs_snapshot_timestamp: null
    },
    btc: {
      vanilla: { settled: '42', future: '45', spendable: '40' },
      colored: { settled: '5', future: '5', spendable: '5' }
    },
    assets: [{
      asset_id: 'asset-1',
      ticker: 'USDT',
      name: 'Tether USD',
      precision: 2,
      balance: {
        settled: '100',
        future: '100',
        spendable: '80',
        offchain_outbound: '20',
        offchain_inbound: '30'
      }
    }],
    channels: [{
      channel_id: 'channel-1',
      peer_pubkey: '03def',
      status: 'Opened',
      ready: true,
      capacity_sat: '100000',
      claimable_onchain_sat: '60000',
      outbound_capacity_msat: '59000000',
      inbound_capacity_msat: '39000000',
      next_outbound_htlc_limit_msat: '58000000',
      next_outbound_htlc_minimum_msat: '1000',
      is_usable: true,
      public: false,
      funding_txid: null,
      peer_alias: null,
      short_channel_id: null,
      asset_id: 'asset-1',
      asset_local_amount: '20',
      asset_remote_amount: '30',
      virtual_open_mode: 'trusted_no_broadcast'
    }],
    ...overrides
  }
}

function activitySnapshot (overrides = {}) {
  return snapshot({
    transactions: [{
      transaction_type: 'Incoming',
      txid: 'txid-1',
      received: '42',
      sent: '0',
      fee: '0',
      confirmation_time: { height: 100, timestamp: '1000' }
    }],
    payments: [{
      amt_msat: '1000',
      asset_amount: null,
      asset_id: null,
      payment_hash: 'hash-1',
      payment_type: 'InboundAutoClaim',
      status: 'Succeeded',
      created_at: '1000',
      updated_at: '1001',
      payee_pubkey: '02abc'
    }],
    transfers: [{
      asset_id: 'asset-1',
      transfers: [{
        idx: 1,
        created_at: '1000',
        updated_at: '1001',
        status: 'Settled',
        requested_assignment: null,
        assignments: ['100'],
        kind: 'ReceiveWitness',
        txid: 'txid-1',
        recipient_id: null,
        receive_utxo: null,
        change_utxo: null,
        expiration: null,
        transport_endpoints: []
      }]
    }],
    ...overrides
  })
}

function accountWith (node) {
  return new WalletAccountRgbLightning({
    binding: {
      ensureNode: jest.fn(() => node),
      bootstrap: jest.fn(() => ({})),
      vssStatus: jest.fn(() => ({ configured: false })),
      shutdown: jest.fn()
    }
  })
}

describe('wallet snapshot option contract', () => {
  it('normalizes bounded defaults and exact native names', () => {
    const options = normalizeWalletSnapshotOptions()
    expect(options).toMatchObject({
      mode: 'routine',
      maxAssets: 128,
      maxChannels: 512,
      maxActivityItems: 1000,
      includeActivity: false,
      assetIds: []
    })
    expect(options.nativeRequest).toEqual({
      asset_ids: [],
      max_assets: 128,
      max_channels: 512,
      max_activity_items: 1000,
      include_activity: false
    })
    expect(Object.isFrozen(options.nativeRequest)).toBe(true)
  })

  it.each([
    [{ typo: true }, 'options.typo'],
    [{ mode: 'fast' }, 'options.mode'],
    [{ maxAssets: 0 }, 'options.maxAssets'],
    [{ maxChannels: 513 }, 'options.maxChannels'],
    [{ assetIds: ['same', 'same'] }, 'options.assetIds[1]']
  ])('rejects invalid options without silently applying defaults', (input, path) => {
    expect(() => normalizeWalletSnapshotOptions(input)).toThrow(path)
  })
})

describe('wallet snapshot response contract', () => {
  it('accepts exact decimal strings beyond Number.MAX_SAFE_INTEGER', () => {
    const options = normalizeWalletSnapshotOptions()
    const result = validateWalletSnapshotResponse(snapshot(), options)
    expect(result.node.claimable_onchain_sat).toBe('9007199254740993')
    expect(Object.isFrozen(result.channels[0])).toBe(true)
  })

  it('rejects unsafe JSON numbers and additive v1 fields', () => {
    const options = normalizeWalletSnapshotOptions()
    expect(() => validateWalletSnapshotResponse(snapshot({
      btc: {
        vanilla: { settled: Number.MAX_SAFE_INTEGER + 2, future: '45', spendable: '40' },
        colored: { settled: '5', future: '5', spendable: '5' }
      }
    }), options)).toThrow('snapshot.btc.vanilla.settled')
    expect(() => validateWalletSnapshotResponse(snapshot({ extra: true }), options))
      .toThrow('snapshot.extra')
  })

  it('rejects decimal text outside the native u64 domain and unknown networks', () => {
    const options = normalizeWalletSnapshotOptions()
    expect(() => validateWalletSnapshotResponse(snapshot({
      btc: {
        vanilla: {
          settled: '18446744073709551616',
          future: '45',
          spendable: '40'
        },
        colored: { settled: '5', future: '5', spendable: '5' }
      }
    }), options)).toThrow('snapshot.btc.vanilla.settled')
    expect(() => validateWalletSnapshotResponse(snapshot({
      network_before: { network: 'bitcoin', height: 100 }
    }), options)).toThrow('snapshot.network_before.network')
  })

  it('canonicalizes recognized legacy native network casing without mutating input', () => {
    const options = normalizeWalletSnapshotOptions()
    const value = snapshot({
      network_before: { network: 'Regtest', height: 100 },
      network_after: { network: 'REGTEST', height: 100 }
    })

    const result = validateWalletSnapshotResponse(value, options)

    expect(result.network_before.network).toBe('regtest')
    expect(result.network_after.network).toBe('regtest')
    expect(value.network_before.network).toBe('Regtest')
    expect(value.network_after.network).toBe('REGTEST')
  })

  it('does not reinterpret an unknown mixed-case network', () => {
    const options = normalizeWalletSnapshotOptions()

    expect(() => validateWalletSnapshotResponse(snapshot({
      network_before: { network: 'Bitcoin', height: 100 }
    }), options)).toThrow('snapshot.network_before.network')
  })

  it('requires the bounded activity envelope only when requested', () => {
    const options = normalizeWalletSnapshotOptions({
      includeActivity: true,
      assetIds: ['asset-1']
    })
    expect(() => validateWalletSnapshotResponse(snapshot(), options))
      .toThrow('snapshot.transactions')
    expect(validateWalletSnapshotResponse(activitySnapshot(), options).payments)
      .toHaveLength(1)
  })

  it('accepts transfer endpoint metadata and nullable transfer fields', () => {
    const options = normalizeWalletSnapshotOptions({
      includeActivity: true,
      assetIds: ['asset-1']
    })
    const value = activitySnapshot()
    value.transfers[0].transfers[0].transport_endpoints = [{
      endpoint: 'rpc://127.0.0.1:3000/json-rpc',
      transport_type: 'JsonRpc',
      used: true
    }]

    expect(validateWalletSnapshotResponse(value, options).transfers[0]
      .transfers[0].transport_endpoints[0].used).toBe(true)
  })

  it('accepts an unconfirmed transaction without block-time metadata', () => {
    const options = normalizeWalletSnapshotOptions({
      includeActivity: true,
      assetIds: ['asset-1']
    })
    const value = activitySnapshot()
    value.transactions[0].confirmation_time = null

    expect(validateWalletSnapshotResponse(value, options).transactions[0]
      .confirmation_time).toBeNull()
  })

  it.each([
    [null, 'snapshot'],
    [snapshot({ node: { ...snapshot().node, pubkey: '' } }), 'snapshot.node.pubkey'],
    [snapshot({ node: { ...snapshot().node, pubkey: 42 } }), 'snapshot.node.pubkey'],
    [snapshot({ node: { ...snapshot().node, pubkey: 'a'.repeat(131) } }), 'snapshot.node.pubkey'],
    [snapshot({ assets: {} }), 'snapshot.assets'],
    [snapshot({ contract_version: 2 }), 'snapshot.contract_version'],
    [snapshot({ native_source: 'untrusted-native' }), 'snapshot.native_source'],
    [snapshot({ started_at_ms: '1002', completed_at_ms: '1001' }), 'snapshot.completed_at_ms'],
    [snapshot({ capture_sequence: '0' }), 'snapshot.capture_sequence'],
    [snapshot({ channels: [{ ...snapshot().channels[0], ready: 'true' }] }), 'snapshot.channels[0].ready'],
    [snapshot({ assets: [snapshot().assets[0], snapshot().assets[0]] }), 'snapshot.assets[1].asset_id']
  ])('rejects malformed snapshot contract evidence', (value, path) => {
    const options = normalizeWalletSnapshotOptions()
    expect(() => validateWalletSnapshotResponse(value, options)).toThrow(path)
  })

  it('rejects activity for an asset that was not requested', () => {
    const options = normalizeWalletSnapshotOptions({
      includeActivity: true,
      assetIds: ['asset-1']
    })
    const value = activitySnapshot()
    value.transfers[0].asset_id = 'asset-2'

    expect(() => validateWalletSnapshotResponse(value, options))
      .toThrow('snapshot.transfers[0].asset_id')
  })

  it('bounds RGB transfers across every requested asset', () => {
    const options = normalizeWalletSnapshotOptions({
      includeActivity: true,
      assetIds: ['asset-1', 'asset-2'],
      maxActivityItems: 1
    })
    const value = activitySnapshot()
    value.transfers.push({
      asset_id: 'asset-2',
      transfers: [{ ...value.transfers[0].transfers[0], idx: 2 }]
    })

    expect(() => validateWalletSnapshotResponse(value, options))
      .toThrow('snapshot.transfers')
  })

  it('requires activity fields to be absent when activity was not requested', () => {
    const options = normalizeWalletSnapshotOptions()
    expect(() => validateWalletSnapshotResponse(snapshot({ transactions: [] }), options))
      .toThrow('snapshot.transactions')
  })

  it('requires every top-level snapshot field', () => {
    const options = normalizeWalletSnapshotOptions()
    const value = snapshot()
    delete value.node

    expect(() => validateWalletSnapshotResponse(value, options)).toThrow('snapshot.node')
  })

  it.each([
    [syncResult({ contract_version: 2 }), 'sync.contract_version'],
    [syncResult({ vanilla: { status: 'succeeded', error_code: 'IMPOSSIBLE' } }), 'sync.vanilla.error_code'],
    [null, 'sync']
  ])('rejects malformed sync contract evidence', (value, path) => {
    expect(() => validateWalletSyncResponse(value, 'routine')).toThrow(path)
  })

  it('rejects a sync response for a different requested mode', () => {
    expect(() => validateWalletSyncResponse(syncResult(), 'recovery'))
      .toThrow('sync.mode')
  })
})

describe('WalletAccountRgbLightning.refreshWalletSnapshot', () => {
  it('syncs both keychains then captures an immutable coherent snapshot', async () => {
    const node = {
      syncWallet: jest.fn(() => syncResult()),
      walletSnapshot: jest.fn(() => snapshot())
    }
    const account = accountWith(node)

    const result = await account.refreshWalletSnapshot()

    expect(node.syncWallet).toHaveBeenCalledWith({ mode: 'routine' })
    expect(node.walletSnapshot).toHaveBeenCalledWith({
      asset_ids: [],
      max_assets: 128,
      max_channels: 512,
      max_activity_items: 1000,
      include_activity: false
    })
    expect(result.contractVersion).toBe(1)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.snapshot.btc)).toBe(true)
  })

  it('preserves structured evidence when only one keychain fails', async () => {
    const node = {
      syncWallet: jest.fn(() => syncResult({
        vanilla: { status: 'failed', error_code: 'FAILED_BDK_SYNC' }
      })),
      walletSnapshot: jest.fn()
    }
    const error = await accountWith(node).refreshWalletSnapshot().catch((reason) => reason)

    expect(error).toBeInstanceOf(WalletSyncError)
    expect(error.code).toBe('WALLET_SYNC_PARTIAL_FAILURE')
    expect(error.details.vanilla).toEqual({
      status: 'failed',
      error_code: 'FAILED_BDK_SYNC'
    })
    expect(node.walletSnapshot).not.toHaveBeenCalled()
  })

  it('uses FullScan recovery mode only when explicitly selected', async () => {
    const node = {
      syncWallet: jest.fn(() => syncResult({ mode: 'recovery' })),
      walletSnapshot: jest.fn(() => snapshot())
    }
    await accountWith(node).refreshWalletSnapshot({ mode: 'recovery' })
    expect(node.syncWallet).toHaveBeenCalledWith({ mode: 'recovery' })
  })

  it('retries one incoherent capture and returns the coherent retry', async () => {
    const node = {
      syncWallet: jest.fn(() => syncResult()),
      walletSnapshot: jest.fn()
        .mockReturnValueOnce(snapshot({
          capture_sequence: '7',
          network_after: { network: 'regtest', height: 101 }
        }))
        .mockReturnValueOnce(snapshot({ capture_sequence: '8' }))
    }
    const result = await accountWith(node).refreshWalletSnapshot()
    expect(node.syncWallet).toHaveBeenCalledTimes(2)
    expect(node.walletSnapshot).toHaveBeenCalledTimes(2)
    expect(result.snapshot.capture_sequence).toBe('8')
  })

  it('fails before the retry capture when re-synchronization fails', async () => {
    const node = {
      syncWallet: jest.fn()
        .mockReturnValueOnce(syncResult())
        .mockReturnValueOnce(syncResult({
          vanilla: { status: 'failed', error_code: 'FAILED_BDK_SYNC' }
        })),
      walletSnapshot: jest.fn(() => snapshot({
        capture_sequence: '7',
        network_after: { network: 'regtest', height: 101 }
      }))
    }
    const error = await accountWith(node).refreshWalletSnapshot().catch((reason) => reason)

    expect(error).toBeInstanceOf(WalletSyncError)
    expect(error.code).toBe('WALLET_SYNC_PARTIAL_FAILURE')
    expect(node.walletSnapshot).toHaveBeenCalledTimes(1)
  })

  it('fails closed when both capture attempts cross a chain tip', async () => {
    const node = {
      syncWallet: jest.fn(() => syncResult()),
      walletSnapshot: jest.fn()
        .mockReturnValueOnce(snapshot({
          capture_sequence: '7',
          network_after: { network: 'regtest', height: 101 }
        }))
        .mockReturnValueOnce(snapshot({
          capture_sequence: '8',
          network_after: { network: 'regtest', height: 101 }
        }))
    }
    const error = await accountWith(node).refreshWalletSnapshot().catch((reason) => reason)
    expect(error).toBeInstanceOf(WalletSnapshotError)
    expect(error.code).toBe('WALLET_SNAPSHOT_INCOHERENT')
  })

  it('fails closed when an incoherent retry does not advance its capture sequence', async () => {
    const node = {
      syncWallet: jest.fn(() => syncResult()),
      walletSnapshot: jest.fn(() => snapshot({
        capture_sequence: '7',
        network_after: { network: 'regtest', height: 101 }
      }))
    }
    const error = await accountWith(node).refreshWalletSnapshot().catch((reason) => reason)

    expect(error).toBeInstanceOf(WalletSnapshotError)
    expect(error.code).toBe('WALLET_SNAPSHOT_CONTRACT_MISMATCH')
    expect(error.details).toEqual({
      firstCaptureSequence: '7',
      retryCaptureSequence: '7'
    })
  })

  it.each([
    [new Error('native sync failed'), 'WALLET_SYNC_NATIVE_FAILURE'],
    [syncResult({ contract_version: 2 }), 'WALLET_SYNC_CONTRACT_MISMATCH']
  ])('classifies native and contract sync failures', async (outcome, code) => {
    const node = {
      syncWallet: jest.fn(() => {
        if (outcome instanceof Error) throw outcome
        return outcome
      }),
      walletSnapshot: jest.fn()
    }
    const error = await accountWith(node).refreshWalletSnapshot().catch((reason) => reason)

    expect(error).toBeInstanceOf(WalletSyncError)
    expect(error.code).toBe(code)
    if (code === 'WALLET_SYNC_CONTRACT_MISMATCH') {
      expect(error.message).toContain('sync.contract_version must equal 1')
      expect(error.details).toEqual({
        mode: 'routine',
        contractPath: 'sync.contract_version',
        contractExpectation: 'must equal 1'
      })
    }
  })

  it.each([
    [new Error('native snapshot failed'), 'WALLET_SNAPSHOT_NATIVE_FAILURE'],
    [snapshot({ contract_version: 2 }), 'WALLET_SNAPSHOT_CONTRACT_MISMATCH'],
    [new WalletSnapshotError('native typed failure', { code: 'NATIVE_TYPED_FAILURE' }), 'NATIVE_TYPED_FAILURE']
  ])('classifies native, contract, and typed snapshot failures', async (outcome, code) => {
    const node = {
      syncWallet: jest.fn(() => syncResult()),
      walletSnapshot: jest.fn(() => {
        if (outcome instanceof Error) throw outcome
        return outcome
      })
    }
    const error = await accountWith(node).refreshWalletSnapshot().catch((reason) => reason)

    expect(error).toBeInstanceOf(WalletSnapshotError)
    expect(error.code).toBe(code)
    if (code === 'WALLET_SNAPSHOT_CONTRACT_MISMATCH') {
      expect(error.message).toContain('snapshot.contract_version must equal 1')
      expect(error.details).toEqual({
        contractPath: 'snapshot.contract_version',
        contractExpectation: 'must equal 1'
      })
    }
  })

  it('coalesces identical refreshes and serializes different modes', async () => {
    let releaseRoutine
    const routine = new Promise((resolve) => { releaseRoutine = resolve })
    const node = {
      syncWallet: jest.fn(({ mode }) => mode === 'routine'
        ? routine
        : syncResult({ mode: 'recovery' })),
      walletSnapshot: jest.fn(() => snapshot())
    }
    const account = accountWith(node)
    const first = account.refreshWalletSnapshot()
    const duplicate = account.refreshWalletSnapshot()
    const recovery = account.refreshWalletSnapshot({ mode: 'recovery' })

    expect(duplicate).toBe(first)
    await Promise.resolve()
    expect(node.syncWallet).toHaveBeenCalledTimes(1)
    releaseRoutine(syncResult())
    await first
    await recovery
    expect(node.syncWallet.mock.calls.map(([request]) => request.mode))
      .toEqual(['routine', 'recovery'])
  })

  it('keeps the serialized refresh queue usable after a failed request', async () => {
    const node = {
      syncWallet: jest.fn()
        .mockReturnValueOnce(syncResult({ contract_version: 2 }))
        .mockReturnValueOnce(syncResult({ mode: 'recovery' })),
      walletSnapshot: jest.fn(() => snapshot())
    }
    const account = accountWith(node)
    const failed = account.refreshWalletSnapshot()
    const recovery = account.refreshWalletSnapshot({ mode: 'recovery' })

    await expect(failed).rejects.toMatchObject({ code: 'WALLET_SYNC_CONTRACT_MISMATCH' })
    await expect(recovery).resolves.toMatchObject({
      sync: { mode: 'recovery' },
      snapshot: { capture_sequence: '1' }
    })
  })

  it('reports old native packages as an explicit compatibility error', async () => {
    const error = await accountWith({ sync: jest.fn() })
      .refreshWalletSnapshot()
      .catch((reason) => reason)
    expect(error).toBeInstanceOf(WalletSnapshotError)
    expect(error.code).toBe('WALLET_SNAPSHOT_UNSUPPORTED_BINDING')
  })
})
