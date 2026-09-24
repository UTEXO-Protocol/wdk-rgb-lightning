import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { WalletProcess, daemon, endpoints, here, mine, prepareChain, prepareIssuer, rpc, sleep, until } from './harness.mjs'

const runtime = process.argv.includes('--bare') ? 'bare' : 'node'
const permissive = process.argv.includes('--diagnostic-permissive')
const scenario = process.argv.find(arg => arg.startsWith('--scenario='))?.split('=')[1] ?? 'force-close'
const blockSync = process.argv.includes('--block-sync')
const rgb = process.argv.includes('--rgb')
assert.ok(['force-close', 'reorg', 'interrupted', 'hodl-crash', 'cold-copy'].includes(scenario))
assert.ok(!rgb || scenario === 'force-close', '--rgb is only supported for force-close')
const root = fs.mkdtempSync(path.join(os.tmpdir(), `wdk-rln-${scenario}-`))
fs.chmodSync(root, 0o700)
const results = []
const wallets = []
const policy = permissive ? 'permissive diagnostic (NOT production qualification)' : 'strict'
console.log(`Evidence: ${root}; ${runtime}; ${policy}; ${scenario}`)
async function step (name, fn) {
  const started = Date.now()
  try {
    const result = await fn()
    results.push({ name, status: 'passed', milliseconds: Date.now() - started, result })
    console.log(`PASS ${name}`)
    return result
  } catch (error) {
    results.push({ name, status: 'failed', milliseconds: Date.now() - started, error: error.message, remote: error.remote })
    throw error
  } finally {
    fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify({ runtime, policy, scenario, blockSync, rgb, results }, null, 2))
  }
}
async function balance (wallet) {
  await wallet.call('sync')
  return await wallet.call('btcBalance', [false], 'native')
}
async function indexed () {
  const hash = await rpc('getbestblockhash')
  await until('indexer follows exact canonical tip', async () => {
    const response = await fetch(`${endpoints.esplora}/blocks/tip/hash`, { signal: AbortSignal.timeout(5000) })
    return response.ok && (await response.text()) === hash
  })
}
async function transaction (txid) { return await rpc('getrawtransaction', [txid, true]) }

