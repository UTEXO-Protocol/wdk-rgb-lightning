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
import rln from '@utexo/rgb-lightning-node-nodejs'
import { NodeRgbLightningBinding } from '../src/node-binding.js'

function makeBinding (overrides = {}) {
  return new NodeRgbLightningBinding({ network: 'regtest', dataDir: '/d', ...overrides })
}

// Real RLN AsyncOrderNewResponse shape (snake_case) — see
// utexo-rgb-wdk-demo node-demo LnExt.ts getApayNew + testCases t113.
// `apayNew` must passthrough this exact object reference unchanged.
function realAsyncOrderNewResponse () {
  return {
    request_id: 'req-7f3a',
    host_node_id: '02hostid',
    accepted_through_index: 4,
    order_id: 'order-9c21',
    status: 'pending',
    next_index_expected: 5,
    unused_hashes: ['aa11', 'bb22'],
    refill_batch_size: 16,
    first_hash_index: 0
  }
}

// Real signer bootstrap payload — see LnExt.ts getBootstrap /
// binding-interface.js ('node_id, xpubs, master_fp'). NOT `{ booted }`.
function realBootstrapPayload () {
  return {
    node_id: '03beef',
    account_xpub_vanilla: 'tpubVanilla',
    account_xpub_colored: 'tpubColored',
    master_fingerprint: 'a1b2c3d4'
  }
}

function fakeNode () {
  return {
    initWithNativeExternalSigner: jest.fn(),
    unlockWithNativeExternalSigner: jest.fn(),
    vssClearFence: jest.fn(),
    vssBackup: jest.fn(() => ({ version: 7 })),
    apayNew: jest.fn(() => realAsyncOrderNewResponse()),
    shutdown: jest.fn()
  }
}

