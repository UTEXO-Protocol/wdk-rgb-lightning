import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { REQUIRED_NATIVE_RUNTIME } from '../src/native-runtime-contract.js'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const NATIVE_PEER_NAMES = Object.freeze([
  '@utexo/rgb-lightning-node-bare',
  '@utexo/rgb-lightning-node-nodejs'
])
const nativeRepositories = Object.freeze({
  '@utexo/rgb-lightning-node-bare': 'https://github.com/UTEXO-Protocol/rgb-lightning-node-bare.git',
  '@utexo/rgb-lightning-node-nodejs': 'https://github.com/UTEXO-Protocol/rgb-lightning-node-nodejs.git'
})
const nativeSourceRepository = 'https://github.com/UTEXO-Protocol/rgb-lightning-node.git'

function sha256 (bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

export function readNativePeerSources () {
  return JSON.parse(readFileSync(path.join(rootDir, 'native-peer-sources.json'), 'utf8'))
}

function readPackage () {
  return JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8'))
}

export function validateNativePeerSources (sources, packageJson) {
  if (!sources || sources.schemaVersion !== 1 ||
      !/^[a-f0-9]{64}$/.test(sources.sharedCffiLockSha256) ||
      !sources.peers || typeof sources.peers !== 'object' || Array.isArray(sources.peers) ||
      Object.keys(sources.peers).length !== NATIVE_PEER_NAMES.length) {
    throw new Error('Invalid native peer source manifest')
  }

  for (const packageName of NATIVE_PEER_NAMES) {
    const source = sources.peers[packageName]
    if (!source || source.repository !== nativeRepositories[packageName] ||
        source.ref !== 'main' || !/^[a-f0-9]{40}$/.test(source.commit) ||
        typeof source.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(source.version)) {
      throw new Error(`Invalid native peer source for ${packageName}`)
    }
    if (packageJson?.peerDependencies?.[packageName] !== source.version) {
      throw new Error(`Native peer ${packageName} must declare one exact version matching its source manifest`)
    }
  }
  return sources
}

export function validateNativePeerPackage (metadata, {
  packageName,
  sources,
  expectedRuntime = REQUIRED_NATIVE_RUNTIME
}) {
  const source = sources.peers[packageName]
  if (metadata?.name !== packageName || metadata.version !== source.version) {
    throw new Error(`Native package identity mismatch for ${packageName}`)
  }
  const native = metadata.utexoNativeOverlay
  if (!native || native.repository !== nativeSourceRepository ||
      native.ref !== expectedRuntime.rln_commit ||
      native.commit !== expectedRuntime.rln_commit ||
      native.rlnVersion !== expectedRuntime.rln_version ||
      native.lightningCommit !== expectedRuntime.lightning_commit ||
      native.patch !== `patches/release-adapter-v${expectedRuntime.rln_version}.patch` ||
      native.patchSha256 !== expectedRuntime.adapter_sha256 ||
      native.cffiLockSha256 !== sources.sharedCffiLockSha256) {
    throw new Error(`Native release manifest mismatch for ${packageName}`)
  }
  return native
}

function git (directory, args) {
  const result = spawnSync('git', ['-C', directory, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
  if (result.error || result.status !== 0) {
    throw new Error(`Cannot inspect native source Git repository: ${directory}`)
  }
  return result.stdout.trim()
}

export function verifyNativePeerSources ({
  bareDir,
  nodeDir,
  sources = readNativePeerSources(),
  packageJson = readPackage(),
  expectedRuntime = REQUIRED_NATIVE_RUNTIME
}) {
  validateNativePeerSources(sources, packageJson)
  const directories = {
    '@utexo/rgb-lightning-node-bare': bareDir,
    '@utexo/rgb-lightning-node-nodejs': nodeDir
  }
  const peers = {}
  for (const packageName of NATIVE_PEER_NAMES) {
    if (!directories[packageName]) throw new Error(`Missing source directory for ${packageName}`)
    const directory = realpathSync(directories[packageName])
    if (git(directory, ['rev-parse', '--show-toplevel']) !== directory) {
      throw new Error(`Native source directory must be the repository root for ${packageName}`)
    }
    const source = sources.peers[packageName]
    const commit = git(directory, ['rev-parse', 'HEAD'])
    if (commit !== source.commit) throw new Error(`Native source commit mismatch for ${packageName}`)
    // Native build products are ignored/untracked; only tracked source changes
    // affect this check. Artifact admission remains the native package's gate.
    if (git(directory, ['status', '--porcelain=v1', '--untracked-files=no', '--ignore-submodules=none'])) {
      throw new Error(`Native tracked source is dirty for ${packageName}`)
    }
    const packageBytes = readFileSync(path.join(directory, 'package.json'))
    const metadata = JSON.parse(packageBytes)
    const native = validateNativePeerPackage(metadata, { packageName, sources, expectedRuntime })
    const patchBytes = readFileSync(path.join(directory, native.patch))
    const patchSha256 = sha256(patchBytes)
    if (patchSha256 !== expectedRuntime.adapter_sha256) {
      throw new Error(`Native overlay file digest mismatch for ${packageName}`)
    }
    peers[packageName] = {
      repository: source.repository,
      ref: source.ref,
      version: source.version,
      directory,
      commit,
      tree: git(directory, ['rev-parse', 'HEAD^{tree}']),
      trackedClean: true,
      packageSha256: sha256(packageBytes),
      overlay: { path: native.patch, sha256: patchSha256 }
    }
  }
  return {
    schemaVersion: 1,
    sourceManifestCanonicalSha256: sha256(JSON.stringify(sources)),
    runtime: expectedRuntime,
    sharedCffiLockSha256: sources.sharedCffiLockSha256,
    peers
  }
}

function sourceArguments (args) {
  const options = {}
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]
    const value = args[index + 1]
    if (!['--bare-dir', '--node-dir'].includes(name) || !value || value.startsWith('--') || options[name]) {
      throw new Error('Usage: verify-native-peer-sources.mjs --bare-dir PATH --node-dir PATH')
    }
    options[name] = value
  }
  if (!options['--bare-dir'] || !options['--node-dir']) {
    throw new Error('Usage: verify-native-peer-sources.mjs --bare-dir PATH --node-dir PATH')
  }
  return { bareDir: options['--bare-dir'], nodeDir: options['--node-dir'] }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = verifyNativePeerSources(sourceArguments(process.argv.slice(2)))
  console.log(JSON.stringify({
    ...result,
    sourceManifestFileSha256: sha256(readFileSync(path.join(rootDir, 'native-peer-sources.json')))
  }, null, 2))
}
