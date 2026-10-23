import { mkdtempSync, mkdirSync, linkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { packedBareInputs, BARE_PAYLOAD_TARBALL_ENV } from '../scripts/packed-bare-inputs.mjs'
import { assertNativeRuntime, REQUIRED_NATIVE_RUNTIME } from '../src/native-runtime-contract.js'
import bare from '@utexo/rgb-lightning-node-bare'

const wrapper = 'RLN_BARE_PACKAGE_TARBALL'
const version = '0.2.0-bfa.1'
let root
let environment

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'wdk packed Bare '))
  environment = Object.fromEntries([wrapper, ...BARE_PAYLOAD_TARBALL_ENV].map((name, index) => {
    const file = path.join(root, `${index}.tgz`)
    // Only input selection is exercised here. Real archives must pass normal
    // postinstall, distribution/native artifact admission and runtime checks.
    writeFileSync(file, `synthetic archive path ${index}`)
    return [name, file]
  }))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

test('installs the complete local native distribution with one exact wrapper script grant', () => {
  const result = packedBareInputs({ version, environment })
  expect(result.installSpecs).toEqual(Object.values(environment).map(file => realpathSync(file)))
  expect(result.allowScripts).toEqual({ [`file:${realpathSync(environment[wrapper])}`]: true })
  expect(Object.keys(result.allowScripts)).toHaveLength(1)
  expect(Object.isFrozen(result.installSpecs)).toBe(true)
  expect(Object.isFrozen(result.allowScripts)).toBe(true)
  expect(Object.isFrozen(result)).toBe(true)
})

test.each(BARE_PAYLOAD_TARBALL_ENV)('requires all payloads when %s is omitted', name => {
  delete environment[name]
  expect(() => packedBareInputs({ version, environment })).toThrow('All three Bare payload')
})

test('requires a wrapper for the local payload set', () => {
  delete environment[wrapper]
  expect(() => packedBareInputs({ version, environment })).toThrow('require the local Bare wrapper')
})

test('unpublished candidate never falls through to unavailable registry payloads', () => {
  expect(() => packedBareInputs({ version, environment: {} })).toThrow('all three local payload')
  expect(() => packedBareInputs({ version, environment: { [wrapper]: environment[wrapper] } })).toThrow('all three local payload')
})

test('preserves the released registry and released wrapper-only paths', () => {
  const registry = packedBareInputs({ version: '0.2.0-beta.5', environment: {} })
  expect(registry.installSpecs).toEqual(['@utexo/rgb-lightning-node-bare@0.2.0-beta.5'])
  expect(registry.allowScripts).toEqual({ '@utexo/rgb-lightning-node-bare@0.2.0-beta.5': true })
  const local = packedBareInputs({ version: '0.2.0-beta.5', environment: { [wrapper]: environment[wrapper] } })
  expect(local.installSpecs).toEqual([realpathSync(environment[wrapper])])
  expect(local.allowScripts).toEqual({ [`file:${realpathSync(environment[wrapper])}`]: true })
})

test.each(['', 'https://example.invalid/payload.tgz', 'file:/tmp/payload.tgz', 'payload.tar', ' bad.tgz', 'bad\ntarball.tgz'])('rejects invalid archive input %p', value => {
  expect(() => packedBareInputs({ version, environment: { ...environment, [BARE_PAYLOAD_TARBALL_ENV[0]]: value } }))
    .toThrow('regular local .tgz')
})

test.each(['missing', 'directory', 'empty', 'symlink', 'duplicate', 'hardlink'])('rejects %s payload files before npm starts', kind => {
  const name = BARE_PAYLOAD_TARBALL_ENV[0]
  const file = path.join(root, 'unsafe.tgz')
  if (kind === 'directory') mkdirSync(file)
  if (kind === 'empty') writeFileSync(file, '')
  if (kind === 'symlink') symlinkSync(environment[wrapper], file)
  if (kind === 'hardlink') linkSync(environment[wrapper], file)
  environment[name] = kind === 'duplicate' ? environment[wrapper] : file
  expect(() => packedBareInputs({ version, environment })).toThrow()
})

test.each(Object.keys(REQUIRED_NATIVE_RUNTIME))('the compiled runtime assertion used by the canary rejects changed %s', key => {
  const info = bare.getRuntimeInfo()
  expect(() => assertNativeRuntime({ getRuntimeInfo: () => info })).not.toThrow()
  const changed = { ...info, [key]: typeof info[key] === 'number' ? info[key] + 1 : 'different' }
  expect(() => assertNativeRuntime({ getRuntimeInfo: () => changed })).toThrow('Incompatible RGB Lightning native runtime')
})

test('the compiled runtime assertion keeps capability and VSS policy admission', () => {
  const info = bare.getRuntimeInfo()
  for (const changed of [{ ...info, capabilities: [] }, { ...info, vss_policy: {} }]) {
    expect(() => assertNativeRuntime({ getRuntimeInfo: () => changed })).toThrow('Incompatible RGB Lightning native runtime')
  }
})
