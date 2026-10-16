import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { WalletProcess, mine, prepareChain, rpc } from './harness.mjs'

assert.equal(process.platform, 'darwin', 'This fixture uses a bounded macOS disk image, never the host filesystem')
const runtime = process.argv.includes('--bare') ? 'bare' : 'node'
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wdk-rln-storage-'))
fs.chmodSync(root, 0o700)
const image = path.join(root, 'fault.sparseimage')
const mount = path.join(root, 'volume')
const results = []
let wallet
let mounted = false
const run = (args) => execFileSync('hdiutil', args, { encoding: 'utf8', timeout: 60000 })
const record = (name, value) => {
  results.push({ name, ...value })
  fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify({ runtime, policy: 'strict', filesystem: '128MiB HFS+ sparse image', results }, null, 2), { mode: 0o600 })
  console.log(`${value.status} ${name}`)
}
async function step (name, fn) {
  try { const result = await fn(); record(name, { status: 'passed', result }); return result } catch (error) { record(name, { status: 'failed', error: error.message }); throw error }
}
function fill () {
  const stats = fs.statfsSync(mount)
  assert.ok(stats.blocks * stats.bsize < 140 * 1024 * 1024, 'refuse to fill an unbounded volume')
  assert.notEqual(stats.type, fs.statfsSync(root).type, 'expected isolated HFS+ volume')
  const fd = fs.openSync(path.join(mount, 'filler'), 'wx', 0o600)
  const data = Buffer.alloc(4096, 0xa5)
  let written = 0
  try {
    for (;;) { fs.writeSync(fd, data); written += data.length; assert.ok(written < 140 * 1024 * 1024) }
  } catch (error) {
    if (error.code !== 'ENOSPC') throw error
  } finally { fs.closeSync(fd) }
  assert.throws(() => fs.writeFileSync(path.join(mount, 'enospc-probe'), Buffer.alloc(65536)), { code: 'ENOSPC' })
  return { written, available: fs.statfsSync(mount).bavail * fs.statfsSync(mount).bsize }
}

console.log(`Evidence: ${root}; ${runtime}; strict`)
try {
  await prepareChain()
  await step('create isolated bounded filesystem', async () => {
    run(['create', '-size', '128m', '-fs', 'HFS+', '-volname', 'WDK-Disposable-Fault', '-type', 'SPARSE', image])
    fs.mkdirSync(mount)
    run(['attach', image, '-mountpoint', mount, '-nobrowse'])
    mounted = true
    return { image, mount }
  })
  wallet = new WalletProcess(root, 'alice', runtime)
  await step('initialize strict wallet on bounded volume', () => wallet.start(29521, 'TransactionSync', { dataDir: path.join(mount, 'wallet') }))
  await step('fund and persist baseline before fault', async () => {
    const address = await wallet.call('getAddress')
    await rpc('sendtoaddress', [address, 0.02], 'miner')
    await mine(6)
    await wallet.call('sync')
    const balance = await wallet.call('getBalanceDetails')
    assert.equal(balance.vanilla.spendable, 2000000)
    return { balance }
  })
  await step('exhaust only the isolated volume and independently observe ENOSPC', async () => fill())
  const destination = await rpc('getnewaddress', [], 'miner')
  const outcome = await step('capture native mutation outcome under disk-full pressure', async () => {
    try {
      return { acknowledged: true, result: await wallet.call('sendBtc', [{ address: destination, amount: 10000, fee_rate: 2, skip_sync: false }], 'account', 30000) }
    } catch (error) {
      return { acknowledged: false, error: error.message, remote: error.remote, exit: wallet.exit }
    }
  })
  await step('restore capacity and cold-restart without resetting any wallet state', async () => {
    wallet.killGroup()
    await wallet.exited
    fs.unlinkSync(path.join(mount, 'filler'))
    const restart = await wallet.crashRestart()
    assert.equal(restart.node.pubkey, wallet.pubkey)
    await mine(6)
    await wallet.call('sync')
    const received = Math.round((await rpc('getreceivedbyaddress', [destination, 1], 'miner')) * 1e8)
    assert.ok(received === 0 || received === 10000)
    if (outcome.acknowledged) assert.equal(received, 10000)
    const balance = await wallet.call('getBalanceDetails')
    if (received === 0) assert.equal(balance.vanilla.spendable, 2000000)
    else assert.ok(balance.vanilla.spendable < 1990000 && balance.vanilla.spendable > 1980000)
    return { received, balance, note: 'No automatic replay of an unacknowledged payment' }
  })
  await step('new independently verified send after recovery', async () => {
    const destination = await rpc('getnewaddress', [], 'miner')
    const sent = await wallet.call('sendBtc', [{ address: destination, amount: 11000, fee_rate: 2, skip_sync: false }])
    await mine(6)
    assert.equal(Math.round((await rpc('getreceivedbyaddress', [destination, 1], 'miner')) * 1e8), 11000)
    return sent
  })
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  if (wallet) {
    try { await step('shutdown native process', () => wallet.stop()) } catch (error) { console.error(error); process.exitCode = 1 }
  }
  if (mounted) {
    // Preserve the image and native logs as evidence, only unmount our volume.
    try { run(['detach', mount]); record('detach isolated volume', { status: 'passed' }) } catch (error) { record('detach isolated volume', { status: 'failed', error: error.message }); process.exitCode = 1 }
  }
  console.log(`Evidence retained: ${root}`)
}