try {
  await step('assert regtest and indexed chain', prepareChain)
  const alice = new WalletProcess(root, 'alice', runtime)
  wallets.push(alice)
  await step(`${policy} persistent signer initialization`, () => alice.start(29511, blockSync ? 'BlockSync' : 'TransactionSync', { permissiveSignerPolicy: permissive }))
  const address = await alice.call('getAddress')
  await step('fund wallet and independently reconcile', async () => {
    const txid = await rpc('sendtoaddress', [address, 0.02], 'miner')
    await mine(6)
    assert.equal((await balance(alice)).vanilla.spendable, 2000000)
    return { txid, sats: 2000000 }
  })

  if (scenario === 'reorg') {
    const baseline = (await balance(alice)).vanilla
    let invalidated
    try {
      const txid = await step('confirm incoming payment before reorg', async () => {
        const txid = await rpc('sendtoaddress', [address, 0.00123], 'miner')
        await mine(1)
        invalidated = await rpc('getbestblockhash')
        assert.equal((await balance(alice)).vanilla.settled, baseline.settled + 123000)
        return txid
      })
      await step('longer competing fork removes settlement, retains unconfirmed payment', async () => {
        // A normal reorg exposes a longer competing branch, not a permanently
        // shortened node tip. Freeze fixture indexers while constructing it.
        execFileSync('docker', ['compose', '-f', path.join(here, 'compose.yaml'), 'pause', 'indexer', 'electrs'])
        try {
          await rpc('invalidateblock', [invalidated])
          const miner = await rpc('getnewaddress', [], 'miner')
          await rpc('generateblock', [miner, []])
          await rpc('generateblock', [miner, []])
        } finally {
          execFileSync('docker', ['compose', '-f', path.join(here, 'compose.yaml'), 'unpause', 'indexer', 'electrs'])
        }
        await indexed()
        assert.ok((await rpc('getrawmempool')).includes(txid))
        const current = await until('wallet reconciles disconnected payment', async () => {
          const value = (await balance(alice)).vanilla
          return value.settled === baseline.settled && value
        })
        assert.equal(current.settled, baseline.settled)
        assert.equal(current.future, baseline.future + 123000)
        return current
      })
      await step('process death while payment is unconfirmed preserves identity and balance', async () => {
        const restarted = await alice.crashRestart()
        assert.equal(restarted.node.pubkey, alice.pubkey)
        assert.equal((await balance(alice)).vanilla.future, baseline.future + 123000)
      })
      await step('replacement chain settles payment exactly once', async () => {
        if (blockSync) {
          await rpc('generatetoaddress', [2, await rpc('getnewaddress', [], 'miner')])
        } else await mine(2)
        const current = (await balance(alice)).vanilla
        assert.equal(current.settled, baseline.settled + 123000)
        assert.ok((await transaction(txid)).confirmations >= 2)
        return current
      })
    } finally {
      if (invalidated) {
        await rpc('reconsiderblock', [invalidated])
        if (!blockSync) await indexed()
      }
    }
  }

  if (scenario === 'interrupted') {
    for (const delay of [0, 20, 100]) {
      await step(`kill process during unacknowledged send (${delay}ms after dispatch), reconcile without retry`, async () => {
        const destination = await rpc('getnewaddress', [], 'miner')
        const receivedBefore = await rpc('getreceivedbyaddress', [destination, 0], 'miner')
        assert.equal(receivedBefore, 0)
        const before = (await balance(alice)).vanilla.spendable
        const sent = alice.call('sendBtc', [{ address: destination, amount: 10000, fee_rate: 2, skip_sync: false }]).then(value => ({ acknowledged: true, value }), error => ({ acknowledged: false, error: error.message }))
        const requestId = alice.sequence
        await until('worker entered requested send', () => {
          const file = path.join(alice.directory, 'active.json')
          if (!fs.existsSync(file)) return false
          const marker = JSON.parse(fs.readFileSync(file, 'utf8'))
          return marker.id === requestId && marker.method === 'sendBtc'
        }, 10000)
        await sleep(delay)
        alice.killGroup()
        await alice.exited
        const outcome = await sent
        const restart = await alice.crashRestart()
        assert.equal(restart.node.pubkey, alice.pubkey)
        await mine(6)
        const received = Math.round((await rpc('getreceivedbyaddress', [destination, 1], 'miner')) * 1e8)
        assert.ok(received === 0 || received === 10000, `unexpected recipient amount ${received}`)
        if (outcome.acknowledged) assert.equal(received, 10000)
        const after = (await balance(alice)).vanilla.spendable
        if (received === 0) assert.equal(after, before)
        else assert.ok(after <= before - 10000 && after > before - 20000)
        return { delay, outcome, received, before, after, boundary: 'process killed after dispatch marker, not an instrumented database commit boundary' }
      })
    }
  }

  if (scenario === 'cold-copy') {
    await step('cold copy the entire latest local wallet and signer state', async () => {
      alice.killGroup()
      await alice.exited
      const restored = path.join(root, 'restored-wallet')
      assert.equal(fs.existsSync(restored), false)
      // Native signer storage correctly rejects widened permissions. Node's
      // recursive cp recreates directories with default modes; preserve them.
      execFileSync('cp', ['-pR', alice.config.dataDir, restored])
      assert.equal(fs.statSync(path.join(restored, 'vls-signer')).mode & 0o777, 0o700)
      alice.config.dataDir = restored
      const restart = await alice.crashRestart()
      assert.equal(restart.node.pubkey, alice.pubkey)
      assert.equal(await alice.call('getAddress'), address)
      assert.equal((await balance(alice)).vanilla.spendable, 2000000)
      return { note: 'quiesced full local state copy, including signer; not seed-only, VSS, stale backup or migration recovery' }
    })
    await step('spend funds from the relocated complete state', async () => {
      const destination = await rpc('getnewaddress', [], 'miner')
      const sent = await alice.call('sendBtc', [{ address: destination, amount: 12000, fee_rate: 2, skip_sync: false }])
      await mine(6)
      assert.equal(Math.round((await rpc('getreceivedbyaddress', [destination, 1], 'miner')) * 1e8), 12000)
      return sent
    })
  }

  if (scenario === 'force-close' || scenario === 'hodl-crash') {
    const bob = new WalletProcess(root, 'bob', runtime)
    wallets.push(bob)
    await step('counterparty BlockSync persistent initialization', () => bob.start(29512, 'BlockSync', { permissiveSignerPolicy: permissive }))
    const asset = rgb
      ? await step('fund RGB channel with daemon-issued NIA', async () => {
        await prepareIssuer()
        for (const wallet of [alice, bob]) {
          await rpc('sendtoaddress', [await wallet.call('getAddress'), 0.1], 'miner')
        }
        await mine(6)
        for (const wallet of [alice, bob]) {
          await wallet.call('createUtxos', [{ up_to: false, num: 10, size: 500000, fee_rate: 2, skip_sync: false }])
        }
        await mine(6)
        const issued = (await daemon('issueassetnia', { ticker: 'RECOVER', name: 'Recovery qualification', precision: 0, amounts: [10000] })).asset
        const receive = await alice.call('createRgbInvoice', [{ witness: false, min_confirmations: 1 }])
        const decoded = await alice.call('decodeRgbInvoice', [receive.invoice])
        await daemon('sendrgb', { donation: true, fee_rate: 2, min_confirmations: 1, skip_sync: false, recipient_map: { [issued.asset_id]: [{ recipient_id: receive.recipient_id, assignment: { type: 'Fungible', value: 10000 }, transport_endpoints: decoded.transport_endpoints }] } })
        await mine(6)
        await until('RGB funding settles', async () => {
          await alice.call('refreshTransfers', [{ skip_sync: false }])
          await daemon('refreshtransfers', { filter: [], skip_sync: false })
          return (await alice.call('getAssetBalance', [issued.asset_id])).settled === 10000
        })
        return issued
      })
      : null
    const channel = await step(`open zero-push ${rgb ? 'RGB' : 'BTC'} channel and confirm`, async () => {
      await alice.call('openChannel', [{ peer_pubkey_and_opt_addr: `${bob.pubkey}@127.0.0.1:29512`, capacity_sat: 1000000, push_msat: 0, public: false, with_anchors: true, ...(asset ? { asset_id: asset.asset_id, asset_amount: 10000, push_asset_amount: 0 } : {}) }])
      await until('channel funding in mempool', async () => {
        const channels = await alice.call('listChannels')
        const mempool = await rpc('getrawmempool')
        return channels.some(c => c.funding_txid && mempool.includes(c.funding_txid))
      })
      await mine(12)
      return await until('both sides see usable channel', async () => {
        const channel = (await alice.call('listChannels')).find(c => c.is_usable)
        return channel && (await bob.call('listChannels')).some(c => c.channel_id === channel.channel_id && c.is_usable) && channel
      })
    })
    const baseline = (await balance(alice)).vanilla.spendable
    if (scenario === 'hodl-crash') {
      await step('claim an in-flight HODL payment after both processes die', async () => {
        const preimage = randomBytes(32).toString('hex')
        const hash = createHash('sha256').update(Buffer.from(preimage, 'hex')).digest('hex')
        const invoice = await bob.call('createHodlInvoice', [{ paymentHash: hash, amtMsat: 3000000, expirySec: 3600 }])
        await alice.call('sendPayment', [{ invoice: invoice.bolt11 }])
        await until('receiver durably reports claimable', async () => (await bob.call('getInvoiceStatus', [invoice.bolt11])).status === 'Claimable')
        const aliceRestart = await alice.crashRestart()
        const bobRestart = await bob.crashRestart()
        assert.equal(aliceRestart.node.pubkey, alice.pubkey)
        assert.equal(bobRestart.node.pubkey, bob.pubkey)
        await alice.call('connectPeer', [`${bob.pubkey}@127.0.0.1:29512`])
        await until('both channels restored', async () => (await alice.call('listChannels')).some(c => c.channel_id === channel.channel_id && c.is_usable) && (await bob.call('listChannels')).some(c => c.channel_id === channel.channel_id && c.is_usable))
        assert.equal((await bob.call('getInvoiceStatus', [invoice.bolt11])).status, 'Claimable')
        await bob.call('claimHodlInvoice', [{ payment_hash: hash, payment_preimage: preimage }])
        await until('both terminal histories reconcile', async () => (await bob.call('getInvoiceStatus', [invoice.bolt11])).status === 'Succeeded' && (await alice.call('getPayment', [hash, 'Outbound'])).status === 'Succeeded')
        const payments = await alice.call('listPayments')
        assert.equal(payments.filter(p => p.payment_hash === hash && p.status === 'Succeeded').length, 1)
        return { payment_hash: hash, channel_id: channel.channel_id }
      })
    } else {
      const close = await step('force-close and confirm commitment', async () => {
        await alice.call('closeChannel', [{ channel_id: channel.channel_id, peer_pubkey: bob.pubkey, force: true }])
        const close = await until('commitment spends funding transaction', async () => {
          for (const txid of await rpc('getrawmempool')) {
            const tx = await transaction(txid)
            if (tx.vin.some(input => input.txid === channel.funding_txid)) return tx
          }
          return false
        })
        await mine(1)
        return await transaction(close.txid)
      })
      const output = close.vout.reduce((largest, item) => item.value > largest.value ? item : largest)
      assert.ok(output.value > 0.009, 'expected local commitment principal, excluding tiny anchors')
      await step('pre-maturity output remains unspent', async () => {
        assert.ok(await rpc('gettxout', [close.txid, output.n, true]))
        assert.equal((await balance(alice)).vanilla.spendable, baseline)
      })
      await step('crash/restart with pending timelocked recovery', async () => {
        const restart = await alice.crashRestart()
        assert.equal(restart.node.pubkey, alice.pubkey)
      })
      const sweep = await step('CSV maturity produces a sweep of the exact commitment output', async () => {
      // Released channel default is 144. Advance beyond its spendable-event
      // threshold, leaving a bounded window for randomized sweeper broadcast.
        await mine(143)
        for (let round = 0; round < 8; round++) {
          await mine(12)
          await balance(alice)
          const height = await rpc('getblockcount')
          await until('LDK observed mature chain tip', async () => (await alice.call('getNetworkInfo')).height === height)
          await sleep(3000)
          const response = await fetch(`${endpoints.esplora}/tx/${close.txid}/outspend/${output.n}`, { signal: AbortSignal.timeout(10000) })
          assert.ok(response.ok)
          const spend = await response.json()
          if (spend.spent) return await transaction(spend.txid)
        }
        throw new Error(`No sweep observed for ${close.txid}:${output.n} after CSV maturity plus 96 blocks`)
      })
      await step('confirm recovered principal and spend it again', async () => {
        await mine(6)
        assert.ok((await transaction(sweep.txid)).confirmations >= 6)
        if (asset) {
          await until('all channel RGB units recovered on chain', async () => {
            await alice.call('refreshTransfers', [{ skip_sync: false }])
            return (await alice.call('getAssetBalance', [asset.asset_id])).spendable === 10000
          })
          const receive = await bob.call('createRgbInvoice', [{ witness: true, min_confirmations: 1, assignment_kind: 'Fungible', assignment_amount: 10000 }])
          const decoded = await alice.call('decodeRgbInvoice', [receive.invoice])
          const sent = await alice.call('sendRgbAsset', [{ donation: false, fee_rate: 2, min_confirmations: 1, recipient_groups: [{ asset_id: asset.asset_id, recipients: [{ recipient_id: receive.recipient_id, assignment_kind: 'Fungible', assignment_amount: 10000, transport_endpoints: decoded.transport_endpoints, witness_data: { amount_sat: 1000 } }] }] }])
          const refresh = async () => {
            for (const wallet of [bob, alice]) await wallet.call('refreshTransfers', [{ skip_sync: false }])
          }
          await until('recovered RGB transfer broadcast', async () => { await refresh(); return (await rpc('getrawmempool')).includes(sent.txid) })
          assert.ok((await transaction(sent.txid)).vin.some(input => input.txid === sweep.txid), 'RGB send must consume the observed sweep')
          await mine(6)
          await until('recovered RGB transfer settles on both sides', async () => {
            await refresh()
            return (await bob.call('getAssetBalance', [asset.asset_id])).settled === 10000 && (await alice.call('getAssetBalance', [asset.asset_id])).settled === 0
          })
          return { commitment: close.txid, commitment_vout: output.n, sweep: sweep.txid, spend: sent.txid, asset_id: asset.asset_id, amount: 10000 }
        }
        const recovered = await until('sweep reconciled to spendable wallet balance', async () => {
          const value = (await balance(alice)).vanilla.spendable
          return value > baseline + 900000 && value
        })
        const destination = await rpc('getnewaddress', [], 'miner')
        // Exceeds every pre-sweep spendable satoshi, so a confirmed send proves
        // actual recovered-fund availability, not just a displayed balance.
        const amount = baseline + 500000
        const sent = await alice.call('sendBtc', [{ address: destination, amount, fee_rate: 2, skip_sync: false }])
        const spend = await transaction(sent.txid)
        assert.ok(spend.vin.some(input => input.txid === sweep.txid), 'send must consume the observed sweep')
        await mine(6)
        assert.equal(Math.round((await rpc('getreceivedbyaddress', [destination, 1], 'miner')) * 1e8), amount)
        return { commitment: close.txid, commitment_vout: output.n, sweep: sweep.txid, recovered, spend: sent.txid, amount }
      })
    }
  }
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  for (const wallet of wallets.reverse()) {
    try { await step(`shutdown ${path.basename(wallet.directory)}`, () => wallet.stop()) } catch (error) { console.error(error); process.exitCode = 1 }
  }
  console.log(`Evidence retained: ${root}`)
}
