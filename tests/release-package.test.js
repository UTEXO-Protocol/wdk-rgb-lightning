import { execFileSync } from 'node:child_process'
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { packReleasePackage } from '../scripts/release-package.mjs'

describe('clean Git release tarball identity', () => {
  let root
  let directory
  let outputDir
  const files = ['README.md', 'package.json', 'src/index.js']

  function git (args) {
    return execFileSync('git', ['-C', directory, ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
    }).trim()
  }

  function commit () {
    git(['add', '.'])
    git(['-c', 'user.name=Release fixture', '-c', 'user.email=fixture@example.invalid',
      '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false',
      'commit', '--quiet', '-m', 'Release package fixture'])
    return git(['rev-parse', 'HEAD'])
  }

  function validatePacked (packed) {
    if (packed.name !== 'wdk-release-fixture' || packed.version !== '1.2.3-beta.1' ||
        JSON.stringify(packed.files.map(file => file.path).sort()) !== JSON.stringify(files)) {
      throw new Error('Fixture package identity or file allowlist mismatch')
    }
  }

  function pack (options = {}) {
    return packReleasePackage({ directory, outputDir, validatePacked, ...options })
  }

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'wdk-release-package-test-'))
    directory = path.join(root, 'source')
    outputDir = path.join(root, 'output')
    mkdirSync(path.join(directory, 'src'), { recursive: true })
    mkdirSync(outputDir)
    writeFileSync(path.join(directory, 'package.json'), JSON.stringify({
      name: 'wdk-release-fixture',
      version: '1.2.3-beta.1',
      files: ['src/index.js'],
      scripts: {
        prepare: 'node -e "require(\'node:fs\').writeFileSync(\'prepare-ran\',\'bad\')"',
        prepack: 'node -e "require(\'node:fs\').writeFileSync(\'prepack-ran\',\'bad\')"',
        postpack: 'node -e "require(\'node:fs\').writeFileSync(\'postpack-ran\',\'bad\')"'
      }
    }, null, 2) + '\n')
    writeFileSync(path.join(directory, 'README.md'), '# Release fixture\n')
    writeFileSync(path.join(directory, 'src/index.js'), 'export const fixture = true\n')
    writeFileSync(path.join(directory, '.gitignore'), 'ignored-cache/\n')
    git(['init', '--quiet', '--initial-branch=main'])
    commit()
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('packs the exact clean HEAD twice with identical bytes, no scripts and no source changes', () => {
    const originalManifest = readFileSync(path.join(directory, 'package.json'))
    const head = git(['rev-parse', 'HEAD'])
    const first = pack()
    const firstBytes = readFileSync(path.join(outputDir, first.packed.filename))
    const secondDir = path.join(root, 'second-output')
    mkdirSync(secondDir)
    const second = pack({ outputDir: secondDir })
    const secondBytes = readFileSync(path.join(secondDir, second.packed.filename))
    expect(first.gitHead).toBe(head)
    expect(second.gitHead).toBe(head)
    expect(firstBytes.equals(secondBytes)).toBe(true)
    expect(first.packed.integrity).toBe(second.packed.integrity)
    expect(readFileSync(path.join(directory, 'package.json')).equals(originalManifest)).toBe(true)
    expect(JSON.parse(originalManifest).gitHead).toBeUndefined()
    // Check the archive's own bytes, independent of the helper's returned SHA.
    const tar = gunzipSync(firstBytes)
    const marker = Buffer.from(`"gitHead": "${head}"`)
    expect(tar.includes(marker)).toBe(true)
    for (const script of ['prepare', 'prepack', 'postpack']) {
      expect(existsSync(path.join(directory, `${script}-ran`))).toBe(false)
    }
    expect(git(['status', '--porcelain', '--untracked-files=all'])).toBe('')
  })

  it.each([false, true])('rejects tracked changes before packing (staged=%s)', staged => {
    writeFileSync(path.join(directory, 'src/index.js'), 'changed source\n')
    if (staged) git(['add', 'src/index.js'])
    expect(() => pack()).toThrow('requires a clean Git checkout')
  })

  it('packs immutable HEAD bytes even if a concurrent writer changes and restores a selected file', () => {
    const sourcePath = path.join(directory, 'src/index.js')
    const original = readFileSync(sourcePath)
    const changed = 'export const concurrentUncommittedValue = true\n'
    let validations = 0
    const result = pack({
      validatePacked (metadata) {
        validatePacked(metadata)
        if (++validations === 1) {
          writeFileSync(sourcePath, changed)
          chmodSync(sourcePath, 0o755)
        } else {
          writeFileSync(sourcePath, original)
          chmodSync(sourcePath, 0o644)
        }
      }
    })
    const archive = gunzipSync(readFileSync(path.join(outputDir, result.packed.filename)))
    expect(archive.includes(original)).toBe(true)
    expect(archive.includes(Buffer.from(changed))).toBe(false)
    expect(result.packed.files.find(file => file.path === 'src/index.js').mode).toBe(0o644)
    expect(git(['status', '--porcelain', '--untracked-files=all'])).toBe('')
  })

  it('rejects untracked source before packing', () => {
    writeFileSync(path.join(directory, 'new-source.js'), 'uncommitted source\n')
    expect(() => pack()).toThrow('including untracked source')
  })

  it('rejects older npm before a prepare hook can run', () => {
    const npmExecutable = path.join(root, 'old-npm')
    writeFileSync(npmExecutable, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo 10.9.9; else exit 99; fi\n')
    chmodSync(npmExecutable, 0o755)
    expect(() => pack({ npmExecutable })).toThrow('Release packaging requires npm >=12')
    expect(existsSync(path.join(directory, 'prepare-ran'))).toBe(false)
  })

  it('allows ignored caches that are outside the npm package', () => {
    mkdirSync(path.join(directory, 'ignored-cache'))
    writeFileSync(path.join(directory, 'ignored-cache/compiled.bin'), 'cache')
    expect(pack().gitHead).toBe(git(['rev-parse', 'HEAD']))
  })

  it('rejects a selected package file that is ignored and untracked', () => {
    const manifestPath = path.join(directory, 'package.json')
    const metadata = JSON.parse(readFileSync(manifestPath, 'utf8'))
    metadata.files.push('ignored-cache/compiled.bin')
    writeFileSync(manifestPath, JSON.stringify(metadata))
    commit()
    mkdirSync(path.join(directory, 'ignored-cache'))
    writeFileSync(path.join(directory, 'ignored-cache/compiled.bin'), 'untracked packaged input')
    expect(() => pack({ validatePacked: () => {} })).toThrow('selected source must be tracked')
  })

  it('rejects a repository subdirectory rather than adopting its parent HEAD', () => {
    expect(() => pack({ directory: path.join(directory, 'src') })).toThrow('must be the Git repository root')
  })

  it('rejects a source directory without Git metadata', () => {
    rmSync(path.join(directory, '.git'), { recursive: true, force: true })
    expect(() => pack()).toThrow('requires an inspectable Git repository')
  })

  it('rejects a tracked conflicting gitHead instead of overriding it silently', () => {
    const manifestPath = path.join(directory, 'package.json')
    const metadata = JSON.parse(readFileSync(manifestPath, 'utf8'))
    metadata.gitHead = '0'.repeat(40)
    writeFileSync(manifestPath, JSON.stringify(metadata))
    commit()
    expect(() => pack()).toThrow('contains a conflicting gitHead')
  })

  it('validates the original package allowlist before staging', () => {
    const manifestPath = path.join(directory, 'package.json')
    const metadata = JSON.parse(readFileSync(manifestPath, 'utf8'))
    metadata.files.push('unexpected.txt')
    writeFileSync(manifestPath, JSON.stringify(metadata))
    writeFileSync(path.join(directory, 'unexpected.txt'), 'unexpected published input')
    commit()
    expect(() => pack()).toThrow('identity or file allowlist mismatch')
  })
})
