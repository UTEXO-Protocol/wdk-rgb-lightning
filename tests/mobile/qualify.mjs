import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { mine, prepareChain, rpc, sleep, until } from '../regtest/harness.mjs'

const platform = process.argv.includes('--android') ? 'android' : 'ios'
const device = process.env.QUALIFICATION_DEVICE
assert.ok(device, 'QUALIFICATION_DEVICE must select a dedicated simulator/emulator')
if (platform === 'android') assert.match(device, /^emulator-\d+$/, 'physical devices are excluded')
const app = 'com.utexo.wdkqualification'
const endpoint = 'http://127.0.0.1:29888'
const root = fs.mkdtempSync(path.join(os.tmpdir(), `wdk-${platform}-qualification-`))
fs.chmodSync(root, 0o700)
const results = []
let sequence = Date.now()
const events = async () => (await fetch(endpoint + '/results')).json()
async function call (method, args = [], timeout = 120000) {
  const id = ++sequence
  const queued = await fetch(endpoint + '/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, method, args }) })
  assert.ok(queued.ok)
  const response = await until(`mobile ${method}`, async () => (await events()).find(item => item.id === id), timeout)
  if (!response.ok) throw new Error(response.error)
  return response.result
}
async function step (name, fn) {
  try { const result = await fn(); results.push({ name, status: 'passed', result }); console.log(`PASS ${name}`); return result } catch (error) { results.push({ name, status: 'failed', error: error.message }); throw error } finally { fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify({ platform, device, policy: 'strict', results }, null, 2)) }
}
const sim = args => execFileSync('xcrun', ['simctl', ...args], { encoding: 'utf8' })
const adb = args => execFileSync(process.env.ADB || (process.env.ANDROID_HOME ? path.join(process.env.ANDROID_HOME, 'platform-tools/adb') : 'adb'), ['-s', device, ...args], { encoding: 'utf8' })
const launch = () => platform === 'ios' ? sim(['launch', device, app]) : adb(['shell', 'am', 'start', '-n', `${app}/.MainActivity`])

console.log(`Mobile scenario evidence: ${root}`)
try {
  await step('dedicated simulator or emulator identity', async () => {
    if (platform === 'android') {
      assert.equal(adb(['shell', 'getprop', 'ro.kernel.qemu']).trim(), '1')
      return { pageSize: Number(adb(['shell', 'getconf', 'PAGE_SIZE']).trim()), android: adb(['shell', 'getprop', 'ro.build.version.release']).trim() }
    }
    const devices = JSON.parse(sim(['list', 'devices', '--json'])).devices
    const match = Object.values(devices).flat().find(item => item.udid === device)
    assert.ok(match?.isAvailable && match.state === 'Booted')
    return { name: match.name, udid: match.udid }
  })
  await prepareChain()
  const init = await step('native identity and real strict unlock through RN IPC', async () => {
    const value = process.argv.includes('--attached') ? (await events()).findLast(item => item.method === 'init' && item.ok).result : await call('init')
    assert.equal(value.runtime.rln_commit, 'af03c7f1a65135a429f05a5820600338215954dc')
    assert.equal(value.runtime.target, platform === 'ios' ? 'aarch64-apple-ios-sim' : 'aarch64-linux-android')
    assert.equal(value.network.network, 'Regtest')
    assert.equal(value.node.channel_asset_max_amount, '18446744073709551615')
    return { runtime: value.runtime, bare: value.bare, pubkey: value.node.pubkey }
  })
  const address = await call('getAddress')
  await step('native funding, balance and signed on-chain send from worklet', async () => {
    const before = await call('getBalanceDetails')
    await rpc('sendtoaddress', [address, 0.005], 'miner')
    await mine(6)
    await call('sync')
    const funded = await call('getBalanceDetails')
    assert.equal(funded.vanilla.spendable - before.vanilla.spendable, 500000)
    const destination = await rpc('getnewaddress', [], 'miner')
    const sent = await call('sendBtc', [{ address: destination, amount: 10000, fee_rate: 2, skip_sync: false }])
    await mine(6)
    assert.equal(Math.round((await rpc('getreceivedbyaddress', [destination, 1], 'miner')) * 1e8), 10000)
    return sent
  })
  await step('Bare TLS accepts valid HTTPS certificate', async () => {
    const response = await call('tls', ['https://example.com/'], 30000)
    assert.equal(response.status, 200)
    return response
  })
  await step('Bare TLS rejects self-signed certificate', async () => {
    await assert.rejects(call('tls', ['https://self-signed.badssl.com/'], 30000), /certificate|cert_|self.signed|unable to verify/i)
  })
  await step('background/foreground preserves worklet and wallet identity', async () => {
    const start = (await events()).length
    if (platform === 'ios') sim(['launch', device, 'com.apple.Preferences'])
    else adb(['shell', 'input', 'keyevent', '3'])
    await sleep(5000)
    launch()
    await until('app delivered lifecycle transitions', async () => {
      const states = (await events()).slice(start).filter(event => event.type === 'app-state').map(event => event.state)
      return states.includes('background') && states.includes('active')
    })
    assert.equal((await call('ping')).alive, true)
    assert.equal((await call('getNodeInfo')).pubkey, init.pubkey)
  })
  await step('process termination and cold launch preserve latest wallet state', async () => {
    await call('sync')
    const before = await call('getBalanceDetails')
    const count = (await events()).filter(item => item.method === 'ready').length
    if (platform === 'ios') sim(['terminate', device, app])
    else adb(['shell', 'am', 'force-stop', app])
    launch()
    await until('new worklet ready', async () => (await events()).filter(item => item.method === 'ready').length > count)
    const restarted = await call('init')
    assert.equal(restarted.node.pubkey, init.pubkey)
    assert.equal(await call('getAddress'), address)
    await call('sync')
    assert.deepEqual(await call('getBalanceDetails'), before)
  })
  await step('explicit native shutdown and worklet teardown return to RN', async () => {
    assert.equal((await call('shutdown')).stopped, true)
    await call('terminateWorklet')
  })
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  console.log(`Evidence retained: ${root}`)
}
