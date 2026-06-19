// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.

// Unit tests for the NodeRgbLightningBinding instance + static methods.
// The native addon `@utexo/rgb-lightning-node-nodejs` is replaced by the
// jest mock wired in package.json (`moduleNameMapper`); we drive node /
// signer behaviour by assigning fake objects onto the binding internals
// after construction so no `.node` binary is loaded. The pure
// constructor request-mapping + vssStatus are covered separately in
// node-binding-config.test.js and are not re-tested here.

import { jest } from '@jest/globals'
import { NodeRgbLightningBinding } from '../src/node-binding.js'

function makeBinding (overrides = {}) {
  return new NodeRgbLightningBinding({ network: 'regtest', dataDir: '/d', ...overrides })
}

function fakeNode () {
  return {
    initWithNativeExternalSigner: jest.fn(),
    unlockWithNativeExternalSigner: jest.fn(),
    vssClearFence: jest.fn(),
    vssBackup: jest.fn(() => ({ version: 7 })),
    apayNew: jest.fn(() => ({ order: 'x' })),
    shutdown: jest.fn()
  }
}

function fakeSigner () {
  return {
    bootstrap: jest.fn(() => ({ booted: true })),
    destroy: jest.fn()
  }
}

describe('ensureNode', () => {
  it('creates the node via SdkNode.create on first call and caches it', () => {
    const b = makeBinding()
    expect(b._node).toBeNull()
    const node = b.ensureNode()
    expect(node).toBeTruthy()
    expect(b._node).toBe(node)
  })

  it('returns the same cached node on a second call', () => {
    const b = makeBinding()
    const first = b.ensureNode()
    const second = b.ensureNode()
    expect(second).toBe(first)
  })
})

describe('node getter', () => {
  it("throws 'SdkNode not created' when no node exists", () => {
    const b = makeBinding()
    expect(() => b.node).toThrow('SdkNode not created')
  })

  it('returns the node when one is present', () => {
    const b = makeBinding()
    const node = fakeNode()
    b._node = node
    expect(b.node).toBe(node)
  })
})

describe('attachExternalSigner', () => {
  it('creates a signer via NativeExternalSigner.create when none attached', () => {
    const b = makeBinding()
    expect(b._signer).toBeNull()
    b.attachExternalSigner('seed-a')
    expect(b._signer).toBeTruthy()
    expect(b._seedHex).toBe('seed-a')
  })

  it('is an idempotent no-op when the same seed is already attached', () => {
    const b = makeBinding()
    b.attachExternalSigner('seed-a')
    const signer = b._signer
    b.attachExternalSigner('seed-a')
    expect(b._signer).toBe(signer)
  })

  it('throws when a different seed is already attached', () => {
    const b = makeBinding()
    b.attachExternalSigner('seed-a')
    expect(() => b.attachExternalSigner('seed-b')).toThrow('a different signer is already attached')
  })
})

describe('unlock', () => {
  it('throws when no signer has been attached', () => {
    const b = makeBinding()
    b._node = fakeNode()
    expect(() => b.unlock({})).toThrow('attachExternalSigner')
  })

  it('runs init then unlock on the first call and sets _sdkInitDone', () => {
    const b = makeBinding()
    const node = fakeNode()
    const signer = fakeSigner()
    b._node = node
    b._signer = signer
    const req = { mnemonic: 'm' }
    b.unlock(req)
    expect(node.initWithNativeExternalSigner).toHaveBeenCalledWith(signer)
    expect(node.unlockWithNativeExternalSigner).toHaveBeenCalledWith(signer, req)
    expect(b._sdkInitDone).toBe(true)
  })

  it('swallows a Conflict init error and still proceeds to unlock', () => {
    const b = makeBinding()
    const node = fakeNode()
    node.initWithNativeExternalSigner.mockImplementation(() => { throw new Error('Conflict: already initialized') })
    b._node = node
    b._signer = fakeSigner()
    expect(() => b.unlock({})).not.toThrow()
    expect(node.unlockWithNativeExternalSigner).toHaveBeenCalled()
    expect(b._sdkInitDone).toBe(true)
  })

  it('rethrows a non-Conflict init error and does not unlock', () => {
    const b = makeBinding()
    const node = fakeNode()
    node.initWithNativeExternalSigner.mockImplementation(() => { throw new Error('boom') })
    b._node = node
    b._signer = fakeSigner()
    expect(() => b.unlock({})).toThrow('boom')
    expect(node.unlockWithNativeExternalSigner).not.toHaveBeenCalled()
    expect(b._sdkInitDone).toBe(false)
  })

  it('skips init on a second unlock once _sdkInitDone is set', () => {
    const b = makeBinding()
    const node = fakeNode()
    b._node = node
    b._signer = fakeSigner()
    b.unlock({})
    b.unlock({})
    expect(node.initWithNativeExternalSigner).toHaveBeenCalledTimes(1)
    expect(node.unlockWithNativeExternalSigner).toHaveBeenCalledTimes(2)
  })
})