function fakeSigner () {
  return {
    bootstrap: jest.fn(() => realBootstrapPayload()),
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

describe('binding surface', () => {
  it('uses ensureNode() as the only node accessor', () => {
    const b = makeBinding()
    expect('node' in b).toBe(false)
    expect(typeof b.ensureNode).toBe('function')
  })
})

describe('attachExternalSigner', () => {
  it('creates a signer via NativeExternalSigner.create when none attached', () => {
    const b = makeBinding()
    expect(b._signer).toBeNull()
    b.attachExternalSigner('seed-a')
    expect(b._signer).toBeTruthy()
    expect(b._seedHex.toString()).toBe('seed-a')
  })

  it('records an optional legacy fallback seed without constructing it eagerly', () => {
    const spy = jest.spyOn(rln.NativeExternalSigner, 'create')
      .mockReturnValue({ bootstrap: jest.fn(), destroy: jest.fn() })
    try {
      const b = makeBinding()
      b.attachExternalSigner('seed-v2', 'seed-v1')
      expect(b._fallbackSeedHex.toString()).toBe('seed-v1')
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy).toHaveBeenCalledWith('seed-v2', 'regtest', true)
    } finally {
      spy.mockRestore()
    }
  })

  // Kills the mutant that hardcodes NativeExternalSigner.create(seedHex,
  // 'mainnet', false): asserts the seed, the CONFIGURED network ('regtest')
  // and the permissive-policy `?? true` DEFAULT are passed through verbatim.
  it('passes the seed, configured network and permissive-policy default to NativeExternalSigner.create', () => {
    const created = { bootstrap: jest.fn(), destroy: jest.fn() }
    const spy = jest.spyOn(rln.NativeExternalSigner, 'create').mockReturnValue(created)
    try {
      const b = makeBinding()
      b.attachExternalSigner('seed-a')
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy).toHaveBeenCalledWith('seed-a', 'regtest', true)
      expect(b._signer).toBe(created)
    } finally {
      spy.mockRestore()
    }
  })

  // Differentiates the `permissiveSignerPolicy ?? true` default from an
  // explicit override: an explicit `false` must reach create as the 3rd arg.
  it('forwards an explicit permissiveSignerPolicy=false instead of the default', () => {
    const spy = jest.spyOn(rln.NativeExternalSigner, 'create')
      .mockReturnValue({ bootstrap: jest.fn(), destroy: jest.fn() })
    try {
      const b = makeBinding({ permissiveSignerPolicy: false })
      b.attachExternalSigner('seed-a')
      expect(spy).toHaveBeenCalledWith('seed-a', 'regtest', false)
    } finally {
      spy.mockRestore()
    }
  })

  it('is an idempotent no-op when the same seed is already attached', () => {
    const b = makeBinding()
    b.attachExternalSigner('seed-a')
    const signer = b._signer
    b.attachExternalSigner('seed-a')
    expect(b._signer).toBe(signer)
  })

  it('records a newly supplied fallback seed on the idempotent same-seed path', () => {
    const b = makeBinding()
    b.attachExternalSigner('seed-v2', 'seed-old')
    const signer = b._signer
    const oldFallback = b._fallbackSeedHex
    b.attachExternalSigner('seed-v2', 'seed-v1')
    expect(b._signer).toBe(signer)
    expect(b._fallbackSeedHex.toString()).toBe('seed-v1')
    expect(oldFallback.every((byte) => byte === 0)).toBe(true)
  })

  it('throws when a different seed is already attached', () => {
    const b = makeBinding()
    b.attachExternalSigner('seed-a')
    expect(() => b.attachExternalSigner('seed-b')).toThrow('a different signer is already attached')
  })

  // Preserve the `this._seedHex &&` short-circuit around the retained-secret
  // comparison. When a signer is attached
  // out-of-band with NO _seedHex recorded, re-attaching must return
  // silently (the falsy guard wins). Dropping the short-circuit would
  // make `undefined !== 'seed-x'` true and wrongly throw.
  it('returns silently when a signer is attached but _seedHex is falsy', () => {
    const b = makeBinding()
    const preexisting = fakeSigner()
    b._signer = preexisting
    expect(b._seedHex).toBeUndefined()
    expect(() => b.attachExternalSigner('seed-x')).not.toThrow()
    // No new signer created and the seed is NOT recorded by the no-op path.
    expect(b._signer).toBe(preexisting)
    expect(b._seedHex).toBeUndefined()
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
    const fallbackSeed = Buffer.from('seed-v1')
    b._fallbackSeedHex = fallbackSeed
    const req = { mnemonic: 'm' }
    b.unlock(req)
    expect(node.initWithNativeExternalSigner).toHaveBeenCalledWith(signer)
    expect(node.unlockWithNativeExternalSigner).toHaveBeenCalledWith(signer, req)
    expect(b._sdkInitDone).toBe(true)
    expect(b._fallbackSeedHex).toBeUndefined()
    expect(fallbackSeed.every((byte) => byte === 0)).toBe(true)
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

  it('retries with the legacy signer only for a persisted identity mismatch', () => {
    const b = makeBinding()
    const node = fakeNode()
    const primarySigner = fakeSigner()
    const fallbackSigner = fakeSigner()
    node.unlockWithNativeExternalSigner
      .mockImplementationOnce(() => {
        throw new Error('Rln(ExternalSignerMismatch): External signer identity does not match persisted node identity')
      })
      .mockImplementationOnce(() => undefined)
    const createSpy = jest.spyOn(rln.NativeExternalSigner, 'create').mockReturnValue(fallbackSigner)
    b._node = node
    b._signer = primarySigner
    const primarySeed = Buffer.from('seed-v2')
    const fallbackSeed = Buffer.from('seed-v1')
    b._seedHex = primarySeed
    b._fallbackSeedHex = fallbackSeed
    try {
      expect(() => b.unlock({ rpc: true })).not.toThrow()
      expect(primarySigner.destroy).toHaveBeenCalledTimes(1)
      expect(createSpy).toHaveBeenCalledWith('seed-v1', 'regtest', true)
      expect(node.unlockWithNativeExternalSigner).toHaveBeenLastCalledWith(fallbackSigner, { rpc: true })
      expect(b._seedHex).toBe(fallbackSeed)
      expect(b._seedHex.toString()).toBe('seed-v1')
      expect(primarySeed.every((byte) => byte === 0)).toBe(true)
      expect(b._fallbackSeedHex).toBeUndefined()
    } finally {
      createSpy.mockRestore()
    }
  })

  it('destroys a newly created fallback signer when the primary signer cannot be released', () => {
    const b = makeBinding()
    const node = fakeNode()
    const primarySigner = fakeSigner()
    const fallbackSigner = fakeSigner()
    const destroyError = new Error('primary signer destroy failed')
    primarySigner.destroy.mockImplementation(() => { throw destroyError })
    node.unlockWithNativeExternalSigner.mockImplementation(() => {
      throw new Error('Rln(ExternalSignerMismatch): External signer identity does not match persisted node identity')
    })
    const createSpy = jest.spyOn(rln.NativeExternalSigner, 'create').mockReturnValue(fallbackSigner)
    const primarySeed = Buffer.from('seed-v2')
    const fallbackSeed = Buffer.from('seed-v1')
    b._node = node
    b._signer = primarySigner
    b._seedHex = primarySeed
    b._fallbackSeedHex = fallbackSeed
    try {
      expect(() => b.unlock({})).toThrow(destroyError)
      expect(fallbackSigner.destroy).toHaveBeenCalledTimes(1)
      expect(b._signer).toBe(primarySigner)
      expect(b._seedHex).toBe(primarySeed)
      expect(b._fallbackSeedHex).toBe(fallbackSeed)
      expect(node.unlockWithNativeExternalSigner).toHaveBeenCalledTimes(1)
    } finally {
      createSpy.mockRestore()
    }
  })

  it('reports both native cleanup failures during fallback replacement', () => {
    const b = makeBinding()
    const node = fakeNode()
    const primarySigner = fakeSigner()
    const fallbackSigner = fakeSigner()
    const primaryError = new Error('primary signer destroy failed')
    const fallbackError = new Error('fallback signer destroy failed')
    primarySigner.destroy.mockImplementation(() => { throw primaryError })
    fallbackSigner.destroy.mockImplementation(() => { throw fallbackError })
    node.unlockWithNativeExternalSigner.mockImplementation(() => {
      throw new Error('Rln(ExternalSignerMismatch): External signer identity does not match persisted node identity')
    })
    const createSpy = jest.spyOn(rln.NativeExternalSigner, 'create').mockReturnValue(fallbackSigner)
    b._node = node
    b._signer = primarySigner
    b._seedHex = Buffer.from('seed-v2')
    b._fallbackSeedHex = Buffer.from('seed-v1')
    try {
      let thrown
      try {
        b.unlock({})
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(AggregateError)
      expect(thrown.message).toBe('unlock: failed to destroy both the primary and fallback signers')
      expect(thrown.errors).toEqual([primaryError, fallbackError])
      expect(fallbackSigner.destroy).toHaveBeenCalledTimes(1)
      expect(b._signer).toBe(primarySigner)
    } finally {
      createSpy.mockRestore()
    }
  })

  it('does not retry a generic unlock failure with the legacy signer', () => {
    const b = makeBinding()
    const node = fakeNode()
    node.unlockWithNativeExternalSigner.mockImplementation(() => { throw new Error('backend unavailable') })
    b._node = node
    b._signer = fakeSigner()
    b._fallbackSeedHex = Buffer.from('seed-v1')
    expect(() => b.unlock({})).toThrow('backend unavailable')
    expect(node.unlockWithNativeExternalSigner).toHaveBeenCalledTimes(1)
  })

  it('does not retry an identity mismatch when no fallback seed is available', () => {
    const b = makeBinding()
    const node = fakeNode()
    node.unlockWithNativeExternalSigner.mockImplementation(() => {
      throw new Error('Rln(ExternalSignerMismatch): External signer identity does not match persisted node identity')
    })
    b._node = node
    b._signer = fakeSigner()
    expect(() => b.unlock({})).toThrow('ExternalSignerMismatch')
    expect(node.unlockWithNativeExternalSigner).toHaveBeenCalledTimes(1)
  })

  it('does not retry a thrown-string unlock failure with the legacy signer', () => {
    const b = makeBinding()
    const node = fakeNode()
    // eslint-disable-next-line no-throw-literal
    node.unlockWithNativeExternalSigner.mockImplementation(() => { throw 'backend unavailable' })
    b._node = node
    b._signer = fakeSigner()
    b._fallbackSeedHex = Buffer.from('seed-v1')
    expect(() => b.unlock({})).toThrow('backend unavailable')
    expect(node.unlockWithNativeExternalSigner).toHaveBeenCalledTimes(1)
  })

  // Exercises the false arm of `e && e.message ? e.message : e`: a thrown
  // string has no `.message`, so the message is `String(e)` itself. A
  // thrown 'Conflict' string must still be swallowed via includes('Conflict').
  it('swallows a thrown string containing Conflict (no .message) and proceeds', () => {
    const b = makeBinding()
    const node = fakeNode()
    // eslint-disable-next-line no-throw-literal
    node.initWithNativeExternalSigner.mockImplementation(() => { throw 'Conflict: already initialized' })
    b._node = node
    b._signer = fakeSigner()
    expect(() => b.unlock({})).not.toThrow()
    expect(node.unlockWithNativeExternalSigner).toHaveBeenCalledTimes(1)
    expect(b._sdkInitDone).toBe(true)
  })

  // Counterpart: a thrown string WITHOUT 'Conflict' (still no .message)
  // must be rethrown and must not reach unlock.
  it('rethrows a thrown string without Conflict (no .message) and does not unlock', () => {
    const b = makeBinding()
    const node = fakeNode()
    // eslint-disable-next-line no-throw-literal
    node.initWithNativeExternalSigner.mockImplementation(() => { throw 'plain boom' })
    b._node = node
    b._signer = fakeSigner()
    expect(() => b.unlock({})).toThrow('plain boom')
    expect(node.unlockWithNativeExternalSigner).not.toHaveBeenCalled()
    expect(b._sdkInitDone).toBe(false)
  })
})

describe('bootstrap', () => {
  it('throws when no signer is attached', () => {
    const b = makeBinding()
    expect(() => b.bootstrap()).toThrow('attachExternalSigner')
  })

  // Kills the mutant that discards the signer's payload and returns a
  // hardcoded object: asserts the EXACT real bootstrap payload reference
  // (node_id / xpubs / master_fingerprint) is returned unchanged.
  it('returns the signer bootstrap payload unchanged (same reference)', () => {
    const b = makeBinding()
    const signer = fakeSigner()
    const payload = realBootstrapPayload()
    signer.bootstrap.mockReturnValue(payload)
    b._signer = signer
    const result = b.bootstrap()
    expect(result).toBe(payload)
    expect(result).toEqual({
      node_id: '03beef',
      account_xpub_vanilla: 'tpubVanilla',
      account_xpub_colored: 'tpubColored',
      master_fingerprint: 'a1b2c3d4'
    })
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

  // Covers the falsy-`r` arm of `if (r && typeof r.version === 'number')`:
  // a null node result must short-circuit on `r &&` (no version read), leave
  // _lastVssVersion untouched, and be returned verbatim.
  it('returns null and leaves _lastVssVersion untouched when the node returns null', () => {
    const b = makeBinding()
    const node = fakeNode()
    node.vssBackup.mockReturnValue(null)
    b._node = node
    expect(b.vssBackup()).toBeNull()
    expect(b._lastVssVersion).toBeNull()
  })

  it('lazily obtains the node through ensureNode()', () => {
    const b = makeBinding()
    const node = fakeNode()
    const ensureSpy = jest.spyOn(b, 'ensureNode').mockReturnValue(node)
    expect(b.vssBackup()).toEqual({ version: 7 })
    expect(ensureSpy).toHaveBeenCalledTimes(1)
  })
})

describe('apayNew', () => {
  // Kills the mutant that ignores the node result and returns a hardcoded
  // object: asserts the EXACT real AsyncOrderNewResponse reference (with
  // request_id / order_id / status / unused_hashes ...) is passed through
  // unchanged, plus the host node id is forwarded.
  it('forwards the host node id and returns the node AsyncOrderNewResponse unchanged', () => {
    const b = makeBinding()
    const node = fakeNode()
    const resp = realAsyncOrderNewResponse()
    node.apayNew.mockReturnValue(resp)
    b._node = node
    const result = b.apayNew('02hostid')
    expect(result).toBe(resp)
    expect(result).toEqual({
      request_id: 'req-7f3a',
      host_node_id: '02hostid',
      accepted_through_index: 4,
      order_id: 'order-9c21',
      status: 'pending',
      next_index_expected: 5,
      unused_hashes: ['aa11', 'bb22'],
      refill_batch_size: 16,
      first_hash_index: 0
    })
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
    const primarySeed = Buffer.from('seed-v2')
    const fallbackSeed = Buffer.from('seed-v1')
    b._seedHex = primarySeed
    b._fallbackSeedHex = fallbackSeed
    b.shutdown()
    expect(node.shutdown).toHaveBeenCalledTimes(1)
    expect(signer.destroy).toHaveBeenCalledTimes(1)
    expect(b._node).toBeNull()
    expect(b._signer).toBeNull()
    expect(b._sdkInitDone).toBe(false)
    expect(b._seedHex).toBeUndefined()
    expect(b._fallbackSeedHex).toBeUndefined()
    expect(primarySeed.every((byte) => byte === 0)).toBe(true)
    expect(fallbackSeed.every((byte) => byte === 0)).toBe(true)
  })

  it('is idempotent when nothing is attached', () => {
    const b = makeBinding()
    expect(() => b.shutdown()).not.toThrow()
    expect(b._node).toBeNull()
    expect(b._signer).toBeNull()
  })

  it('destroys the signer and wipes both seeds even when node shutdown fails', () => {
    const b = makeBinding()
    const node = fakeNode()
    const signer = fakeSigner()
    node.shutdown.mockImplementation(() => { throw new Error('node shutdown failed') })
    const primarySeed = Buffer.from('seed-v2')
    const fallbackSeed = Buffer.from('seed-v1')
    b._node = node
    b._signer = signer
    b._seedHex = primarySeed
    b._fallbackSeedHex = fallbackSeed

    expect(() => b.shutdown()).toThrow('node shutdown failed')
    expect(signer.destroy).toHaveBeenCalledTimes(1)
    expect(b._node).toBeNull()
    expect(b._signer).toBeNull()
    expect(primarySeed.every((byte) => byte === 0)).toBe(true)
    expect(fallbackSeed.every((byte) => byte === 0)).toBe(true)
  })

  it('still wipes retained seeds when signer destruction fails', () => {
    const b = makeBinding()
    const signer = fakeSigner()
    signer.destroy.mockImplementation(() => { throw new Error('signer destroy failed') })
    const seed = Buffer.from('seed-v2')
    b._signer = signer
    b._seedHex = seed

    expect(() => b.shutdown()).toThrow('signer destroy failed')
    expect(b._signer).toBeNull()
    expect(seed.every((byte) => byte === 0)).toBe(true)
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
