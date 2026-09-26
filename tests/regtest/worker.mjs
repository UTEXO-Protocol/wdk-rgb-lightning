// Each real native runtime lives in its own process. Mailboxes keep native log
// output separate from the test protocol and work identically in Node and Bare.
/* global Bare */
const isBare = typeof Bare !== 'undefined'
const fs = (await import(isBare ? 'bare-fs' : 'node:fs')).default
const path = (await import(isBare ? 'bare-path' : 'node:path')).default
const argv = isBare ? Bare.argv : process.argv
const directory = argv[argv.length - 1]
const { default: WalletManager } = await import(isBare ? '../../bare.js' : '../../index-node.js')
const native = (await import(isBare ? '@utexo/rgb-lightning-node-bare' : '@utexo/rgb-lightning-node-nodejs')).default
let manager
let account
let lsp
let busy = false
const encode = value => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? { bigint: String(item) } : item)
const publish = value => {
  fs.writeFileSync(path.join(directory, 'response.tmp'), encode(value), { mode: 0o600 })
  fs.renameSync(path.join(directory, 'response.tmp'), path.join(directory, 'response.json'))
}

async function dispatch ({ target, method, args = [] }) {
  if (target === 'control') {
    if (method === 'init') {
      const [config, seedHex, unlockRequest] = args
      manager = new WalletManager(Uint8Array.from(Buffer.from(seedHex, 'hex')), config)
      account = await manager.getAccount()
      await account.unlock(unlockRequest)
      return { runtime: native.getRuntimeInfo(), node: await account.getNodeInfo(), network: await account.getNetworkInfo() }
    }
    if (method === 'stop') {
      if (account) await account.shutdown()
      if (manager) manager.dispose()
      return { stopped: true }
    }
    if (method === 'reopen') {
      const [config, seedHex, unlockRequest] = args
      if (account) await account.shutdown()
      if (manager) manager.dispose()
      manager = new WalletManager(Uint8Array.from(Buffer.from(seedHex, 'hex')), config)
      account = await manager.getAccount()
      await account.unlock(unlockRequest)
      return { node: await account.getNodeInfo(), channels: await account.listChannels() }
    }
    if (method === 'lsp') {
      lsp = await account.createLsp(...args)
      return { ready: true }
    }
    throw new Error(`Unknown control method ${method}`)
  }
  const object = target === 'account' ? account : target === 'native' ? manager._binding.ensureNode() : target === 'lsp' ? lsp : null
  if (!object || typeof object[method] !== 'function') throw new Error(`Unknown ${target}.${method}`)
  return await object[method](...args)
}

fs.writeFileSync(path.join(directory, 'ready'), 'ready')
const timer = setInterval(async () => {
  const requestPath = path.join(directory, 'request.json')
  if (busy || !fs.existsSync(requestPath)) return
  busy = true
  let request
  try {
    request = JSON.parse(fs.readFileSync(requestPath, 'utf8'))
    fs.unlinkSync(requestPath)
    fs.writeFileSync(path.join(directory, 'active.tmp'), JSON.stringify({ id: request.id, target: request.target, method: request.method, startedAt: Date.now() }), { mode: 0o600 })
    fs.renameSync(path.join(directory, 'active.tmp'), path.join(directory, 'active.json'))
    const result = await dispatch(request)
    publish({ id: request.id, ok: true, result: result ?? null })
  } catch (error) {
    publish({ id: request?.id, ok: false, error: { name: error.name, message: error.message, code: error.code, stack: error.stack } })
  } finally {
    busy = false
  }
  if (request?.target === 'control' && request.method === 'stop') clearInterval(timer)
}, 25)
