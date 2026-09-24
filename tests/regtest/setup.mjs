import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { here, prepareChain, until } from './harness.mjs'

const compose = ['compose', '-f', path.join(here, 'compose.yaml')]
const sources = fs.mkdtempSync(path.join(os.tmpdir(), 'wdk-rln-stack-sources-'))
const run = (command, args, options = {}) => execFileSync(command, args, { stdio: 'inherit', ...options })

function checkout (name, repository, commit, submodules = false) {
  const directory = path.join(sources, name)
  run('git', ['clone', '--no-checkout', repository, directory])
  run('git', ['checkout', '--detach', commit], { cwd: directory })
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' }).trim(), commit)
  if (submodules) run('git', ['submodule', 'update', '--init', '--recursive'], { cwd: directory })
  return directory
}

try {
  run('docker', [...compose, 'build', 'bitcoind', 'electrs', 'explorer'])
  const rln = checkout('rln', 'https://github.com/UTEXO-Protocol/rgb-lightning-node.git', 'af03c7f1a65135a429f05a5820600338215954dc', true)
  run('docker', ['build', '-f', path.join(here, 'Rln.Dockerfile'), '-t', 'wdk-qualification/rln:0.13.0-beta.3', rln])
  const lspCommit = 'b865c8868e202ba90055d4924382eada62c52cd6'
  const lsp = checkout('lsp', 'https://github.com/UTEXO-Protocol/utexo-lsp.git', lspCommit)
  run('docker', ['build', '-f', path.join(here, 'Lsp.Dockerfile'), '--label', `org.opencontainers.image.revision=${lspCommit}`, '-t', `wdk-qualification/lsp:${lspCommit}`, lsp])
  run('docker', [...compose, 'up', '-d', 'bitcoind', 'indexer', 'electrs', 'proxy', 'explorer', 'rln', 'peer-proxy-loopback'])
  await until('regtest RPC startup', async () => {
    try { return await prepareChain() } catch (error) {
      if (error instanceof assert.AssertionError) throw error
      return false
    }
  })
  console.log('Local regtest explorer: http://127.0.0.1:29303')
  console.log('LSP is configured with a newly issued fixture asset by test:regtest:lsp.')
} finally {
  fs.rmSync(sources, { recursive: true, force: true })
}
