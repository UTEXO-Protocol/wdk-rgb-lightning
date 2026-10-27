import { jest } from '@jest/globals'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { assertHistoricalQualification, HISTORICAL_QUALIFICATION_RUNTIME } from './regtest/historical-scope.mjs'
import { daemon, rpc, WalletProcess } from './regtest/harness.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const legacyPackage = {
  version: '0.2.0-beta.5',
  peerDependencies: {
    '@utexo/rgb-lightning-node-bare': '0.2.0-beta.5', '@utexo/rgb-lightning-node-nodejs': '0.2.0-beta.5'
  }
}

test('preserves only the exact historical source profile without changing fixture pins', () => {
  expect(() => assertHistoricalQualification({ packageJson: legacyPackage, runtime: HISTORICAL_QUALIFICATION_RUNTIME })).not.toThrow()
  expect(() => assertHistoricalQualification({ packageJson: { ...legacyPackage, version: '0.2.0-bfa.0' }, runtime: HISTORICAL_QUALIFICATION_RUNTIME }))
    .toThrow('Historical beta.5/proxy-0.3')
  expect(() => assertHistoricalQualification({ packageJson: { ...legacyPackage, peerDependencies: {} }, runtime: HISTORICAL_QUALIFICATION_RUNTIME }))
    .toThrow('Historical beta.5/proxy-0.3')
})

test.each(Object.keys(HISTORICAL_QUALIFICATION_RUNTIME))('rejects a changed historical native %s', key => {
  expect(() => assertHistoricalQualification({
    packageJson: legacyPackage,
    runtime: { ...HISTORICAL_QUALIFICATION_RUNTIME, [key]: 'different' }
  })).toThrow('Historical beta.5/proxy-0.3')
})

test('new RGB identities are not admitted by a reused legacy RLN version string', () => {
  expect(() => assertHistoricalQualification({
    packageJson: legacyPackage,
    runtime: { ...HISTORICAL_QUALIFICATION_RUNTIME, rgb_lib_commit: 'a'.repeat(40) }
  })).toThrow('Historical beta.5/proxy-0.3')
})

test('legacy RPC and wallet creation stop before network or child creation in the candidate', async () => {
  const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('Unexpected legacy network') })
  const directory = mkdtempSync(path.join(tmpdir(), 'wdk historical scope '))
  try {
    await expect(rpc('generatetoaddress', [6])).rejects.toThrow('Historical beta.5/proxy-0.3')
    await expect(daemon('unlock', {})).rejects.toThrow('Historical beta.5/proxy-0.3')
    expect(() => new WalletProcess(directory, 'must-not-create')).toThrow('Historical beta.5/proxy-0.3')
    expect(existsSync(path.join(directory, 'must-not-create'))).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  } finally {
    fetch.mockRestore()
    rmSync(directory, { recursive: true, force: true })
  }
})

test.each(['tests/regtest/setup.mjs', 'tests/regtest/external-unlock.mjs', 'tests/mobile/server.mjs', 'tests/mobile/qualify.mjs'])(
  '%s refuses the candidate before commands, services, devices or evidence writes', entry => {
    const preload = `
      import { createRequire, syncBuiltinESMExports } from 'node:module'
      const require = createRequire(process.cwd() + '/package.json')
      const fail = () => { throw new Error('UNEXPECTED_LEGACY_SIDE_EFFECT') }
      const cp = require('node:child_process')
      for (const key of ['execFileSync', 'execSync', 'spawn', 'spawnSync']) cp[key] = fail
      require('node:fs').mkdtempSync = fail
      require('node:http').createServer = fail
      globalThis.fetch = fail
      syncBuiltinESMExports()
    `
    const result = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(preload)}`, entry], {
      cwd: root,
      encoding: 'utf8',
      timeout: 10_000,
      env: { ...process.env, ORG_READ_TOKEN: '', QUALIFICATION_DEVICE: 'unselected' }
    })
    expect(result.error).toBeUndefined()
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Historical beta.5/proxy-0.3')
    expect(result.stderr).not.toContain('UNEXPECTED_LEGACY_SIDE_EFFECT')
  }
)
