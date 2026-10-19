// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.

import { jest } from '@jest/globals'
import rln from '@utexo/rgb-lightning-node-bare'
import { BareRgbLightningBinding } from '../src/bare-binding.js'

const UNLOCK = Object.freeze({ ldk_chain_sync: Object.freeze({ mode: 'TransactionSync', config: Object.freeze({ indexer_url: 'electrum://localhost:50001' }) }), announce_addresses: [] })

function makeBinding (overrides = {}) {
  return new BareRgbLightningBinding({ network: 'regtest', dataDir: '/d', ...overrides })
}

function fakeNode () {
  return {
    initWithNativeExternalSigner: jest.fn(),
    unlockWithNativeExternalSigner: jest.fn(),
    vssClearFence: jest.fn(),
    vssBackup: jest.fn(() => ({ version: 7 })),
    apayNew: jest.fn(() => ({ order_id: 'order-1' })),
    shutdown: jest.fn()
  }
}

function fakeSigner () {
  return {
    bootstrap: jest.fn(() => ({ node_id: '03beef' })),
    shutdown: jest.fn(),
    destroy: jest.fn()
  }
}

afterEach(() => {
  jest.restoreAllMocks()
})

describe('BareRgbLightningBinding', () => {
  it('maps config and caches the native node handle', () => {
    const node = fakeNode()
    const createSpy = jest.spyOn(rln.SdkNode, 'create').mockReturnValue(node)
    const binding = makeBinding({
      virtualPeerPubkeys: ['02lsp'],
      lspBaseUrl: 'https://lsp.example',
      lspBearerToken: 'token'
    })

    expect(binding.ensureNode()).toBe(node)
    expect(binding.ensureNode()).toBe(node)
    expect(createSpy).toHaveBeenCalledTimes(1)
    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({
      storage_dir_path: '/d',
      network: 'regtest',
      reuse_addresses: true,
      virtual_peer_pubkeys: ['02lsp'],
      lsp_base_url: 'https://lsp.example',
      lsp_bearer_token: 'token'
    }))
    expect(makeBinding({ virtualPeerPubkeys: [] })._initRequest).not.toHaveProperty('virtual_peer_pubkeys')
  })

  it('retains primary and fallback seeds without constructing the fallback eagerly', () => {
    const signer = fakeSigner()
    const createSpy = jest.spyOn(rln.NativeExternalSigner, 'createWithStorage').mockReturnValue(signer)
    const binding = makeBinding({ permissiveSignerPolicy: false })

    binding.attachExternalSigner('seed-v2', 'seed-v1')

    expect(createSpy).toHaveBeenCalledTimes(1)
    expect(createSpy).toHaveBeenCalledWith('seed-v2', 'regtest', '/d/vls-signer', false)
    expect(binding._signer).toBe(signer)
    expect(binding._seedHex.toString()).toBe('seed-v2')
    expect(binding._fallbackSeedHex.toString()).toBe('seed-v1')
  })

  it('keeps same-seed attachment idempotent and rejects a wallet swap', () => {
    const signer = fakeSigner()
    const createSpy = jest.spyOn(rln.NativeExternalSigner, 'createWithStorage').mockReturnValue(signer)
    const binding = makeBinding()

    binding.attachExternalSigner('seed-v2', 'seed-old')
    const oldFallback = binding._fallbackSeedHex
    binding.attachExternalSigner('seed-v2', 'seed-v1')

    expect(createSpy).toHaveBeenCalledTimes(1)
    expect(createSpy).toHaveBeenCalledWith('seed-v2', 'regtest', '/d/vls-signer', false)
    expect(binding._fallbackSeedHex.toString()).toBe('seed-v1')
    expect(oldFallback.every((byte) => byte === 0)).toBe(true)
    expect(() => binding.attachExternalSigner('seed-v3')).toThrow('a different signer is already attached')

    const externallyAttached = makeBinding()
    externallyAttached._signer = signer
    expect(() => externallyAttached.attachExternalSigner('unknown-seed')).not.toThrow()
    expect(externallyAttached._seedHex).toBeUndefined()
  })

  it('requires a signer before unlock and bootstrap', () => {
    const binding = makeBinding()
    binding._node = fakeNode()

    expect(() => binding.unlock(UNLOCK)).toThrow('attachExternalSigner')
    expect(() => binding.bootstrap()).toThrow('attachExternalSigner')
  })

  it('initializes once and wipes an unused fallback after primary unlock', () => {
    const binding = makeBinding()
    const node = fakeNode()
    const signer = fakeSigner()
    const fallbackSeed = Buffer.from('seed-v1')
    binding._node = node
    binding._signer = signer
    binding._fallbackSeedHex = fallbackSeed

    binding.unlock(UNLOCK)
    binding.unlock(UNLOCK)

    expect(node.initWithNativeExternalSigner).toHaveBeenCalledTimes(1)
    expect(node.unlockWithNativeExternalSigner).toHaveBeenCalledTimes(2)
    expect(binding._fallbackSeedHex).toBeUndefined()
    expect(fallbackSeed.every((byte) => byte === 0)).toBe(true)
  })

  it('accepts an existing SDK init but rethrows unrelated init failures', () => {
    const existing = makeBinding()
    const existingNode = fakeNode()
    existingNode.initWithNativeExternalSigner.mockImplementation(() => {
      throw new Error('Rln(Conflict): already initialized')
    })
    existing._node = existingNode
    existing._signer = fakeSigner()

    expect(() => existing.unlock(UNLOCK)).not.toThrow()
    expect(existingNode.unlockWithNativeExternalSigner).toHaveBeenCalledTimes(1)

    const failing = makeBinding()
    const failingNode = fakeNode()
    // eslint-disable-next-line no-throw-literal
    failingNode.initWithNativeExternalSigner.mockImplementation(() => { throw 'init failed' })
    failing._node = failingNode
    failing._signer = fakeSigner()

    expect(() => failing.unlock(UNLOCK)).toThrow('init failed')
    expect(failingNode.unlockWithNativeExternalSigner).not.toHaveBeenCalled()
    expect(failing._sdkInitDone).toBe(false)
  })

  it('replaces a mismatched primary signer with the legacy signer', () => {
    const binding = makeBinding()
    const node = fakeNode()
    const fallbackNode = fakeNode()
    jest.spyOn(rln.SdkNode, 'create').mockReturnValue(fallbackNode)
    const primarySigner = fakeSigner()
    const fallbackSigner = fakeSigner()
    const primarySeed = Buffer.from('seed-v2')
    const fallbackSeed = Buffer.from('seed-v1')
    node.unlockWithNativeExternalSigner
      .mockImplementationOnce(() => {
        throw new Error('external signer identity does not match persisted key_source.json')
      })
      .mockImplementationOnce(() => undefined)
    const createSpy = jest.spyOn(rln.NativeExternalSigner, 'createWithStorage')
      .mockReturnValue(fallbackSigner)
    binding._node = node
    binding._signer = primarySigner
    binding._seedHex = primarySeed
    binding._fallbackSeedHex = fallbackSeed

    binding.unlock(UNLOCK)

    expect(primarySigner.destroy).toHaveBeenCalledTimes(1)
    expect(node.shutdown).toHaveBeenCalledTimes(1)
    expect(node.shutdown.mock.invocationCallOrder[0]).toBeLessThan(primarySigner.shutdown.mock.invocationCallOrder[0])
    expect(primarySigner.shutdown.mock.invocationCallOrder[0]).toBeLessThan(primarySigner.destroy.mock.invocationCallOrder[0])
    expect(createSpy).toHaveBeenCalledWith(
      'seed-v1',
      'regtest',
      '/d/vls-signer-legacy',
      false
    )
    expect(binding._signer).toBe(fallbackSigner)
    expect(binding._seedHex).toBe(fallbackSeed)
    expect(binding._fallbackSeedHex).toBeUndefined()
    expect(primarySeed.every((byte) => byte === 0)).toBe(true)
    expect(node.unlockWithNativeExternalSigner).toHaveBeenCalledTimes(1)
    expect(fallbackNode.unlockWithNativeExternalSigner).toHaveBeenCalledWith(fallbackSigner, UNLOCK)
    expect(binding._node).toBe(fallbackNode)
  })

  it('destroys the fallback signer if the primary signer cannot be released', () => {
    const binding = makeBinding()
    const node = fakeNode()
    const primarySigner = fakeSigner()
    const fallbackSigner = fakeSigner()
    const destroyError = new Error('primary signer destroy failed')
    const primarySeed = Buffer.from('seed-v2')
    const fallbackSeed = Buffer.from('seed-v1')
    primarySigner.destroy.mockImplementation(() => { throw destroyError })
    node.unlockWithNativeExternalSigner.mockImplementation(() => {
      throw new Error('Rln(ExternalSignerMismatch): identity mismatch')
    })
    jest.spyOn(rln.NativeExternalSigner, 'createWithStorage').mockReturnValue(fallbackSigner)
    binding._node = node
    binding._signer = primarySigner
    binding._seedHex = primarySeed
    binding._fallbackSeedHex = fallbackSeed

    expect(() => binding.unlock(UNLOCK)).toThrow(destroyError)
    expect(fallbackSigner.shutdown).toHaveBeenCalledTimes(1)
    expect(fallbackSigner.destroy).toHaveBeenCalledTimes(1)
    expect(binding._signer).toBe(primarySigner)
    expect(binding._seedHex).toBe(primarySeed)
    expect(binding._fallbackSeedHex).toBe(fallbackSeed)
    expect(node.unlockWithNativeExternalSigner).toHaveBeenCalledTimes(1)
  })

  it('does not revoke a primary signer when failed-unlock node shutdown fails', () => {
    const binding = makeBinding()
    const node = fakeNode()
    const primarySigner = fakeSigner()
    const fallbackSigner = fakeSigner()
    node.unlockWithNativeExternalSigner.mockImplementation(() => {
      throw new Error('Rln(ExternalSignerMismatch): identity mismatch')
    })
    node.shutdown.mockImplementationOnce(() => { throw new Error('node shutdown failed') })
    jest.spyOn(rln.NativeExternalSigner, 'createWithStorage').mockReturnValue(fallbackSigner)
    binding._node = node
    binding._signer = primarySigner
    binding._fallbackSeedHex = Buffer.from('seed-v1')

    expect(() => binding.unlock(UNLOCK)).toThrow('node shutdown failed')
    expect(primarySigner.shutdown).not.toHaveBeenCalled()
    expect(primarySigner.destroy).not.toHaveBeenCalled()
    expect(fallbackSigner.shutdown).toHaveBeenCalledTimes(1)
    expect(fallbackSigner.destroy).toHaveBeenCalledTimes(1)
    expect(() => binding.ensureNode()).toThrow()
    binding.shutdown()
    expect(primarySigner.shutdown).toHaveBeenCalledTimes(1)
    expect(primarySigner.destroy).toHaveBeenCalledTimes(1)
  })

  it('does not replace the signer for an unrelated unlock failure', () => {
    const binding = makeBinding()
    const node = fakeNode()
    const signer = fakeSigner()
    // eslint-disable-next-line no-throw-literal
    node.unlockWithNativeExternalSigner.mockImplementation(() => { throw 'backend unavailable' })
    binding._node = node
    binding._signer = signer
    binding._fallbackSeedHex = Buffer.from('seed-v1')

    expect(() => binding.unlock(UNLOCK)).toThrow('backend unavailable')
    expect(binding._signer).toBe(signer)
    expect(node.unlockWithNativeExternalSigner).toHaveBeenCalledTimes(1)
  })

  it.each(['shutdown', 'destroy'])('retains failed fallback %s for explicit cleanup retry', (failureMethod) => {
    const binding = makeBinding()
    const node = fakeNode()
    const primarySigner = fakeSigner()
    const fallbackSigner = fakeSigner()
    const primaryError = new Error('primary signer destroy failed')
    const fallbackError = new Error('fallback signer destroy failed')
    primarySigner.destroy.mockImplementation(() => { throw primaryError })
    fallbackSigner[failureMethod].mockImplementation(() => { throw fallbackError })
    node.unlockWithNativeExternalSigner.mockImplementation(() => {
      throw new Error('Rln(ExternalSignerMismatch): identity mismatch')
    })
    jest.spyOn(rln.NativeExternalSigner, 'createWithStorage').mockReturnValue(fallbackSigner)
    binding._node = node
    binding._signer = primarySigner
    binding._seedHex = Buffer.from('seed-v2')
    binding._fallbackSeedHex = Buffer.from('seed-v1')

    let thrown
    try {
      binding.unlock(UNLOCK)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(AggregateError)
    expect(thrown.message).toBe('unlock: failed to destroy both the primary and fallback signers')
    expect(thrown.errors).toEqual([primaryError, fallbackError])
    expect(binding._signer).toBe(primarySigner)
    expect(binding._pendingSignerCleanup).toEqual([fallbackSigner])
    expect(() => binding.ensureNode()).toThrow()
    primarySigner.destroy.mockImplementation(() => {})
    expect(() => binding.shutdown()).toThrow(fallbackError)
    expect(binding._signer).toBeNull()
    expect(binding._pendingSignerCleanup).toEqual([fallbackSigner])
    expect(binding._seedHex).toBeDefined()
    fallbackSigner[failureMethod].mockImplementation(() => {})
    binding.shutdown()
    binding.shutdown()
    expect(binding._pendingSignerCleanup).toEqual([])
    expect(binding._seedHex).toBeUndefined()
    expect(binding._fallbackSeedHex).toBeUndefined()
    expect(primarySigner.destroy).toHaveBeenCalledTimes(2)
    expect(fallbackSigner.destroy).toHaveBeenCalledTimes(failureMethod === 'shutdown' ? 1 : 3)
  })

  it('forwards supported methods while requiring explicit VSS configuration', () => {
    const binding = makeBinding()
    const node = fakeNode()
    binding._node = node
    binding._signer = fakeSigner()
    expect(binding.bootstrap()).toEqual({ node_id: '03beef' })
    expect(binding.apayNew('02host')).toEqual({ order_id: 'order-1' })
    expect(node.apayNew).toHaveBeenCalledWith('02host')
    expect(() => binding.clearVssFence('private-password')).toThrow(expect.objectContaining({ code: 'VSS_NOT_CONFIGURED' }))
    expect(() => binding.vssBackup()).toThrow(expect.objectContaining({ code: 'VSS_NOT_CONFIGURED' }))
    expect(node.vssClearFence).not.toHaveBeenCalled()
    expect(node.vssBackup).not.toHaveBeenCalled()
    expect(binding.vssStatus()).toMatchObject({ configured: false, supported: true, enabled: false, lastBackupVersion: null })
  })

  it('retains live handles and permits shutdown retry after node failure', () => {
    const binding = makeBinding()
    const node = fakeNode()
    const signer = fakeSigner()
    const primarySeed = Buffer.from('seed-v2')
    const fallbackSeed = Buffer.from('seed-v1')
    node.shutdown.mockImplementation(() => { throw new Error('node shutdown failed') })
    binding._node = node
    binding._signer = signer
    binding._seedHex = primarySeed
    binding._fallbackSeedHex = fallbackSeed

    expect(() => binding.shutdown()).toThrow('node shutdown failed')
    expect(signer.shutdown).not.toHaveBeenCalled()
    expect(signer.destroy).not.toHaveBeenCalled()
    expect(binding._node).toBe(node)
    expect(binding._signer).toBe(signer)
    expect(primarySeed.toString()).toBe('seed-v2')
    node.shutdown.mockImplementation(() => {})
    binding.shutdown()
    expect(signer.destroy).toHaveBeenCalledTimes(1)
    expect(node.shutdown.mock.invocationCallOrder.at(-1)).toBeLessThan(signer.shutdown.mock.invocationCallOrder[0])
    expect(signer.shutdown.mock.invocationCallOrder[0]).toBeLessThan(signer.destroy.mock.invocationCallOrder[0])
    expect(binding._node).toBeNull()
    expect(binding._signer).toBeNull()
    expect(primarySeed.every((byte) => byte === 0)).toBe(true)
    expect(fallbackSeed.every((byte) => byte === 0)).toBe(true)
  })

  it('retains the signer for retry when destruction fails', () => {
    const binding = makeBinding()
    const signer = fakeSigner()
    const primarySeed = Buffer.from('seed-v2')
    signer.destroy.mockImplementation(() => { throw new Error('signer destroy failed') })
    binding._signer = signer
    binding._seedHex = primarySeed

    expect(() => binding.shutdown()).toThrow('signer destroy failed')
    expect(binding._signer).toBe(signer)
    signer.destroy.mockImplementation(() => {})
    binding.shutdown()
    expect(binding._signer).toBeNull()
    expect(binding._seedHex).toBeUndefined()
  })

  it('surfaces revocation failure without dropping its handle or reporting successful lock', () => {
    const binding = makeBinding()
    const node = fakeNode()
    const signer = fakeSigner()
    const seed = Buffer.from('seed-v2')
    signer.shutdown.mockImplementationOnce(() => { throw new Error('signer revocation failed') })
    binding._node = node
    binding._signer = signer
    binding._seedHex = seed

    expect(() => binding.shutdown()).toThrow('signer revocation failed')
    expect(node.shutdown).toHaveBeenCalledTimes(1)
    expect(signer.destroy).not.toHaveBeenCalled()
    expect(binding._signer).toBe(signer)
    expect(seed.toString()).toBe('seed-v2')
    expect(() => binding.ensureNode()).toThrow()
    binding.shutdown()
    binding.shutdown()
    expect(node.shutdown).toHaveBeenCalledTimes(1)
    expect(signer.shutdown).toHaveBeenCalledTimes(2)
    expect(signer.destroy).toHaveBeenCalledTimes(1)
    expect(seed.every(byte => byte === 0)).toBe(true)
  })

  it('is safe to shut down before any native handles are created', () => {
    const binding = makeBinding()

    expect(() => binding.shutdown()).not.toThrow()
    expect(binding._node).toBeNull()
    expect(binding._signer).toBeNull()
  })

  it('exposes the native module lifecycle passthroughs', () => {
    expect(BareRgbLightningBinding.healthcheck()).toBe('rgb_lightning_node_uniffi_ready')
    expect(BareRgbLightningBinding.isInitialized()).toBe(false)
    expect(() => BareRgbLightningBinding.initialize({})).not.toThrow()
    expect(() => BareRgbLightningBinding.shutdownGlobal()).not.toThrow()
  })
})
