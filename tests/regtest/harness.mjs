import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const here = path.dirname(fileURLToPath(import.meta.url))
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
export const endpoints = Object.freeze({ rpc: 'http://127.0.0.1:29443', esplora: 'http://127.0.0.1:29302', electrum: 'tcp://127.0.0.1:29401', proxy: 'rpc://127.0.0.1:29300/json-rpc' })

export async function until (label, fn, timeout = 90000) {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
    last = await fn()
    if (last) return last
    await sleep(500)
  }
  throw new Error(`Timed out: ${label}; last result=${JSON.stringify(last)}`)
}

export async function rpc (method, params = [], wallet = '') {
  const response = await fetch(endpoints.rpc + (wallet ? `/wallet/${wallet}` : ''), {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from('wdk:regtest-only').toString('base64')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'wdk-qualification', method, params }),
    signal: AbortSignal.timeout(30000)
  })
  const body = await response.json()
  if (body.error) throw new Error(`Bitcoin RPC ${method}: ${JSON.stringify(body.error)}`)
  if (!response.ok) throw new Error(`Bitcoin HTTP ${response.status}`)
  return body.result
}

export async function mine (count = 6) {
  const address = await rpc('getnewaddress', [], 'miner')
  await rpc('generatetoaddress', [count, address])
  const height = await rpc('getblockcount')
  await until('Esplora indexed mined blocks', async () => {
    const response = await fetch(`${endpoints.esplora}/blocks/tip/height`, { signal: AbortSignal.timeout(5000) })
    return response.ok && Number(await response.text()) === height
  })
  return height
}

export async function prepareChain () {
  const chain = await rpc('getblockchaininfo')
  assert.equal(chain.chain, 'regtest', 'Refusing to fund any real network')
  const wallets = await rpc('listwallets')
  if (!wallets.includes('miner')) {
    const stored = await rpc('listwalletdir')
    if (stored.wallets.some(wallet => wallet.name === 'miner')) await rpc('loadwallet', ['miner'])
    else await rpc('createwallet', ['miner'])
  }
  if (chain.blocks < 110) await mine(110 - chain.blocks)
  return chain
}

