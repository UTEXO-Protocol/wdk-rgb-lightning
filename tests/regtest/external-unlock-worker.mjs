/* global Bare */
const bare = typeof Bare !== 'undefined'
const fs = (await import(bare ? 'bare-fs' : 'node:fs')).default
const path = (await import(bare ? 'bare-path' : 'node:path')).default
const args = bare ? Bare.argv : process.argv
const [directory, mode, scenario, endpoint] = args.slice(-4)
const { SdkNode, NativeExternalSigner } = (await import(bare ? '@utexo/rgb-lightning-node-bare' : '@utexo/rgb-lightning-node-nodejs')).default
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const rejects = (fn, pattern) => {
  try { fn() } catch (error) { assert(pattern.test(error.message), error.message); return }
  throw new Error('Expected rejection')
}
let node
let signer
let other
try {
  // Public fixture seeds. These wallets are never funded.
  signer = NativeExternalSigner.createWithStorage('01'.repeat(32), 'regtest', path.join(directory, 'signer'))
  node = SdkNode.create({
    storage_dir_path: path.join(directory, 'node'),
    network: 'regtest',
    daemon_listening_port: 0,
    ldk_peer_listening_port: 0,
    max_media_upload_size_mb: 5,
    enable_virtual_channels_v0: false,
    reuse_addresses: true
  })
  node.initWithNativeExternalSigner(signer)
  const request = {
    ldk_chain_sync: { mode: 'TransactionSync', config: { indexer_url: 'http://127.0.0.1:29302' } },
    indexer_url: 'tcp://127.0.0.1:29401',
    proxy_endpoint: 'rpc://127.0.0.1:29300/json-rpc',
    announce_addresses: []
  }
  const unlock = (value, source = signer) => {
    if (mode === 'attached') {
      node.attachNativeExternalSigner(source)
      node.unlockWithAttachedExternalSigner(value)
    } else node.unlockWithNativeExternalSigner(source, value)
  }
  const locked = () => rejects(() => node.btcBalance(true), /NotInitialized/)
  if (scenario === 'invalid') {
    for (const ethRpcUrl of ['', 'not a URL']) {
      rejects(() => unlock({ ...request, eth_rpc_url: ethRpcUrl }), /Ethereum RPC/)
      locked()
    }
  } else if (scenario === 'mismatch') {
    other = NativeExternalSigner.createWithStorage('02'.repeat(32), 'regtest', path.join(directory, 'other'))
    rejects(() => unlock({ ...request, eth_rpc_url: endpoint }, other), /does not match|Mismatch/)
    locked()
  } else {
    if (scenario === 'retry') {
      rejects(() => unlock({ ...request, eth_rpc_url: endpoint + '/reject' }), /fixture-rejected/)
      locked()
    }
    if (scenario !== 'omitted') request.eth_rpc_url = scenario === 'null' ? null : endpoint
    unlock(request)
    assert(node.nodeInfo().pubkey === signer.bootstrap().node_id, 'Wrong node identity')
    node.btcBalance(true)
    node.listAssets([])
  }
  node.shutdown()
  node = undefined
  signer.destroy()
  signer = undefined
  if (other) { other.destroy(); other = undefined }
  fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify({ mode, scenario, passed: true }))
} finally {
  if (node) node.shutdown()
  if (signer) signer.destroy()
  if (other) other.destroy()
}
