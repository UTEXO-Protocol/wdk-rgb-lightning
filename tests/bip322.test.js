// Copyright 2026 UTEXO. Licensed under the Apache License, Version 2.0.
import { jest } from '@jest/globals'
import WalletAccountRgbLightning from '../src/wallet-account-rgb-lightning.js'
import { BareRgbLightningBinding } from '../src/bare-binding.js'
import { NodeRgbLightningBinding } from '../src/node-binding.js'
import bare from '@utexo/rgb-lightning-node-bare'
import node from '@utexo/rgb-lightning-node-nodejs'
import { BIP322_MAX_MESSAGE_BYTES, validateBip322Message, validateBip322Signature } from '../src/bip322-contract.js'

const ADDRESS = 'bcrt1ptvdn2twgt69xu2agz2zgr8evxqkhp62sf87l2pxw3f7w0cvslz7ssk7rke'
const SIGNATURE = 'smpAA=='

function fixture (overrides = {}) {
  const binding = {
    _config: { network: 'regtest' },
    ensureNode: jest.fn(() => ({})),
    shutdown: jest.fn(),
    bootstrap: jest.fn(),
    vssStatus: jest.fn(),
    getMessageSigningCapabilities: jest.fn(() => ({ signing: true, verification: true })),
    getMessageSigningAddress: jest.fn(() => ADDRESS),
    signMessageBip322: jest.fn(() => SIGNATURE),
    verifyMessageBip322: jest.fn(() => true),
    ...overrides
  }
  return { binding, account: new WalletAccountRgbLightning({ binding }) }
}

const deferred = () => {
  let resolveDeferred, rejectDeferred
  const promise = new Promise((resolve, reject) => { resolveDeferred = resolve; rejectDeferred = reject })
  return { promise, resolve: resolveDeferred, reject: rejectDeferred }
}

describe('BIP-322 exact message and wire contract', () => {
  test.each(['', ' hello \n', 'one\r\ntwo\n', '\u0000', 'é', 'e\u0301', '💰'])('preserves message %j byte for byte', async message => {
    const { account, binding } = fixture()
    await expect(account.signMessageBip322(message, ADDRESS)).resolves.toBe(SIGNATURE)
    expect(binding.signMessageBip322).toHaveBeenCalledWith(message, ADDRESS)
    expect(binding.verifyMessageBip322).toHaveBeenCalledWith(message, ADDRESS, SIGNATURE)
  })

  test.each([undefined, null, 7, {}, '\ud800', '\udc00', 'a\ud800b', 'a\udc00b', '💰\ud800'])('rejects ambiguous or invalid message %j before native access', async message => {
    const { account, binding } = fixture()
    await expect(account.signMessageBip322(message, ADDRESS)).rejects.toBeInstanceOf(TypeError)
    expect(binding.signMessageBip322).not.toHaveBeenCalled()
  })

  test('bounds UTF-8 bytes rather than JS code units', () => {
    expect(BIP322_MAX_MESSAGE_BYTES).toBe(4096)
    expect(validateBip322Message('a'.repeat(4096))).toHaveLength(4096)
    expect(validateBip322Message('💰'.repeat(1024))).toHaveLength(2048)
    expect(() => validateBip322Message('💰'.repeat(1025))).toThrow(RangeError)
    expect(() => validateBip322Message('a'.repeat(4097))).toThrow(RangeError)
  })

  test.each(['', null, undefined, ' ' + ADDRESS, ADDRESS + '\n', 'bitcoin:' + ADDRESS, ADDRESS.replace('bcrt1', 'bc1'), ADDRESS.replace('bcrt1', 'tb1')])('rejects an invalid or wrong-network address %j before native access', async address => {
    const { account, binding } = fixture()
    await expect(account.signMessageBip322('m', address)).rejects.toBeInstanceOf(TypeError)
    expect(binding.signMessageBip322).not.toHaveBeenCalled()
  })

  test.each(['AA==', 'fulAA==', 'pofAA==', '', null, { signature: SIGNATURE }, 'smpA===', 'smpAB==', 'smpAA==\n'])('rejects invalid native sign results %j', async signature => {
    const { account, binding } = fixture({ signMessageBip322: jest.fn(() => signature) })
    await expect(account.signMessageBip322('m', ADDRESS)).rejects.toBeInstanceOf(TypeError)
    expect(binding.verifyMessageBip322).not.toHaveBeenCalled()
  })

  test.each([false, null, 1, { valid: true }])('does not return a proof when independent verification is %j', async result => {
    const { account } = fixture({ verifyMessageBip322: jest.fn(() => result) })
    await expect(account.signMessageBip322('m', ADDRESS)).rejects.toThrow('does not verify')
  })

  test('accepts historical prefixless simple proofs only for verification', async () => {
    const { account, binding } = fixture()
    await expect(account.verifyMessageBip322('m', ADDRESS, 'AA==')).resolves.toBe(true)
    expect(binding.verifyMessageBip322).toHaveBeenCalledWith('m', ADDRESS, 'AA==')
    expect(() => validateBip322Signature('smpAA==')).not.toThrow()
    expect(() => validateBip322Signature('fulAA==')).toThrow('Only BIP-322 simple')
    expect(() => validateBip322Signature('pofAA==')).toThrow('Only BIP-322 simple')
    expect(() => validateBip322Signature('smp' + 'A'.repeat(4096))).toThrow()
  })

  test.each([undefined, null, 1, 'true', { valid: true }])('rejects non-boolean public verify results %j', async result => {
    const { account } = fixture({ verifyMessageBip322: jest.fn(() => result) })
    await expect(account.verifyMessageBip322('m', ADDRESS, SIGNATURE)).rejects.toThrow('invalid result')
  })
})

