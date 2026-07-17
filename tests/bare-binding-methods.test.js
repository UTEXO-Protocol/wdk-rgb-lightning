// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.

import { jest } from '@jest/globals'
import rln from '@utexo/rgb-lightning-node-bare'
import { BareRgbLightningBinding } from '../src/bare-binding.js'

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
      vssUrl: 'https://vss.example',
      vssAllowEmptyRestore: true,
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
      vss_url: 'https://vss.example',
      vss_allow_empty_restore: true,
      lsp_base_url: 'https://lsp.example',
      lsp_bearer_token: 'token'
    }))
    expect(makeBinding({ virtualPeerPubkeys: [] })._initRequest).not.toHaveProperty('virtual_peer_pubkeys')
  })

  it('retains primary and fallback seeds without constructing the fallback eagerly', () => {
    const signer = fakeSigner()
    const createSpy = jest.spyOn(rln.NativeExternalSigner, 'create').mockReturnValue(signer)
    const binding = makeBinding({ permissiveSignerPolicy: false })

    binding.attachExternalSigner('seed-v2', 'seed-v1')

    expect(createSpy).toHaveBeenCalledTimes(1)
    expect(createSpy).toHaveBeenCalledWith('seed-v2', 'regtest', false)
    expect(binding._signer).toBe(signer)
    expect(binding._seedHex.toString()).toBe('seed-v2')
    expect(binding._fallbackSeedHex.toString()).toBe('seed-v1')
  })

  it('keeps same-seed attachment idempotent and rejects a wallet swap', () => {
    const signer = fakeSigner()
    const createSpy = jest.spyOn(rln.NativeExternalSigner, 'create').mockReturnValue(signer)
    const binding = makeBinding()

    binding.attachExternalSigner('seed-v2', 'seed-old')
    const oldFallback = binding._fallbackSeedHex
    binding.attachExternalSigner('seed-v2', 'seed-v1')

    expect(createSpy).toHaveBeenCalledTimes(1)
    expect(createSpy).toHaveBeenCalledWith('seed-v2', 'regtest', true)
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

    expect(() => binding.unlock({})).toThrow('attachExternalSigner')
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

    binding.unlock({ rpc: true })
    binding.unlock({ rpc: true })

    expect(node.initWithNativeExternalSigner).toHaveBeenCalledTimes(1)
    expect(node.unlockWithNativeExternalSigner).toHaveBeenCalledTimes(2)
    expect(binding._fallbackSeedHex).toBeUndefined()
    expect(fallbackSeed.every((byte) => byte === 0)).toBe(true)
  })

  it('accepts an existing SDK init but rethrows unrelated init failures', () => {
    const existing = makeBinding()
    const existingNode = fakeNode()
    existingNode.initWithNativeExternalSigner.mockImplementation(() => {
      throw new Error('Conflict: already initialized')
    })
    existing._node = existingNode
    existing._signer = fakeSigner()

    expect(() => existing.unlock({})).not.toThrow()
    expect(existingNode.unlockWithNativeExternalSigner).toHaveBeenCalledTimes(1)

    const failing = makeBinding()
    const failingNode = fakeNode()
    // eslint-disable-next-line no-throw-literal
    failingNode.initWithNativeExternalSigner.mockImplementation(() => { throw 'init failed' })
    failing._node = failingNode
    failing._signer = fakeSigner()

    expect(() => failing.unlock({})).toThrow('init failed')
    expect(failingNode.unlockWithNativeExternalSigner).not.toHaveBeenCalled()
    expect(failing._sdkInitDone).toBe(false)
  })

  it('replaces a mismatched primary signer with the legacy signer', () => {
    const binding = makeBinding()
    const node = fakeNode()
    const primarySigner = fakeSigner()
    const fallbackSigner = fakeSigner()
    const primarySeed = Buffer.from('seed-v2')
    const fallbackSeed = Buffer.from('seed-v1')
    node.unlockWithNativeExternalSigner
      .mockImplementationOnce(() => {
        throw new Error('external signer identity does not match persisted key_source.json')
      })
      .mockImplementationOnce(() => undefined)
    jest.spyOn(rln.NativeExternalSigner, 'create').mockReturnValue(fallbackSigner)
    binding._node = node
    binding._signer = primarySigner
    binding._seedHex = primarySeed
    binding._fallbackSeedHex = fallbackSeed

    binding.unlock({ rpc: true })

    expect(primarySigner.destroy).toHaveBeenCalledTimes(1)
    expect(binding._signer).toBe(fallbackSigner)
    expect(binding._seedHex).toBe(fallbackSeed)
    expect(binding._fallbackSeedHex).toBeUndefined()
    expect(primarySeed.every((byte) => byte === 0)).toBe(true)
    expect(node.unlockWithNativeExternalSigner).toHaveBeenLastCalledWith(fallbackSigner, { rpc: true })
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
    jest.spyOn(rln.NativeExternalSigner, 'create').mockReturnValue(fallbackSigner)
    binding._node = node
    binding._signer = primarySigner
    binding._seedHex = primarySeed
    binding._fallbackSeedHex = fallbackSeed

    expect(() => binding.unlock({})).toThrow(destroyError)
    expect(fallbackSigner.destroy).toHaveBeenCalledTimes(1)
    expect(binding._signer).toBe(primarySigner)
    expect(binding._seedHex).toBe(primarySeed)
    expect(binding._fallbackSeedHex).toBe(fallbackSeed)
    expect(node.unlockWithNativeExternalSigner).toHaveBeenCalledTimes(1)
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

    expect(() => binding.unlock({})).toThrow('backend unavailable')
    expect(binding._signer).toBe(signer)
    expect(node.unlockWithNativeExternalSigner).toHaveBeenCalledTimes(1)
  })

  it('reports both signer cleanup failures without replacing binding state', () => {
    const binding = makeBinding()
    const node = fakeNode()
    const primarySigner = fakeSigner()
    const fallbackSigner = fakeSigner()
    const primaryError = new Error('primary signer destroy failed')
    const fallbackError = new Error('fallback signer destroy failed')
    primarySigner.destroy.mockImplementation(() => { throw primaryError })
    fallbackSigner.destroy.mockImplementation(() => { throw fallbackError })
    node.unlockWithNativeExternalSigner.mockImplementation(() => {
      throw new Error('Rln(ExternalSignerMismatch): identity mismatch')
    })
    jest.spyOn(rln.NativeExternalSigner, 'create').mockReturnValue(fallbackSigner)
    binding._node = node
    binding._signer = primarySigner
    binding._seedHex = Buffer.from('seed-v2')
    binding._fallbackSeedHex = Buffer.from('seed-v1')

    let thrown
    try {
      binding.unlock({})
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(AggregateError)
    expect(thrown.message).toBe('unlock: failed to destroy both the primary and fallback signers')
    expect(thrown.errors).toEqual([primaryError, fallbackError])
    expect(binding._signer).toBe(primarySigner)
  })

  it('forwards the remaining native instance methods', () => {
    const binding = makeBinding({ vssUrl: 'https://vss.example', vssAllowHttp: true })
    const node = fakeNode()
    const signer = fakeSigner()
    binding._node = node
    binding._signer = signer

    expect(binding.bootstrap()).toEqual({ node_id: '03beef' })
    binding.clearVssFence('pw')
    expect(binding.vssBackup()).toEqual({ version: 7 })
    expect(binding.vssStatus()).toEqual({
      configured: true,
      url: 'https://vss.example',
      allowHttp: true,
      lastBackupVersion: 7
    })
    expect(binding.apayNew('02host')).toEqual({ order_id: 'order-1' })
    expect(node.vssClearFence).toHaveBeenCalledWith({ password: 'pw' })
    expect(node.apayNew).toHaveBeenCalledWith('02host')

    node.vssBackup.mockReturnValueOnce({ version: 'unknown' }).mockReturnValueOnce(null)
    expect(binding.vssBackup()).toEqual({ version: 'unknown' })
    expect(binding.vssBackup()).toBeNull()
    expect(binding.vssStatus().lastBackupVersion).toBe(7)
    expect(makeBinding().vssStatus()).toEqual({
      configured: false,
      url: null,
      allowHttp: false,
      lastBackupVersion: null
    })
  })

  it('cleans up the signer and retained seeds when node shutdown fails', () => {
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
    expect(signer.destroy).toHaveBeenCalledTimes(1)
    expect(binding._node).toBeNull()
    expect(binding._signer).toBeNull()
    expect(primarySeed.every((byte) => byte === 0)).toBe(true)
    expect(fallbackSeed.every((byte) => byte === 0)).toBe(true)
  })

  it('wipes retained seeds when signer destruction fails', () => {
    const binding = makeBinding()
    const signer = fakeSigner()
    const primarySeed = Buffer.from('seed-v2')
    signer.destroy.mockImplementation(() => { throw new Error('signer destroy failed') })
    binding._signer = signer
    binding._seedHex = primarySeed

    expect(() => binding.shutdown()).toThrow('signer destroy failed')
    expect(binding._signer).toBeNull()
    expect(primarySeed.every((byte) => byte === 0)).toBe(true)
  })

  it('is safe to shut down before any native handles are created', () => {
    const binding = makeBinding()

    expect(() => binding.shutdown()).not.toThrow()
    expect(binding._node).toBeNull()
    expect(binding._signer).toBeNull()
  })

  it('exposes the native module lifecycle passthroughs', () => {
    expect(BareRgbLightningBinding.healthcheck()).toBe(true)
    expect(BareRgbLightningBinding.isInitialized()).toBe(false)
    expect(() => BareRgbLightningBinding.initialize({})).not.toThrow()
    expect(() => BareRgbLightningBinding.shutdownGlobal()).not.toThrow()
  })
})
