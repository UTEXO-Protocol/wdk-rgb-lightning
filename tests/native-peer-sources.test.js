import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  readNativePeerSources,
  validateNativePeerSources,
  verifyNativePeerSources
} from '../scripts/verify-native-peer-sources.mjs'

const bare = '@utexo/rgb-lightning-node-bare'
const node = '@utexo/rgb-lightning-node-nodejs'
const patch = 'patches/release-adapter-v0.17.0-beta.3.patch'
const fixturePatch = 'A synthetic overlay fixture, never a native build input.\n'
const fixtureRuntime = {
  abi_version: 1,
  rln_version: '0.17.0-beta.3',
  rln_commit: 'ecc69f20308231400561f6f060fea88acfa40cc4',
  lightning_commit: '79b9eb5166546c62692d3a672986f385c7fe047d',
  adapter_sha256: createHash('sha256').update(fixturePatch).digest('hex')
}

function packageFixture () {
  return { peerDependencies: { [bare]: '0.2.0-beta.4', [node]: '0.2.0-beta.4' } }
}

describe('native peer source manifest configuration', () => {
  it('requires both known native repositories with frozen main commits and exact peer versions', () => {
    const sources = readNativePeerSources()
    expect(validateNativePeerSources(sources, packageFixture())).toBe(sources)
    expect(sources.peers[bare].ref).toBe('main')
    expect(sources.peers[node].ref).toBe('main')
  })

  it.each([
    ['unsupported schema', sources => { sources.schemaVersion = 2 }],
    ['missing lock', sources => { delete sources.sharedCffiLockSha256 }],
    ['invalid lock', sources => { sources.sharedCffiLockSha256 = '0' }],
    ['missing peer', sources => { delete sources.peers[node] }],
    ['extra peer', sources => { sources.peers.other = { ...sources.peers[node] } }],
    ['untrusted repository', sources => { sources.peers[bare].repository = 'https://example.com/bare.git' }],
    ['old branch', sources => { sources.peers[bare].ref = 'release/rln-0.15.0-beta.3' }],
    ['floating commit', sources => { sources.peers[bare].commit = 'main' }],
    ['version range', sources => { sources.peers[node].version = '^0.2.0-beta.4' }]
  ])('rejects %s', (_, mutate) => {
    const sources = readNativePeerSources()
    mutate(sources)
    expect(() => validateNativePeerSources(sources, packageFixture())).toThrow(/Invalid native peer source/)
  })

  it('rejects package/source version drift before inspecting a checkout', () => {
    const packageJson = packageFixture()
    packageJson.peerDependencies[node] = '0.2.0-beta.3'
    expect(() => validateNativePeerSources(readNativePeerSources(), packageJson))
      .toThrow('must declare one exact version matching its source manifest')
  })
})

describe('read-only native source checkout admission', () => {
  let root
  let options

  function git (directory, args) {
    return execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  }

  function commit (directory) {
    git(directory, ['add', '.'])
    git(directory, ['-c', 'user.name=Release fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Source admission fixture'])
    return git(directory, ['rev-parse', 'HEAD'])
  }

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'wdk-peer-source-test-'))
    const sources = readNativePeerSources()
    options = { packageJson: packageFixture(), sources, expectedRuntime: fixtureRuntime }
    for (const [packageName, option] of [[bare, 'bareDir'], [node, 'nodeDir']]) {
      const directory = path.join(root, option)
      mkdirSync(path.join(directory, 'patches'), { recursive: true })
      options[option] = directory
      const metadata = {
        name: packageName,
        version: sources.peers[packageName].version,
        utexoNativeOverlay: {
          repository: 'https://github.com/UTEXO-Protocol/rgb-lightning-node.git',
          ref: fixtureRuntime.rln_commit,
          commit: fixtureRuntime.rln_commit,
          rlnVersion: fixtureRuntime.rln_version,
          lightningCommit: fixtureRuntime.lightning_commit,
          patch,
          patchSha256: fixtureRuntime.adapter_sha256,
          cffiLockSha256: sources.sharedCffiLockSha256
        }
      }
      writeFileSync(path.join(directory, 'package.json'), JSON.stringify(metadata))
      writeFileSync(path.join(directory, patch), fixturePatch)
      writeFileSync(path.join(directory, '.gitignore'), 'prebuilds/\n')
      git(directory, ['init', '--quiet', '--initial-branch=main'])
      sources.peers[packageName].commit = commit(directory)
    }
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('records actual clean commit, tree and source-file digests without changing either checkout', () => {
    mkdirSync(path.join(options.bareDir, 'prebuilds'))
    writeFileSync(path.join(options.bareDir, 'prebuilds', 'ignored-native-cache.bare'), 'not source')
    const result = verifyNativePeerSources(options)
    expect(result.runtime).toEqual(fixtureRuntime)
    expect(result.sharedCffiLockSha256).toBe(options.sources.sharedCffiLockSha256)
    for (const [packageName, option] of [[bare, 'bareDir'], [node, 'nodeDir']]) {
      const actual = result.peers[packageName]
      expect(actual.commit).toBe(options.sources.peers[packageName].commit)
      expect(actual.tree).toBe(git(options[option], ['rev-parse', 'HEAD^{tree}']))
      expect(actual.packageSha256).toBe(createHash('sha256').update(readFileSync(path.join(options[option], 'package.json'))).digest('hex'))
      expect(actual.overlay).toEqual({ path: patch, sha256: fixtureRuntime.adapter_sha256 })
      expect(actual.trackedClean).toBe(true)
      expect(git(options[option], ['status', '--porcelain'])).toBe('')
    }
  })

  it('rejects a clean checkout at a different commit', () => {
    options.sources.peers[node].commit = '0'.repeat(40)
    expect(() => verifyNativePeerSources(options)).toThrow(`Native source commit mismatch for ${node}`)
  })

  it.each([false, true])('rejects tracked source changes (staged=%s)', staged => {
    writeFileSync(path.join(options.bareDir, patch), 'modified source')
    if (staged) git(options.bareDir, ['add', patch])
    expect(() => verifyNativePeerSources(options)).toThrow(`Native tracked source is dirty for ${bare}`)
  })

  it('rejects a committed overlay file whose digest disagrees with its package manifest', () => {
    writeFileSync(path.join(options.nodeDir, patch), 'changed overlay')
    options.sources.peers[node].commit = commit(options.nodeDir)
    expect(() => verifyNativePeerSources(options)).toThrow(`Native overlay file digest mismatch for ${node}`)
  })

  it('rejects a committed wrong CFFI lock even when its Git commit is pinned', () => {
    const packagePath = path.join(options.nodeDir, 'package.json')
    const metadata = JSON.parse(readFileSync(packagePath, 'utf8'))
    metadata.utexoNativeOverlay.cffiLockSha256 = '0'.repeat(64)
    writeFileSync(packagePath, JSON.stringify(metadata))
    options.sources.peers[node].commit = commit(options.nodeDir)
    expect(() => verifyNativePeerSources(options)).toThrow(`Native release manifest mismatch for ${node}`)
  })

  it('requires the repository root rather than accepting an unrelated parent repository', () => {
    options.bareDir = path.join(options.bareDir, 'patches')
    expect(() => verifyNativePeerSources(options)).toThrow('must be the repository root')
  })

  it('requires both native source directories', () => {
    delete options.nodeDir
    expect(() => verifyNativePeerSources(options)).toThrow(`Missing source directory for ${node}`)
  })
})
