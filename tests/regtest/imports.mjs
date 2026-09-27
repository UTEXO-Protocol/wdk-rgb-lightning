import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { WalletProcess, daemon, mine, prepareChain, rpc, until } from './harness.mjs'

// Public, regtest-only IFA fixture. The existing daemon must own at least 250000 units.
assert.ok(process.env.RGB_IMPORT_FIXTURE, 'RGB_IMPORT_FIXTURE must name a public regtest contract JSON file')
const fixture = JSON.parse(fs.readFileSync(process.env.RGB_IMPORT_FIXTURE, 'utf8'))
assert.equal(fixture.network, 'regtest')
assert.equal(fixture.schema, 'Ifa')
assert.equal(fixture.precision, 6)
assert.equal(typeof fixture.asset_id, 'string')
assert.equal(typeof fixture.contract_base64, 'string')
const runtime = process.argv.includes('--bare') ? 'bare' : 'node'
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wdk-rln-imports-'))
fs.chmodSync(root, 0o700)
const wallets = []
const results = []
console.log(`Evidence: ${root}; runtime=${runtime}; strict signer; regtest IFA fixture only`)

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
    fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify({ runtime, assetId: fixture.asset_id, results }, null, 2))
  }
}

const request = { expected_asset_id: fixture.asset_id, contract_base64: fixture.contract_base64 }
try {
  await step('isolated regtest chain', prepareChain)
  for (const [name, port] of [['alice', 29523], ['bob', 29524]]) {
    const wallet = new WalletProcess(root, name, runtime)
    wallets.push(wallet)
    await step(`${name}: fresh contract import before funding`, async () => {
      const started = await wallet.start(port)
      assert.equal(started.runtime.import_commit, '5d5aa742984d52767e1055fed6aa154ad732d551')
      const imported = await wallet.call('importRgbContract', [request])
      assert.equal(imported.asset_id, fixture.asset_id)
      assert.equal(imported.already_imported, false)
      assert.equal(imported.metadata.asset_schema, 'Ifa')
      assert.equal(imported.metadata.precision, 6)
      const balance = await wallet.call('getAssetBalance', [fixture.asset_id])
      for (const field of ['settled', 'future', 'spendable', 'offchain_outbound', 'offchain_inbound']) assert.equal(balance[field], 0)
      assert.equal((await wallet.call('importRgbContract', [request])).already_imported, true)
      return { imported, balance }
    })
    await step(`${name}: malformed imports fail without changing balance`, async () => {
      for (const contractBase64 of ['YR==', 'not-base64', 'YQ==\n']) {
        await assert.rejects(wallet.call('importRgbContract', [{ ...request, contract_base64: contractBase64 }]))
      }
      await assert.rejects(wallet.call('importRgbTransferConsignment', [{ consignment_base64: 'not-base64', offchain_txid: '0'.repeat(64), expected_asset_id: fixture.asset_id }]))
      assert.equal((await wallet.call('getAssetBalance', [fixture.asset_id])).spendable, 0)
    })
    await step(`${name}: funding and native receive UTXOs`, async () => {
      await rpc('sendtoaddress', [await wallet.call('getAddress'), 0.02], 'miner')
      await mine()
      await wallet.call('createUtxos', [{ up_to: false, num: 5, size: 50000, fee_rate: 2, skip_sync: false }])
      await mine()
    })
  }
  const [alice, bob] = wallets
  await step('fresh imported asset: named invoice and real incoming settlement', async () => {
    const invoice = await alice.call('createRgbInvoice', [{ asset_id: fixture.asset_id, assignment_kind: 'Fungible', assignment_amount: 250000, min_confirmations: 1, witness: false }])
    const decoded = await alice.call('decodeRgbInvoice', [invoice.invoice])
    assert.equal(decoded.asset_id, fixture.asset_id)
    await daemon('sendrgb', { donation: true, fee_rate: 2, min_confirmations: 1, skip_sync: false, recipient_map: { [fixture.asset_id]: [{ recipient_id: invoice.recipient_id, assignment: { type: 'Fungible', value: 250000 }, transport_endpoints: decoded.transport_endpoints }] } })
    await mine()
    await until('imported contract receives real units', async () => {
      await alice.call('refreshTransfers', [{ skip_sync: false }])
      await daemon('refreshtransfers', { filter: [], skip_sync: false })
      return (await alice.call('getAssetBalance', [fixture.asset_id])).spendable === 250000
    })
  })
  await step('imported IFA: strict outgoing transfer and two-sided settlement', async () => {
    const invoice = await bob.call('createRgbInvoice', [{ asset_id: fixture.asset_id, assignment_kind: 'Fungible', assignment_amount: 100000, min_confirmations: 1, witness: true }])
    const decoded = await alice.call('decodeRgbInvoice', [invoice.invoice])
    const sent = await alice.call('sendRgbAsset', [{ donation: false, fee_rate: 2, min_confirmations: 1, recipient_groups: [{ asset_id: fixture.asset_id, recipients: [{ recipient_id: invoice.recipient_id, assignment_kind: 'Fungible', assignment_amount: 100000, transport_endpoints: decoded.transport_endpoints, witness_data: { amount_sat: 1000 } }] }] }])
    const refresh = async () => {
      for (const wallet of [bob, alice]) {
        const changes = await wallet.call('refreshTransfers', [{ skip_sync: false }])
        for (const change of Object.values(changes.transfers)) assert.equal(change.failure, null)
      }
    }
    await until('imported IFA send broadcast', async () => { await refresh(); return (await rpc('getrawmempool')).includes(sent.txid) })
    await mine()
    await until('imported IFA settled on both sides', async () => {
      await refresh()
      return (await alice.call('getAssetBalance', [fixture.asset_id])).spendable === 150000 &&
        (await bob.call('getAssetBalance', [fixture.asset_id])).spendable === 100000
    })
    for (const [wallet, expected] of [[alice, 150000], [bob, 100000]]) {
      assert.equal((await wallet.call('importRgbContract', [request])).already_imported, true)
      assert.equal((await wallet.call('getAssetBalance', [fixture.asset_id])).spendable, expected)
      assert.ok((await wallet.call('listTransfers', [fixture.asset_id, sent.txid])).some(item => item.status === 'Settled'))
    }
    return sent
  })
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  for (const wallet of wallets.reverse()) {
    try { await step(`shutdown ${path.basename(wallet.directory)}`, () => wallet.stop()) } catch (error) { console.error(error); process.exitCode = 1 }
  }
  console.log(`Retained evidence: ${root}`)
}
