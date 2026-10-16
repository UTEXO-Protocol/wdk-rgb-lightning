import { createHash } from 'node:crypto'
import {
  chmodSync, lstatSync, mkdirSync, mkdtempSync,
  readFileSync, realpathSync, rmSync, writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { gunzipSync } from 'node:zlib'

function git (directory, args) {
  const result = spawnSync('git', ['-C', directory, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
  })
  if (result.error || result.status !== 0) throw new Error('Release package requires an inspectable Git repository')
  return result.stdout.trim()
}

function requireCleanRoot (directory, expectedHead) {
  if (git(directory, ['rev-parse', '--show-toplevel']) !== directory) {
    throw new Error('Release package directory must be the Git repository root')
  }
  const head = git(directory, ['rev-parse', 'HEAD'])
  if (!/^[a-f0-9]{40}$/.test(head) || (expectedHead && head !== expectedHead)) {
    throw new Error('Release package Git HEAD changed during packaging')
  }
  // Ignore only files Git itself ignores. New, uncommitted source must fail.
  const status = git(directory, ['status', '--porcelain=v1', '--untracked-files=all', '--ignore-submodules=none'])
  if (status) {
    throw new Error(`Release package requires a clean Git checkout, including untracked source:\n${status}`)
  }
  return head
}

function npmPack (directory, outputDir, npmExecutable, dryRun = false) {
  const result = spawnSync(npmExecutable, [
    'pack', '--json', '--ignore-scripts', '--pack-destination', outputDir,
    ...(dryRun ? ['--dry-run'] : [])
  ], { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (result.error || result.status !== 0) throw new Error(`Release npm pack failed:\n${result.stderr || result.stdout || result.error}`)
  let packages
  try {
    const value = JSON.parse(result.stdout)
    packages = Array.isArray(value) ? value : Object.values(value)
  } catch (cause) {
    throw new Error('Release npm pack returned invalid JSON', { cause })
  }
  if (packages.length !== 1 || !Array.isArray(packages[0]?.files)) {
    throw new Error('Release npm pack must return exactly one package file list')
  }
  return packages[0]
}

function requireReleaseNpm (npmExecutable) {
  const result = spawnSync(npmExecutable, ['--version'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
  })
  // Older pacote versions can execute prepare even with --ignore-scripts.
  // Keep the no-lifecycle guarantee on the npm toolchain used by release CI.
  if (result.error || result.status !== 0 || !/^\d+\.\d+\.\d+(?:\s|$)/.test(result.stdout) ||
      Number(result.stdout.split('.')[0]) < 12) {
    throw new Error('Release packaging requires npm >=12; release CI pins npm 12.0.1')
  }
}

// Inspect only the fixed, short package.json member; never extract an archive.
function packedManifest (tarball) {
  const archive = gunzipSync(tarball)
  for (let offset = 0; offset + 512 <= archive.length;) {
    const header = archive.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '')
    const size = parseInt(header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim(), 8)
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > archive.length) {
      throw new Error('Invalid release tar archive')
    }
    if ((prefix ? `${prefix}/${name}` : name) === 'package/package.json') {
      return JSON.parse(archive.subarray(offset + 512, offset + 512 + size).toString('utf8'))
    }
    offset += 512 + Math.ceil(size / 512) * 512
  }
  throw new Error('Release tarball is missing package/package.json')
}

/** Build immutable publication bytes without changing tracked package.json. */
export function packReleasePackage ({
  directory,
  outputDir,
  validatePacked,
  npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm'
}) {
  directory = realpathSync(directory)
  const gitHead = requireCleanRoot(directory)
  requireReleaseNpm(npmExecutable)
  const original = npmPack(directory, outputDir, npmExecutable, true)
  validatePacked(original)
  const expectedFiles = original.files.map(file => file.path).sort()
  const stage = mkdtempSync(path.join(tmpdir(), 'wdk-release-stage-'))
  try {
    for (const file of expectedFiles) {
      if (typeof file !== 'string' || path.posix.isAbsolute(file) || file.split('/').some(part => part === '..' || part === '.')) {
        throw new Error('Invalid release package file path')
      }
      const source = path.join(directory, file)
      const stat = lstatSync(source)
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Release package requires regular source files: ${file}`)
      try { git(directory, ['ls-files', '--error-unmatch', '--', file]) } catch {
        throw new Error(`Release package selected source must be tracked: ${file}`)
      }
      const entry = git(directory, ['ls-tree', '--full-tree', gitHead, '--', file])
      const mode = /^(100644|100755) blob [a-f0-9]{40}\t/.exec(entry)?.[1]
      if (!mode) throw new Error(`Release source must be a regular Git blob: ${file}`)
      const destination = path.join(stage, file)
      mkdirSync(path.dirname(destination), { recursive: true })
      // Read the immutable Git blob, not a working file that another process
      // could change and restore between the two clean-checkout observations.
      const blob = spawnSync('git', ['-C', directory, 'cat-file', 'blob', `${gitHead}:${file}`], {
        stdio: ['ignore', 'pipe', 'pipe']
      })
      if (blob.error || blob.status !== 0) throw new Error(`Cannot read release source blob: ${file}`)
      writeFileSync(destination, blob.stdout)
      chmodSync(destination, mode === '100755' ? 0o755 : 0o644)
    }
    const manifestPath = path.join(stage, 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (manifest.gitHead !== undefined && manifest.gitHead !== gitHead) {
      throw new Error('Tracked package.json contains a conflicting gitHead')
    }
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, gitHead }, null, 2) + '\n')
    const packed = npmPack(stage, outputDir, npmExecutable)
    validatePacked(packed)
    if (JSON.stringify(packed.files.map(file => file.path).sort()) !== JSON.stringify(expectedFiles)) {
      throw new Error('Release staging changed the original package file list')
    }
    if (path.basename(packed.filename) !== packed.filename) throw new Error('Invalid release tarball filename')
    const bytes = readFileSync(path.join(outputDir, packed.filename))
    if (packed.integrity !== `sha512-${createHash('sha512').update(bytes).digest('base64')}` ||
        packed.shasum !== createHash('sha1').update(bytes).digest('hex')) {
      throw new Error('Release tarball integrity does not match npm pack metadata')
    }
    const actual = packedManifest(bytes)
    if (actual.gitHead !== gitHead || actual.name !== original.name || actual.version !== original.version) {
      throw new Error('Release tarball manifest does not match the clean Git source')
    }
    requireCleanRoot(directory, gitHead)
    return { packed, gitHead }
  } finally {
    rmSync(stage, { recursive: true, force: true })
  }
}