describe('bootstrap', () => {
  it('throws when no signer is attached', () => {
    const b = makeBinding()
    expect(() => b.bootstrap()).toThrow('attachExternalSigner')
  })

  it('delegates to signer.bootstrap and returns its result', () => {
    const b = makeBinding()
    const signer = fakeSigner()
    b._signer = signer
    expect(b.bootstrap()).toEqual({ booted: true })
    expect(signer.bootstrap).toHaveBeenCalledTimes(1)
  })
})

describe('clearVssFence', () => {
  it('ensures the node then calls vssClearFence with the password', () => {
    const b = makeBinding()
    const node = fakeNode()
    b._node = node
    b.clearVssFence('pw')
    expect(node.vssClearFence).toHaveBeenCalledWith({ password: 'pw' })
  })

  it('lazily creates the node when none exists before clearing the fence', () => {
    const b = makeBinding()
    const node = fakeNode()
    const ensureSpy = jest.spyOn(b, 'ensureNode').mockReturnValue(node)
    b.clearVssFence('pw')
    expect(ensureSpy).toHaveBeenCalledTimes(1)
    expect(node.vssClearFence).toHaveBeenCalledWith({ password: 'pw' })
  })
})

describe('vssBackup', () => {
  it('returns the node result and records a numeric version', () => {
    const b = makeBinding()
    const node = fakeNode()
    b._node = node
    const r = b.vssBackup()
    expect(r).toEqual({ version: 7 })
    expect(b._lastVssVersion).toBe(7)
  })

  it('does not record _lastVssVersion when version is not numeric', () => {
    const b = makeBinding()
    const node = fakeNode()
    node.vssBackup.mockReturnValue({ version: 'nope' })
    b._node = node
    b.vssBackup()
    expect(b._lastVssVersion).toBeNull()
  })

  it('throws via the node getter when no node has been created', () => {
    const b = makeBinding()
    expect(() => b.vssBackup()).toThrow('SdkNode not created')
  })
})

describe('apayNew', () => {
  it('ensures the node then forwards the host node id', () => {
    const b = makeBinding()
    const node = fakeNode()
    b._node = node
    expect(b.apayNew('02hostid')).toEqual({ order: 'x' })
    expect(node.apayNew).toHaveBeenCalledWith('02hostid')
  })

  it('lazily creates the node through ensureNode when none exists', () => {
    const b = makeBinding({ virtualPeerPubkeys: ['02lsp'] })
    const node = fakeNode()
    const ensureSpy = jest.spyOn(b, 'ensureNode').mockReturnValue(node)
    b.apayNew('02hostid')
    expect(ensureSpy).toHaveBeenCalledTimes(1)
    expect(node.apayNew).toHaveBeenCalledWith('02hostid')
  })
})

describe('shutdown', () => {
  it('shuts down node + signer, nulls them and resets _sdkInitDone', () => {
    const b = makeBinding()
    const node = fakeNode()
    const signer = fakeSigner()
    b._node = node
    b._signer = signer
    b._sdkInitDone = true
    b.shutdown()
    expect(node.shutdown).toHaveBeenCalledTimes(1)
    expect(signer.destroy).toHaveBeenCalledTimes(1)
    expect(b._node).toBeNull()
    expect(b._signer).toBeNull()
    expect(b._sdkInitDone).toBe(false)
  })

  it('is idempotent when nothing is attached', () => {
    const b = makeBinding()
    expect(() => b.shutdown()).not.toThrow()
    expect(b._node).toBeNull()
    expect(b._signer).toBeNull()
  })
})

describe('static module passthroughs', () => {
  it('healthcheck calls the addon uniffiHealthcheck', () => {
    expect(NodeRgbLightningBinding.healthcheck()).toBe(true)
  })

  it('isInitialized calls the addon uniffiIsInitialized', () => {
    expect(NodeRgbLightningBinding.isInitialized()).toBe(false)
  })

  it('initialize calls the addon sdkInitialize', () => {
    expect(() => NodeRgbLightningBinding.initialize({})).not.toThrow()
  })

  it('shutdownGlobal calls the addon sdkShutdown', () => {
    expect(() => NodeRgbLightningBinding.shutdownGlobal()).not.toThrow()
  })
})