describe('BIP-322 ownership and lifecycle boundaries', () => {
  test('reads only the native fixed signing address, never ordinary address allocation', async () => {
    const { account, binding } = fixture()
    await expect(account.getMessageSigningAddress()).resolves.toBe(ADDRESS)
    expect(binding.ensureNode).not.toHaveBeenCalled()
    expect(binding.getMessageSigningAddress).toHaveBeenCalledTimes(1)
  })

  test('passes native ownership rejection through once without retry or legacy fallback', async () => {
    const ownershipError = new Error('BIP322 address is not owned by this signer')
    const { account, binding } = fixture({ signMessageBip322: jest.fn(() => { throw ownershipError }) })
    account.sign = jest.fn()
    await expect(account.signMessageBip322('m', ADDRESS)).rejects.toBe(ownershipError)
    expect(binding.signMessageBip322).toHaveBeenCalledTimes(1)
    expect(account.sign).not.toHaveBeenCalled()
  })

  test('read-only facade has public verify capability and no signing or signing-address method', async () => {
    const { account, binding } = fixture()
    const readOnly = await account.toReadOnlyAccount()
    expect(readOnly.signMessageBip322).toBeUndefined()
    expect(readOnly.getMessageSigningAddress).toBeUndefined()
    expect(readOnly.getCapabilities().bip322).toMatchObject({ signing: false, verification: true })
    await expect(readOnly.verifyMessageBip322('m', ADDRESS, SIGNATURE)).resolves.toBe(true)
    expect(binding.signMessageBip322).not.toHaveBeenCalled()
    expect(binding.getMessageSigningAddress).not.toHaveBeenCalled()
    expect(binding.ensureNode).not.toHaveBeenCalled()
  })

  test.each(['getMessageSigningAddress', 'signMessageBip322', 'verifyMessageBip322', 'getMessageSigningCapabilities'])('fails closed when %s is missing', async missing => {
    const { account, binding } = fixture({ [missing]: undefined })
    expect(account.getCapabilities().bip322.signing).toBe(false)
    await expect(account.signMessageBip322('m', ADDRESS)).rejects.toMatchObject({ code: 'ERR_BIP322_UNAVAILABLE' })
    expect(binding.ensureNode).not.toHaveBeenCalled()
  })

  test('serializes signing calls and drains accepted work before signer teardown', async () => {
    const first = deferred()
    const second = deferred()
    const sign = jest.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { account, binding } = fixture({ signMessageBip322: sign })
    const one = account.signMessageBip322('one', ADDRESS)
    const two = account.signMessageBip322('two', ADDRESS)
    await Promise.resolve()
    expect(sign).toHaveBeenCalledTimes(1)
    const closing = account.shutdown()
    await expect(account.signMessageBip322('three', ADDRESS)).rejects.toThrow('closed')
    await expect(account.getMessageSigningAddress()).rejects.toThrow('closed')
    expect(binding.shutdown).not.toHaveBeenCalled()
    first.resolve(SIGNATURE)
    await one
    await Promise.resolve()
    expect(sign).toHaveBeenCalledTimes(2)
    expect(binding.shutdown).not.toHaveBeenCalled()
    second.resolve(SIGNATURE)
    await two
    await closing
    expect(binding.shutdown).toHaveBeenCalledTimes(1)
  })

  test('a failed proof does not poison later signing or shutdown', async () => {
    const { account, binding } = fixture({ signMessageBip322: jest.fn().mockRejectedValueOnce(new Error('failed')).mockReturnValueOnce(SIGNATURE) })
    await expect(account.signMessageBip322('first', ADDRESS)).rejects.toThrow('failed')
    await expect(account.signMessageBip322('second', ADDRESS)).resolves.toBe(SIGNATURE)
    await account.shutdown()
    expect(binding.shutdown).toHaveBeenCalledTimes(1)
  })
})

