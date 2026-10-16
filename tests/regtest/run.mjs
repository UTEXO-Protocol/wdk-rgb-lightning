import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash, randomBytes } from 'node:crypto'
import { WalletProcess, daemon, endpoints, mine, prepareChain, prepareIssuer, rpc, until } from './harness.mjs'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wdk-rln-regtest-'))
fs.chmodSync(root, 0o700)
const runtime = process.argv.includes('--bare') ? 'bare' : 'node'
const permissive = process.argv.includes('--diagnostic-permissive')
const policy = permissive ? 'permissive diagnostic (NOT production qualification)' : 'strict'
const results = []
const wallets = []
console.log(`Evidence: ${root}; runtime=${runtime}; ${policy} signer; VSS disabled`)
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
    fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify({ runtime, policy, results }, null, 2))
  }
}

try {
  await step('isolated regtest chain and indexed blocks', prepareChain)
  const alice = new WalletProcess(root, 'alice', runtime)
  wallets.push(alice)
  await step(`${policy} persistent signer unlock: TransactionSync with explicit RGB indexer`, () => alice.start(29501, 'TransactionSync', { permissiveSignerPolicy: permissive }))
  const bob = new WalletProcess(root, 'bob', runtime)
  wallets.push(bob)
  await step(`${policy} persistent signer unlock: BlockSync`, () => bob.start(29502, 'BlockSync', { permissiveSignerPolicy: permissive }))
  for (const [name, wallet] of [['alice', alice], ['bob', bob]]) {
    await step(`${name}: fund and reconcile BTC`, async () => {
      const address = await wallet.call('getAddress')
      assert.match(address, /^bcrt1/)
      assert.equal(await wallet.call('getAddress'), address)
      const txid = await rpc('sendtoaddress', [address, 1], 'miner')
      await mine()
      await wallet.call('sync')
      const balance = await wallet.call('btcBalance', [false], 'native')
      assert.equal(balance.vanilla.settled, 100000000)
      return { address, txid, balance }
    })
    await step(`${name}: create colorable UTXOs`, async () => {
      const response = await wallet.call('createUtxos', [{ up_to: false, num: 10, size: 500000, fee_rate: 2, skip_sync: false }])
      await mine()
      await wallet.call('sync')
      const unspents = await wallet.call('listUnspents', [false])
      assert.ok(unspents.filter(item => item.utxo.colorable && item.utxo.exists).length >= 10)
      return response
    })
  }

  await step('sign, verify, and reject mismatched message', async () => {
    const signature = await alice.call('sign', ['WDK local qualification'])
    assert.equal(await alice.call('verify', ['WDK local qualification', signature]), true)
    assert.equal(await alice.call('verify', ['different message', signature]), false)
  })
  await step('BTC send, indexed transaction and confirmed receipt', async () => {
    const address = await bob.call('getAddress')
    const before = await bob.call('getBalanceDetails')
    const sent = await alice.call('sendBtc', [{ address, amount: 10000, fee_rate: 2, skip_sync: false }])
    assert.match(sent.txid, /^[a-f0-9]{64}$/)
    assert.equal(await alice.call('getTransactionReceipt', [sent.txid]), null)
    await mine()
    await alice.call('sync')
    await bob.call('sync')
    const after = await bob.call('getBalanceDetails')
    assert.equal(after.vanilla.settled - before.vanilla.settled, 10000)
    assert.ok(await alice.call('getTransactionReceipt', [sent.txid]))
    return sent
  })
  await step('released external-signer issuance restriction is surfaced', async () => {
    await assert.rejects(alice.call('issueAssetNia', [{ ticker: 'TEST', name: 'Qualification asset', precision: 0, amounts: [1000000] }]), /UnsupportedInExternalSignerMode/)
    await assert.rejects(alice.call('issueAssetCfa', [{ name: 'Qualification CFA', precision: 0, amounts: [1000] }]), /UnsupportedInExternalSignerMode/)
    await assert.rejects(alice.call('issueAssetUda', [{ ticker: 'UNIQUE', name: 'Qualification UDA', precision: 0 }]), /UnsupportedInExternalSignerMode/)
    await assert.rejects(alice.call('issueAssetIfa', [{ ticker: 'INFL', name: 'Qualification IFA', precision: 0, amounts: [1000], inflation_amounts: [1000] }]), /UnsupportedInExternalSignerMode/)
  })
  await step('released daemon issuer initialized on isolated chain', prepareIssuer)
  const asset = await step('receive daemon-issued NIA and reconcile asset metadata/balance', async () => {
    const issued = (await daemon('issueassetnia', { ticker: 'TEST', name: 'Qualification asset', precision: 0, amounts: [1000000] })).asset
    assert.ok(issued.asset_id)
    const receive = await alice.call('createRgbInvoice', [{ min_confirmations: 1, witness: false }])
    const sent = await daemon('sendrgb', { donation: true, fee_rate: 2, min_confirmations: 1, skip_sync: false, recipient_map: { [issued.asset_id]: [{ recipient_id: receive.recipient_id, assignment: { type: 'Fungible', value: 1000000 }, transport_endpoints: [endpoints.proxy] }] } })
    await mine()
    await until('initial RGB funding settled', async () => {
      await alice.call('refreshTransfers', [{ skip_sync: false }])
      await daemon('refreshtransfers', { filter: [], skip_sync: false })
      const transfers = await alice.call('listTransfersByTxid', [sent.txid])
      return transfers.some(item => item.status === 'Settled')
    })
    const balance = await alice.call('getAssetBalance', [issued.asset_id])
    assert.equal(balance.settled, 1000000)
    const metadata = await alice.call('getAssetMetadata', [issued.asset_id])
    assert.equal(metadata.name, 'Qualification asset')
    return issued
  })
  await step('released external-signer inflation restriction is surfaced', async () => {
    await assert.rejects(alice.call('inflate', [{ asset_id: asset.asset_id, inflation_amounts: [1], fee_rate: 2, min_confirmations: 1 }]), /UnsupportedInExternalSignerMode/)
  })
  await step('cancel an unpaid RGB receive and retain its failed status', async () => {
    const receive = await alice.call('createRgbInvoice', [{ asset_id: asset.asset_id, min_confirmations: 1, witness: false, duration_seconds: 1 }])
    await until('invoice expiry', () => Date.now() > (receive.expiration_timestamp + 1) * 1000)
    const result = await alice.call('failTransfers', [{ batch_transfer_idx: receive.batch_transfer_idx, no_asset_only: false, skip_sync: false }])
    assert.equal(result.transfers_changed, true)
    const transfers = await alice.call('listTransfers', [asset.asset_id])
    assert.ok(transfers.some(item => item.recipient_id === receive.recipient_id && item.status === 'Failed'))
  })
  for (const witness of [false, true]) {
    await step(`RGB ${witness ? 'witness' : 'blind'} transfer and two-sided settlement`, async () => {
      const amount = witness ? 250 : 1000
      const receive = await bob.call('createRgbInvoice', [{ min_confirmations: 1, witness, assignment_kind: 'Fungible', assignment_amount: amount, duration_seconds: 600 }])
      const decoded = await alice.call('decodeRgbInvoice', [receive.invoice])
      assert.equal(decoded.recipient_type, witness ? 'Witness' : 'Blind')
      assert.deepEqual(decoded.assignment, { type: 'Fungible', value: amount })
      assert.ok(decoded.transport_endpoints.length)
      if (witness) assert.ok(decoded.transport_endpoints.some(url => url.includes('rid_nonce=')))
      const sent = await alice.call('sendRgbAsset', [{ donation: false, fee_rate: 2, min_confirmations: 1, recipient_groups: [{ asset_id: asset.asset_id, recipients: [{ recipient_id: receive.recipient_id, assignment_kind: 'Fungible', assignment_amount: amount, transport_endpoints: decoded.transport_endpoints, ...(witness ? { witness_data: { amount_sat: 1000 } } : {}) }] }] }])
      const refresh = async () => {
        for (const wallet of [bob, alice]) {
          const result = await wallet.call('refreshTransfers', [{ skip_sync: false }])
          for (const change of Object.values(result.transfers)) assert.equal(change.failure, null)
        }
      }
      await until('RGB transaction broadcast', async () => {
        await refresh()
        return (await rpc('getrawmempool')).includes(sent.txid)
      })
      await mine()
      await until('both RGB transfers settled', async () => {
        await refresh()
        const outgoing = await alice.call('listTransfers', [asset.asset_id, sent.txid])
        const incoming = await bob.call('listTransfers', [asset.asset_id, sent.txid])
        return outgoing.some(item => item.status === 'Settled') && incoming.some(item => item.status === 'Settled')
      })
      const balance = await bob.call('getAssetBalance', [asset.asset_id])
      assert.equal(balance.settled, witness ? 1250 : 1000)
      return sent
    })
  }
  const open = async (assetId) => {
    const response = await alice.call('openChannel', [{ peer_pubkey_and_opt_addr: `${bob.pubkey}@127.0.0.1:29502`, capacity_sat: 1000000, push_msat: 0, public: false, with_anchors: true, ...(assetId ? { asset_id: assetId, asset_amount: 10000, push_asset_amount: 0 } : {}) }])
    await until('funding transaction broadcast', async () => {
      const channels = await alice.call('listChannels')
      const mempool = await rpc('getrawmempool')
      return channels.some(channel => channel.asset_id === (assetId ?? null) && mempool.includes(channel.funding_txid))
    })
    await mine(12)
    return await until('both channels usable', async () => {
      await alice.call('sync')
      await bob.call('sync')
      const channels = await alice.call('listChannels')
      const remote = await bob.call('listChannels')
      const channel = channels.find(item => item.asset_id === (assetId ?? null) && item.is_usable)
      if (!channel || !remote.some(item => item.channel_id === channel.channel_id && item.is_usable)) return false
      assert.ok(channel.funding_txid)
      return { ...channel, open_response: response }
    })
  }
  const btcChannel = await step(`${policy} signer: open confirmed standard BTC channel`, () => open())
  const payment = async (assetId) => {
    const invoice = await bob.call('createLightningInvoice', [{ amountMsat: 3000000, expirySec: 600, description: 'Qualification payment', ...(assetId ? { assetId, assetAmount: 25 } : {}) }])
    const decoded = await alice.call('decodeInvoice', [invoice.invoice])
    assert.equal(decoded.amt_msat, 3000000)
    if (assetId) assert.equal(decoded.asset_id, assetId)
    const sent = await alice.call('sendPayment', [{ invoice: invoice.invoice }])
    await until('payment succeeded on both sides', async () => {
      const out = await alice.call('listPayments')
      const incoming = await bob.call('listPayments')
      return out.some(item => item.payment_hash === decoded.payment_hash && item.status === 'Succeeded') && incoming.some(item => item.payment_hash === decoded.payment_hash && item.status === 'Succeeded')
    })
    assert.equal((await bob.call('getInvoiceStatus', [invoice.invoice])).status, 'Succeeded')
    return { payment_hash: decoded.payment_hash, sent }
  }
  await step('standard BTC Lightning payment and history', () => payment())
  await step('BTC keysend and terminal payment status', async () => {
    const sent = await alice.call('keysend', [{ dest_pubkey: bob.pubkey, amt_msat: 3000000 }])
    await until('keysend settled', async () => (await alice.call('getPayment', [sent.payment_hash, 'Outbound'])).status === 'Succeeded')
    return { payment_hash: sent.payment_hash }
  })
  for (const claim of [true, false]) {
    await step(`HODL ${claim ? 'claim' : 'cancel'} reaches terminal state`, async () => {
      const preimage = randomBytes(32).toString('hex')
      const hash = createHash('sha256').update(Buffer.from(preimage, 'hex')).digest('hex')
      const invoice = await bob.call('createHodlInvoice', [{ paymentHash: hash, amtMsat: 3000000, expirySec: 600 }])
      await alice.call('sendPayment', [{ invoice: invoice.bolt11 }])
      await until('HODL claimable', async () => (await bob.call('getInvoiceStatus', [invoice.bolt11])).status === 'Claimable')
      if (claim) await bob.call('claimHodlInvoice', [{ payment_hash: hash, payment_preimage: preimage }])
      else await bob.call('cancelHodlInvoice', [{ payment_hash: hash }])
      await until('HODL terminal', async () => (await bob.call('getInvoiceStatus', [invoice.bolt11])).status === (claim ? 'Succeeded' : 'Cancelled'))
      return { payment_hash: hash }
    })
  }
  const rgbChannel = await step(`${policy} signer: open confirmed standard RGB channel`, () => open(asset.asset_id))
  await step('RGB Lightning payment and two-sided history', () => payment(asset.asset_id))
  await step('whole-process crash and persistent channel recovery', async () => {
    const result = await alice.crashRestart()
    assert.equal(result.node.pubkey, alice.pubkey)
    assert.equal((await alice.call('listChannels')).length, 2)
    await alice.call('connectPeer', [`${bob.pubkey}@127.0.0.1:29502`])
    await until('channels usable after process death', async () => (await alice.call('listChannels')).filter(item => item.is_usable).length === 2)
  })
  await step('RGB payment after whole-process crash', () => payment(asset.asset_id))
  for (const channel of [btcChannel, rgbChannel]) {
    await step(`cooperative close ${channel.asset_id ? 'RGB' : 'BTC'} channel`, async () => {
      await alice.call('closeChannel', [{ channel_id: channel.channel_id, peer_pubkey: bob.pubkey, force: false }])
      await until('channel closed on both sides', async () => !(await alice.call('listChannels')).some(item => item.channel_id === channel.channel_id) && !(await bob.call('listChannels')).some(item => item.channel_id === channel.channel_id))
      await mine(12)
      await alice.call('sync')
      await bob.call('sync')
    })
  }
  await step('force-close BTC channel and confirm the funding spend', async () => {
    const channel = await open()
    await alice.call('closeChannel', [{ channel_id: channel.channel_id, peer_pubkey: bob.pubkey, force: true }])
    const closeTxid = await until('force-close transaction broadcast', async () => {
      for (const txid of await rpc('getrawmempool')) {
        const transaction = await rpc('getrawtransaction', [txid, true])
        if (transaction.vin.some(input => input.txid === channel.funding_txid)) return txid
      }
      return false
    })
    await mine(6)
    await until('force-closed channel removed', async () => {
      await alice.call('sync')
      await bob.call('sync')
      return !(await alice.call('listChannels')).some(item => item.channel_id === channel.channel_id)
    })
    assert.ok((await rpc('getrawtransaction', [closeTxid, true])).confirmations >= 6)
    return { close_txid: closeTxid, note: 'CSV sweep maturity is a separate test, not asserted here' }
  })
  await step('same-process clean reopen after closing channels', async () => {
    const result = await alice.call('reopen', [alice.config, alice.seed, alice.unlock], 'control')
    assert.equal(result.node.pubkey, alice.pubkey)
    assert.equal(result.channels.length, 0)
  })
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  for (const wallet of wallets.reverse()) {
    try { await step(`shutdown ${path.basename(wallet.directory)}`, () => wallet.stop()) } catch (error) {
      console.error(error)
      process.exitCode = 1
    }
  }
  console.log(`Retained test results and native logs: ${root}`)
}
