import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import { WalletProcess, mine, prepareChain, rpc, until } from './harness.mjs'

const binary = process.env.BFA_FIXTURE_BIN
const bridge = process.env.BFA_BRIDGE_ADDRESS
if (!binary || !/^0x[0-9a-fA-F]{40}$/.test(bridge ?? '')) {
  throw new Error('Set BFA_FIXTURE_BIN and BFA_BRIDGE_ADDRESS for the disposable local fixture')
}
assert.ok(fs.statSync(binary).isFile(), 'BFA_FIXTURE_BIN must be a built executable')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wdk-bfa-'))
fs.chmodSync(root, 0o700)
const runtime = process.argv.includes('--bare') ? 'bare' : 'node'
const results = []
const wallets = []
let sequence = 0
let pending
let issuerFailure
const issuer = spawn(binary, [path.join(root, 'issuer')], { stdio: ['pipe', 'pipe', 'pipe'] })
const issuerLog = fs.createWriteStream(path.join(root, 'issuer.log'), { mode: 0o600 })
issuer.stderr.pipe(issuerLog)
issuer.on('error', error => { issuerFailure = error; pending?.reject(error) })
issuer.on('exit', code => {
  issuerFailure = new Error(`Fixture exited ${code}`)
  pending?.reject(issuerFailure)
})
const issuerExited = new Promise(resolve => issuer.once('close', resolve))
createInterface({ input: issuer.stdout }).on('line', line => {
  if (!line.startsWith('fixture:')) { issuerLog.write(line + '\n'); return }
  const response = JSON.parse(line.slice(8))
  if (!pending || pending.id !== response.id) throw new Error('Unexpected fixture response')
  if (response.ok) pending.resolve(response.result)
  else pending.reject(new Error(response.error))
})

async function fixture (method, args = {}) {
  if (issuerFailure) throw issuerFailure
  assert.equal(pending, undefined)
  const id = ++sequence
  let timer
  try {
    return await new Promise((resolve, reject) => {
      pending = { id, resolve, reject }
      timer = setTimeout(() => reject(new Error(`Fixture timeout: ${method}`)), 120000)
      issuer.stdin.write(JSON.stringify({ id, method, ...args }) + '\n')
    })
  } finally { clearTimeout(timer); pending = undefined }
}

async function step (name, fn) {
  try {
    const result = await fn()
    results.push({ name, status: 'passed', result })
    console.log(`PASS ${name}`)
    return result
  } catch (error) {
    results.push({ name, status: 'failed', error: error.message })
    throw error
  } finally {
    fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify({ runtime, bridge, results }, null, 2))
  }
}

