import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { here, prepareChain, until } from './harness.mjs'
import { assertHistoricalQualification } from './historical-scope.mjs'

assertHistoricalQualification()

const onchainOnly = process.argv.slice(2).includes('--onchain-only')
if (process.argv.slice(2).some(argument => argument !== '--onchain-only')) {
  throw new Error('Only the optional --onchain-only setup flag is supported')
}
const buildJobs = process.env.CARGO_BUILD_JOBS || '2'
if (!/^[1-9][0-9]*$/.test(buildJobs)) throw new Error('CARGO_BUILD_JOBS must be a positive integer')
if (!process.env.ORG_READ_TOKEN || /[\r\n]/.test(process.env.ORG_READ_TOKEN)) {
  throw new Error('ORG_READ_TOKEN with read access to the three private upstream BFA repositories is required; passed only as a BuildKit secret')
}

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
  for (const service of ['bitcoind', 'electrs', 'explorer']) {
    run('docker', [...compose, 'build', '--build-arg', `CARGO_BUILD_JOBS=${buildJobs}`, service])
  }
  const rln = checkout('rln', 'https://github.com/UTEXO-Protocol/rgb-lightning-node.git', 'ecc69f20308231400561f6f060fea88acfa40cc4', true)
  run('docker', ['build', '--build-arg', `CARGO_BUILD_JOBS=${buildJobs}`, '--secret', 'id=org_read_token,env=ORG_READ_TOKEN', '--secret', `id=source_credential,src=${path.join(here, 'source-credential.sh')}`, '-f', path.join(here, 'Rln.Dockerfile'), '-t', 'wdk-qualification/rln:0.17.0-beta.3', rln])
  if (!onchainOnly) {
    const lspCommit = 'b865c8868e202ba90055d4924382eada62c52cd6'
    const lsp = checkout('lsp', 'https://github.com/UTEXO-Protocol/utexo-lsp.git', lspCommit)
    run('docker', ['build', '-f', path.join(here, 'Lsp.Dockerfile'), '--label', `org.opencontainers.image.revision=${lspCommit}`, '-t', `wdk-qualification/lsp:${lspCommit}`, lsp])
  }
  run('docker', [...compose, 'up', '-d', 'bitcoind', 'indexer', 'electrs', 'proxy', 'explorer', 'rln', 'peer-proxy-loopback'])
  await until('regtest RPC startup', async () => {
    try { return await prepareChain() } catch (error) {
      if (error instanceof assert.AssertionError) throw error
      return false
    }
  })
  console.log('Local regtest explorer: http://127.0.0.1:29303')
  console.log(onchainOnly
    ? 'On-chain issuer is ready; LSP checkout and build were excluded.'
    : 'LSP is configured with a newly issued fixture asset by test:regtest:lsp.')
} finally {
  fs.rmSync(sources, { recursive: true, force: true })
}
