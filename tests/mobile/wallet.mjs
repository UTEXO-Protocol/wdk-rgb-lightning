import 'bare-node-runtime/global'
import fs from 'bare-fs'
import path from 'bare-path'
import crypto from 'bare-crypto'
import https from 'bare-https'
import WalletManager from '@utexo/wdk-rgb-lightning'
import native from '@utexo/rgb-lightning-node-bare'

/* global Bare, BareKit */
const [directory, host] = Bare.argv.slice(-2)
let manager
let account
let partial = ''
let pending = Promise.resolve()
const reply = data => BareKit.IPC.write(Buffer.from(JSON.stringify(data, (_key, value) => typeof value === 'bigint' ? String(value) : value) + '\n'))
async function dispatch ({ method, args = [] }) {
  if (method === 'init') {
    const seedPath = path.join(directory, 'qualification-seed')
    if (!fs.existsSync(seedPath)) fs.writeFileSync(seedPath, crypto.randomBytes(64), { mode: 0o600 })
    manager = new WalletManager(fs.readFileSync(seedPath), { network: 'regtest', dataDir: path.join(directory, 'wallet'), daemonListeningPort: 0, ldkPeerListeningPort: 0 })
    account = await manager.getAccount()
    await account.unlock({
      ldk_chain_sync: { mode: 'TransactionSync', config: { indexer_url: `http://${host}:29302` } },
      indexer_url: `tcp://${host}:29401`,
      proxy_endpoint: `rpc://${host}:29300/json-rpc`,
      announce_addresses: []
    })
    return { runtime: native.getRuntimeInfo(), bare: Bare.versions, node: await account.getNodeInfo(), network: await account.getNetworkInfo() }
  }
  if (method === 'tls') {
    return await new Promise((resolve, reject) => {
      const request = https.request(args[0], response => { response.resume(); resolve({ status: response.statusCode }) })
      const timer = setTimeout(() => request.destroy(new Error('TLS request timeout')), 15000)
      request.on('close', () => clearTimeout(timer))
      request.on('error', reject)
      request.end()
    })
  }
  if (method === 'shutdown') { await account.shutdown(); manager.dispose(); return { stopped: true } }
  if (method === 'ping') return { alive: true, bare: Bare.versions }
  if (!account || typeof account[method] !== 'function') throw new Error(`Unknown account operation ${method}`)
  return await account[method](...args)
}
BareKit.IPC.on('data', data => {
  partial += data.toString()
  let newline
  while ((newline = partial.indexOf('\n')) !== -1) {
    const command = JSON.parse(partial.slice(0, newline))
    partial = partial.slice(newline + 1)
    pending = pending.then(async () => {
      try { reply({ id: command.id, method: command.method, ok: true, result: await dispatch(command) }) } catch (error) { reply({ id: command.id, method: command.method, ok: false, error: error.message }) }
    })
  }
})
reply({ method: 'ready', ok: true, bare: Bare.versions })