for (const [runtime, Binding, native] of [['Bare', BareRgbLightningBinding, bare], ['Node', NodeRgbLightningBinding, node]]) {
  describe(`${runtime} BIP-322 binding`, () => {
    let infoSpy, oldPrototype, oldVerifier
    beforeEach(() => {
      oldPrototype = native.SdkNode.prototype
      oldVerifier = native.verifyMessageBip322
      native.verifyMessageBip322 = jest.fn(() => false)
      native.SdkNode.prototype = {
        getMessageSigningAddress () {}, signMessageBip322 () {}, verifyMessageBip322 () {}
      }
      const info = native.getRuntimeInfo()
      infoSpy = jest.spyOn(native, 'getRuntimeInfo').mockReturnValue({ ...info, capabilities: [...info.capabilities, 'bip322-simple-v1'] })
    })
    afterEach(() => {
      infoSpy.mockRestore()
      if (oldVerifier === undefined) delete native.verifyMessageBip322
      else native.verifyMessageBip322 = oldVerifier
      if (oldPrototype === undefined) delete native.SdkNode.prototype
      else native.SdkNode.prototype = oldPrototype
    })

    test('detects all real methods and compiled capability without constructing a node', () => {
      const binding = new Binding({ network: 'regtest', dataDir: '/test' })
      expect(binding.getMessageSigningCapabilities()).toEqual({ signing: true, verification: true })
      expect(binding._node).toBeNull()
      delete native.SdkNode.prototype.signMessageBip322
      expect(binding.getMessageSigningCapabilities()).toEqual({ signing: false, verification: false })
      native.SdkNode.prototype.signMessageBip322 = () => {}
      const info = native.getRuntimeInfo()
      infoSpy.mockReturnValue({ ...info, capabilities: info.capabilities.filter(value => value !== 'bip322-simple-v1') })
      expect(binding.getMessageSigningCapabilities()).toEqual({ signing: false, verification: false })
    })

    test('forwards exact inputs, enforces strict native primitive results and propagates errors', () => {
      const binding = new Binding({ network: 'regtest', dataDir: '/test' })
      const backend = {
        getMessageSigningAddress: jest.fn(() => ADDRESS),
        signMessageBip322: jest.fn(() => SIGNATURE),
        verifyMessageBip322: jest.fn(() => false)
      }
      binding._node = backend
      expect(binding.getMessageSigningAddress()).toBe(ADDRESS)
      expect(binding.signMessageBip322('m\n', ADDRESS)).toBe(SIGNATURE)
      expect(backend.signMessageBip322).toHaveBeenCalledWith('m\n', ADDRESS)
      expect(binding.verifyMessageBip322('m\n', ADDRESS, SIGNATURE)).toBe(false)
      expect(native.verifyMessageBip322).toHaveBeenCalledWith('m\n', ADDRESS, SIGNATURE, 'regtest')
      expect(backend.verifyMessageBip322).not.toHaveBeenCalled()
      native.verifyMessageBip322.mockReturnValue({ valid: true })
      expect(() => binding.verifyMessageBip322('m', ADDRESS, SIGNATURE)).toThrow('invalid result')
      binding._closed = true
      expect(() => binding.signMessageBip322('m', ADDRESS)).toThrow('closed')
    })
  })
}
