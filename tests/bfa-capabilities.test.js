import { jest } from '@jest/globals'
import nativeMock from './__mocks__/rgb-lightning-node-nodejs.mjs'
import { nativeBfaCapabilities } from '../src/bfa-capabilities.js'
import WalletAccount from '../src/wallet-account-rgb-lightning.js'

function native () {
  const SdkNode = jest.fn()
  for (const name of ['listAssets', 'assetBalance', 'assetMetadata', 'burn', 'getConsignment']) SdkNode.prototype[name] = jest.fn()
  return { ...nativeMock, SdkNode }
}

test('reports only strictly admitted flags and real methods without constructing a node', () => {
  const n = native()
  expect(nativeBfaCapabilities(n)).toEqual({ bfa: true, burn: true, consignment: true })
  expect(n.SdkNode).not.toHaveBeenCalled()
  delete n.SdkNode.prototype.burn
  expect(nativeBfaCapabilities(n).burn).toBe(false)
  delete n.SdkNode.prototype.getConsignment
  expect(nativeBfaCapabilities(n)).toEqual({ bfa: true, burn: false, consignment: false })
  delete n.SdkNode.prototype.listAssets
  expect(nativeBfaCapabilities(n).bfa).toBe(false)
})

test.each(['external-signer-burn-v1', 'consignment-export-v1'])('missing required %s is a runtime admission failure', capability => {
  const n = native()
  const info = n.getRuntimeInfo()
  n.getRuntimeInfo = () => ({ ...info, capabilities: info.capabilities.filter(item => item !== capability) })
  expect(() => nativeBfaCapabilities(n)).toThrow(expect.objectContaining({ code: 'ERR_RLN_RUNTIME_MISMATCH' }))
  expect(n.SdkNode).not.toHaveBeenCalled()
})

test('custom accounts fail closed without an explicit native capability report', async () => {
  const binding = { ensureNode: jest.fn() }
  const account = new WalletAccount({ binding })
  await expect(account.getBfaCapabilities()).resolves.toEqual({ bfa: false, burn: false, consignment: false })
  expect(binding.ensureNode).not.toHaveBeenCalled()
})
