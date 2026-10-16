import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { WalletProcess, prepareChain } from './harness.mjs'

const runtime = process.argv.includes('--bare') ? 'bare' : 'node'
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wdk-rln-reopen-'))
fs.chmodSync(root, 0o700)
const wallet = new WalletProcess(root, 'wallet', runtime)
const results = { runtime, policy: 'strict', funded: false }
console.log(`Evidence: ${root}; unlock/shutdown/reopen without funding or channels`)
try {
  await prepareChain()
  await wallet.start(29505)
  results.unlock = 'passed'
  const result = await wallet.call('reopen', [wallet.config, wallet.seed, wallet.unlock], 'control')
  assert.equal(result.node.pubkey, wallet.pubkey)
  results.reopen = 'passed'
} catch (error) {
  results.error = error.message
  console.error(error)
  process.exitCode = 1
} finally {
  try { await wallet.stop() } catch (error) {
    results.shutdownError = error.message
    process.exitCode = 1
  }
  fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify(results, null, 2))
}