// Anvil's documented public test key, never a real wallet key.
function lock (amount, opid) {
  return execFileSync('docker', ['exec', process.env.BFA_ANVIL_CONTAINER || 'wdk-bfa-anvil-20261007',
    'cast', 'send', bridge, 'fundsIn(uint256,uint256)', String(amount), `0x${opid}`,
    '--rpc-url', 'http://127.0.0.1:8545', '--private-key',
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', '--json'],
  { encoding: 'utf8', timeout: 60000 })
}

console.log(`Evidence: ${root}; runtime=${runtime}; strict signer; local BFA bridge`)
try {
  await step('isolated regtest chain and funded BFA issuer', async () => {
    await prepareChain()
    const chain = await fetch('http://127.0.0.1:29545', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      signal: AbortSignal.timeout(5000)
    }).then(response => response.json())
    assert.equal(chain.result, '0x7a69', 'Only the disposable Anvil chain is allowed')
    await rpc('sendtoaddress', [await fixture('address'), 1], 'miner')
    await mine()
    await fixture('online')
    await fixture('utxos')
    await mine()
  })
  for (const [name, port] of [['alice', 29561], ['bob', 29562]]) {
    const wallet = new WalletProcess(root, name, runtime)
    wallets.push(wallet)
    await step(`${name}: Ethereum RPC unlock, strict signer and funding`, async () => {
      const info = await wallet.start(port, 'TransactionSync', {}, { eth_rpc_url: 'http://127.0.0.1:29545' })
      assert.ok(info.runtime.capabilities.includes('external-signer-eth-rpc-v1'))
      assert.deepEqual(await wallet.call('getBfaCapabilities'), { bfa: true, burn: false, consignment: true })
      await rpc('sendtoaddress', [await wallet.call('getAddress'), 1], 'miner')
      await mine()
      await wallet.call('createUtxos', [{ up_to: false, num: 10, size: 100000, fee_rate: 2, skip_sync: false }])
      await mine()
      await wallet.call('webrgb', [], 'control')
    })
  }
  const [alice, bob] = wallets
  const asset = await fixture('issue', { contract: bridge })
  assert.equal(asset.initial_supply, 0)
  const receive = await alice.call('createRgbInvoice', [{ witness: false, min_confirmations: 1 }])
  const decoded = await alice.call('decodeRgbInvoice', [receive.invoice])
  const begin = await fixture('begin', {
    asset_id: asset.asset_id,
    recipient: {
      assignment: { Fungible: 1000 },
      recipient_id: receive.recipient_id,
      witness_data: null,
      transport_endpoints: decoded.transport_endpoints
    }
  })
  await step('real FundsIn event, blind receive and BFA balance', async () => {
    assert.match(begin.details.opid, /^[0-9a-f]{64}$/)
    const receipt = JSON.parse(lock(1000, begin.details.opid))
    assert.ok(['0x1', '0x01', 1].includes(receipt.status))
    const minted = await fixture('end', { psbt: begin.psbt })
    await until('BFA mint broadcast', async () => {
      await alice.call('refreshTransfers', [{ skip_sync: false }])
      await fixture('refresh')
      return (await rpc('getrawmempool')).includes(minted.txid)
    })
    await mine()
    await until('BFA mint settled', async () => {
      await alice.call('refreshTransfers', [{ skip_sync: false }])
      return (await alice.call('getAssetBalance', [asset.asset_id])).settled === 1000
    })
    assert.equal((await alice.call('getAssetMetadata', [asset.asset_id])).name, 'Qualification BFA')
    assert.ok((await alice.call('listAssets', [], 'webrgb')).some(item => item.id === asset.asset_id && item.schema === 'bfa'))
    assert.equal((await alice.call('getAssetBalance', [asset.asset_id], 'webrgb')).balance, 1000)
    return { asset_id: asset.asset_id, txid: minted.txid, ethereumTxid: receipt.transactionHash }
  })
  await step('BFA witness send, both balances, history and exact consignment bytes', async () => {
    const invoice = await bob.call('createRgbInvoice', [{ witness: true, min_confirmations: 1, assignment_kind: 'Fungible', assignment_amount: 25 }])
    const data = await alice.call('decodeRgbInvoice', [invoice.invoice])
    const sent = await alice.call('sendRgbAsset', [{
      donation: false,
      fee_rate: 2,
      min_confirmations: 1,
      recipient_groups: [{
        asset_id: asset.asset_id,
        recipients: [{
          recipient_id: invoice.recipient_id,
          assignment_kind: 'Fungible',
          assignment_amount: 25,
          transport_endpoints: data.transport_endpoints,
          witness_data: { amount_sat: 1000 }
        }]
      }]
    }])
    const refresh = async () => {
      for (const wallet of [bob, alice]) await wallet.call('refreshTransfers', [{ skip_sync: false }])
    }
    await until('BFA send broadcast', async () => { await refresh(); return (await rpc('getrawmempool')).includes(sent.txid) })
    await mine()
    await until('BFA send settled on both sides', async () => {
      await refresh()
      return (await bob.call('getAssetBalance', [asset.asset_id])).settled === 25 &&
        (await alice.call('getAssetBalance', [asset.asset_id])).settled === 975
    })
    for (const wallet of wallets) assert.ok((await wallet.call('listTransfers', [asset.asset_id, sent.txid])).some(item => item.status === 'Settled'))
    const exported = await alice.call('getConsignment', [asset.asset_id, sent.txid])
    const raw = await alice.call('getConsignment', [asset.asset_id, sent.txid], 'native')
    const location = await alice.call('getConsignmentPath', [asset.asset_id, sent.txid], 'native')
    assert.equal(exported.bytes_hex, raw.bytes_hex)
    assert.equal(raw.bytes_hex, fs.readFileSync(location.path).toString('hex'))
    return sent
  })
  await step('BFA balances survive cold process restart', async () => {
    for (const [wallet, amount] of [[alice, 975], [bob, 25]]) {
      await wallet.crashRestart()
      assert.equal((await wallet.call('getAssetBalance', [asset.asset_id])).settled, amount)
      await wallet.call('refreshTransfers', [{ skip_sync: false }])
      assert.equal((await wallet.call('getAssetBalance', [asset.asset_id])).spendable, amount)
    }
  })
  const cases = [
    ['no matching lock is rejected', [], false],
    ['only wrong-amount locks are rejected', [1, 999, 1001], false]
  ]
  if (process.argv.includes('--probe-event-selection')) {
    cases.push(['matching lock after an earlier wrong-amount lock settles', [1, 1000], true])
  }
  for (const [name, locks, valid] of cases) {
    await step(name, async () => {
      const issued = await fixture('issue', { contract: bridge })
      const invoice = await alice.call('createRgbInvoice', [{ witness: false, min_confirmations: 1 }])
      const data = await alice.call('decodeRgbInvoice', [invoice.invoice])
      const prepared = await fixture('begin', {
        asset_id: issued.asset_id,
        recipient: { assignment: { Fungible: 1000 }, recipient_id: invoice.recipient_id, witness_data: null, transport_endpoints: data.transport_endpoints }
      })
      for (const amount of locks) {
        assert.ok(['0x1', '0x01', 1].includes(JSON.parse(lock(amount, prepared.details.opid)).status))
      }
      const sent = await fixture('end', { psbt: prepared.psbt })
      await mine()
      const transfer = await until(`terminal BFA validation: ${name}`, async () => {
        const changes = await alice.call('refreshTransfers', [{ skip_sync: false }])
        const status = changes.transfers[invoice.batch_transfer_idx]?.updated_status
        return ['Settled', 'Failed'].includes(status) && { status }
      })
      fs.writeFileSync(path.join(root, `validation-${issued.asset_id.replaceAll(/[^a-zA-Z0-9]/g, '_')}.json`),
        JSON.stringify({ asset_id: issued.asset_id, txid: sent.txid, opid: prepared.details.opid, locks, actualStatus: transfer.status, expectedStatus: valid ? 'Settled' : 'Failed' }, null, 2))
      assert.equal(transfer.status, valid ? 'Settled' : 'Failed')
      const assets = await alice.call('listAssets')
      const receivedAsset = assets.bfa.find(item => item.asset_id === issued.asset_id)
      if (valid) assert.ok(receivedAsset)
      assert.equal(receivedAsset?.balance.settled ?? 0, valid ? 1000 : 0)
      return { asset_id: issued.asset_id, txid: sent.txid, status: transfer.status, locks }
    })
  }
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  for (const wallet of wallets.reverse()) {
    try { await step(`shutdown ${path.basename(wallet.directory)}`, () => wallet.stop()) } catch (error) { console.error(error); process.exitCode = 1 }
  }
  issuer.stdin.end()
  const timeout = setTimeout(() => issuer.kill('SIGKILL'), 10000)
  await issuerExited
  clearTimeout(timeout)
  issuerLog.end()
  console.log(`Retained evidence: ${root}`)
}