export async function daemon (endpoint, body, method = 'POST') {
  const response = await fetch(`http://127.0.0.1:29301/${endpoint}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(120000)
  })
  const value = await response.json()
  if (!response.ok) throw Object.assign(new Error(`RLN ${endpoint}: ${JSON.stringify(value)}`), { status: response.status, detail: value })
  return value
}

export async function prepareIssuer () {
  try { await daemon('init', { password: 'Disposable-regtest-only-013!' }) } catch (error) {
    if (!['AlreadyInitialized', 'UnlockedNode'].includes(error.detail?.name)) throw error
  }
  try {
    await daemon('unlock', {
      password: 'Disposable-regtest-only-013!',
      ldk_chain_sync: { mode: 'BlockSync', config: { bitcoind_rpc_username: 'wdk', bitcoind_rpc_password: 'regtest-only', bitcoind_rpc_host: 'bitcoind', bitcoind_rpc_port: 18443 } },
      indexer_url: 'tcp://electrs:50001',
      proxy_endpoint: endpoints.proxy,
      announce_addresses: []
    })
  } catch (error) {
    if (error.detail?.name !== 'AlreadyUnlocked') throw error
  }
  const address = (await daemon('address')).address
  await rpc('sendtoaddress', [address, 1], 'miner')
  await mine()
  try {
    await daemon('createutxos', { up_to: true, num: 20, size: 50000, fee_rate: 2, skip_sync: false })
  } catch (error) {
    if (error.detail?.name !== 'AllocationsAlreadyAvailable') throw error
  }
  await mine()
  return (await daemon('nodeinfo', undefined, 'GET')).pubkey
}

export class WalletProcess {
  constructor (root, name, runtime = 'node') {
    this.directory = path.join(root, name)
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    this.runtime = runtime
    this.sequence = 0
    this.seed = randomBytes(64).toString('hex')
    this.spawn()
  }

  spawn () {
    const log = fs.openSync(path.join(this.directory, 'runtime.log'), 'a', 0o600)
    const command = this.runtime === 'node' ? process.execPath : process.env.BARE_BIN
    if (!command) throw new Error('BARE_BIN must point to a Bare >=1.32.0 executable')
    this.exit = undefined
    this.spawnError = undefined
    this.groupKilled = false
    if (process.platform === 'win32') throw new Error('The local qualification harness requires POSIX process groups')
    // Bare's npm launcher spawns another process. Own both for crash tests and cleanup.
    this.child = spawn(command, [path.join(here, 'worker.mjs'), this.directory], { detached: true, stdio: ['ignore', log, log] })
    fs.closeSync(log)
    this.exited = new Promise(resolve => {
      this.child.once('exit', (code, signal) => { this.exit = { code, signal }; resolve(this.exit) })
      this.child.once('error', error => { this.spawnError = error; resolve() })
    })
  }

  killGroup () {
    if (!this.child.pid || this.groupKilled) return
    try { process.kill(-this.child.pid, 'SIGKILL') } catch (error) {
      if (error.code !== 'ESRCH') throw error
    }
    this.groupKilled = true
  }

  async crashRestart () {
    if (this.pending) throw new Error('Cannot restart while a request is active')
    this.killGroup()
    await this.exited
    for (const name of ['ready', 'request.json', 'request.tmp', 'response.json', 'response.tmp', 'active.json', 'active.tmp']) {
      fs.rmSync(path.join(this.directory, name), { force: true })
    }
    this.spawn()
    return await this.call('init', [this.config, this.seed, this.unlock], 'control')
  }

  async call (method, args = [], target = 'account', timeout = 120000) {
    if (this.pending) throw new Error('Concurrent mailbox request')
    this.pending = true
    const id = ++this.sequence
    try {
      await until('runtime ready', () => {
        this.checkAlive()
        return fs.existsSync(path.join(this.directory, 'ready'))
      }, 30000)
      const temporary = path.join(this.directory, 'request.tmp')
      fs.writeFileSync(temporary, JSON.stringify({ id, target, method, args }), { mode: 0o600 })
      fs.renameSync(temporary, path.join(this.directory, 'request.json'))
      const responsePath = path.join(this.directory, 'response.json')
      const response = await until(`${target}.${method}`, () => {
        if (!fs.existsSync(responsePath)) {
          this.checkAlive()
          return false
        }
        const value = JSON.parse(fs.readFileSync(responsePath, 'utf8'))
        fs.unlinkSync(responsePath)
        assert.equal(value.id, id)
        return value
      }, timeout)
      if (!response.ok) throw Object.assign(new Error(response.error.message), { remote: response.error })
      return response.result
    } finally {
      this.pending = false
    }
  }

  checkAlive () {
    if (this.spawnError) throw this.spawnError
    if (this.exit) throw new Error(`Runtime exited ${JSON.stringify(this.exit)}; inspect ${this.directory}/runtime.log`)
  }

  async start (port, mode = 'TransactionSync', extra = {}) {
    this.config = { network: 'regtest', dataDir: path.join(this.directory, 'wallet'), daemonListeningPort: 0, ldkPeerListeningPort: port, ...extra }
    this.unlock = {
      ldk_chain_sync: mode === 'TransactionSync'
        ? { mode, config: { indexer_url: endpoints.esplora } }
        : { mode, config: { bitcoind_rpc_username: 'wdk', bitcoind_rpc_password: 'regtest-only', bitcoind_rpc_host: '127.0.0.1', bitcoind_rpc_port: 29443 } },
      indexer_url: process.env.RGB_INDEXER_URL || endpoints.electrum,
      proxy_endpoint: endpoints.proxy,
      announce_addresses: []
    }
    const result = await this.call('init', [this.config, this.seed, this.unlock], 'control')
    assert.equal(result.runtime.rln_commit, 'af03c7f1a65135a429f05a5820600338215954dc')
    assert.equal(result.network.network.toLowerCase(), 'regtest')
    assert.equal(result.node.channel_asset_max_amount, '18446744073709551615')
    this.pubkey = result.node.pubkey
    return result
  }

  async stop () {
    if (this.spawnError) return
    if (this.exit) {
      this.killGroup()
      return
    }
    try {
      await this.call('stop', [], 'control', 30000)
      await until('native runtime exit', () => this.exit, 15000)
    } finally {
      this.killGroup()
      await this.exited
    }
  }
}
