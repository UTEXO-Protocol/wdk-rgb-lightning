// Copyright 2026 UTEXO. Licensed under the Apache License, Version 2.0.
import { jest } from '@jest/globals'
import WalletAccount from '../src/wallet-account-rgb-lightning.js'
import WalletManager from '../src/wallet-manager-rgb-lightning.js'
import { BareRgbLightningBinding } from '../src/bare-binding.js'
import { NodeRgbLightningBinding } from '../src/node-binding.js'
import { VssUnsupportedError, VssError } from '../src/errors.js'
import { VSS_SAFETY_POLICY, disabledVssStatus } from '../src/vss-policy.js'
import bare from '@utexo/rgb-lightning-node-bare'
import node from '@utexo/rgb-lightning-node-nodejs'

const config = { network: 'regtest', dataDir: '/unused' }
const cases = [[BareRgbLightningBinding, bare], [NodeRgbLightningBinding, node]]
const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

afterEach(() => jest.restoreAllMocks())

describe('VSS safety policy', () => {
  it('uses a stable sanitized error in the existing VSS hierarchy', () => {
    const error = new VssUnsupportedError('secret-should-not-be-accepted')
    expect(error).toBeInstanceOf(VssError)
    expect(error).toMatchObject({ name: 'VssUnsupportedError', code: VSS_SAFETY_POLICY.code, message: VSS_SAFETY_POLICY.reason })
  })

  it.each([null, '', ' ', 'https://user:private-password@server.invalid/private-token', false, 0, {}])(
    'rejects any supplied configuration before a manager can create a binding: %p', (vssUrl) => {
      class Manager extends WalletManager {
        static get Binding () { throw new Error('Binding must not be accessed') }
      }
      expect(() => new Manager(mnemonic, { ...config, vssUrl })).toThrow(VssUnsupportedError)
    }
  )

  it.each(cases)('rejects configured %p before creating signer or SDK state', (Binding, native) => {
    const create = jest.spyOn(native.SdkNode, 'create')
    const signer = jest.spyOn(native.NativeExternalSigner, 'createWithStorage')
    for (const vssUrl of [null, '', ' ', false, 0, {}, 'https://user:private-password@server.invalid/private-token']) {
      try {
        Reflect.construct(Binding, [{ ...config, vssUrl, vssAllowHttp: true, vssAllowEmptyRestore: true }])
        throw new Error('Configuration unexpectedly accepted')
      } catch (error) {
        expect(error).toBeInstanceOf(VssUnsupportedError)
        expect(JSON.stringify(error.toJSON())).not.toMatch(/private-password|private-token|server.invalid/)
      }
    }
    expect(create).not.toHaveBeenCalled()
    expect(signer).not.toHaveBeenCalled()
  })

  it.each(cases)('keeps unconfigured %p usable and cannot opt in with legacy flags', (Binding, native) => {
    const binding = new Binding({ ...config, vssAllowHttp: true, vssAllowEmptyRestore: true })
    expect(binding._initRequest).not.toHaveProperty('vss_url')
    expect(binding._initRequest).not.toHaveProperty('vss_allow_http')
    expect(binding._initRequest).not.toHaveProperty('vss_allow_empty_restore')
    const create = jest.spyOn(native.SdkNode, 'create')
    expect(binding.vssStatus()).toEqual(disabledVssStatus())
    expect(() => binding.vssBackup()).toThrow(VssUnsupportedError)
    expect(() => binding.clearVssFence('private-password')).toThrow(VssUnsupportedError)
    expect(create).not.toHaveBeenCalled()
  })

  it('denies custom account VSS methods without trusting or invoking their binding', async () => {
    const binding = {
      ensureNode: jest.fn(),
      vssStatus: jest.fn(() => ({ configured: true, lastBackupVersion: 99 })),
      vssBackup: jest.fn(),
      clearVssFence: jest.fn()
    }
    const account = new WalletAccount({ binding })
    await expect(account.vssBackup()).rejects.toBeInstanceOf(VssUnsupportedError)
    await expect(account.clearVssFence('private-password')).rejects.toBeInstanceOf(VssUnsupportedError)
    expect(await account.vssStatus()).toEqual(disabledVssStatus())
    const readOnly = await account.toReadOnlyAccount()
    expect(await readOnly.vssStatus()).toEqual(disabledVssStatus())
    for (const view of [account, readOnly]) {
      expect(view.getCapabilities().vss).toEqual({
        ...VSS_SAFETY_POLICY,
        automaticBackup: false,
        manualBackup: false,
        restore: false,
        remoteErasure: false
      })
    }
    for (const method of Object.values(binding)) expect(method).not.toHaveBeenCalled()
  })

  it.each(cases)('requires exact compiled VSS safety metadata for %p', (Binding, native) => {
    const runtime = native.getRuntimeInfo()
    const spy = jest.spyOn(native, 'getRuntimeInfo')
    const create = jest.spyOn(native.SdkNode, 'create')
    const unsafe = [undefined, null, [], {}, { ...VSS_SAFETY_POLICY, supported: true },
      { ...VSS_SAFETY_POLICY, code: 'OTHER' }, { ...VSS_SAFETY_POLICY, reason: 'unknown' },
      { ...VSS_SAFETY_POLICY, allowUnsafe: true },
      Object.assign(Object.create(VSS_SAFETY_POLICY), { unrelated: 1, extra: 2, unknown: 3 })]
    for (const vssPolicy of unsafe) {
      spy.mockReturnValue({ ...runtime, vss_policy: vssPolicy })
      expect(() => new Binding(config)).toThrow(expect.objectContaining({ code: 'ERR_RLN_RUNTIME_MISMATCH' }))
    }
    spy.mockReturnValue({ ...runtime, capabilities: runtime.capabilities.filter(value => value !== 'vss-safety-policy-v1') })
    expect(() => new Binding(config)).toThrow(expect.objectContaining({ code: 'ERR_RLN_RUNTIME_MISMATCH' }))
    expect(create).not.toHaveBeenCalled()
  })
})
