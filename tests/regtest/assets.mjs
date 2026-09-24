import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { WalletProcess, daemon, mine, prepareChain, prepareIssuer, rpc, until } from './harness.mjs'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wdk-rln-assets-'))
fs.chmodSync(root, 0o700)
const runtime = process.argv.includes('--bare') ? 'bare' : 'node'
const results = []
const wallets = []
console.log(`Evidence: ${root}; runtime=${runtime}; strict signer; VSS disabled`)

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
    fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify({ runtime, policy: 'strict', results }, null, 2))
  }
}

try {
  await step('isolated regtest chain', prepareChain)
  await step('released daemon issuer', prepareIssuer)
  for (const [name, port] of [['alice', 29503], ['bob', 29504]]) {
    const wallet = new WalletProcess(root, name, runtime)
    wallets.push(wallet)
    await step(`${name}: strict signer, funding and UTXOs`, async () => {
      await wallet.start(port)
      await rpc('sendtoaddress', [await wallet.call('getAddress'), 1], 'miner')
      await mine()
      await wallet.call('createUtxos', [{ up_to: false, num: 10, size: 500000, fee_rate: 2, skip_sync: false }])
      await mine()
    })
  }
  const [alice, bob] = wallets
  const schemas = [
    ['nia', { ticker: 'TESTNIA', name: 'Qualification NIA', precision: 0, amounts: [1000] }],
    ['ifa', { ticker: 'TESTIFA', name: 'Qualification IFA', precision: 0, amounts: [1000], inflation_amounts: [1000] }],
    ['cfa', { name: 'Qualification CFA', precision: 0, amounts: [1000] }],
    ['uda', { ticker: 'TESTUDA', name: 'Qualification UDA', precision: 0, attachments_file_digests: [] }]
  ]
  for (const [schema, request] of schemas) {
    const unique = schema === 'uda'
    const kind = unique ? 'NonFungible' : 'Fungible'
    const amount = unique ? 1 : 1000
    const asset = await step(`${schema}: receive daemon-issued asset`, async () => {
      const issued = (await daemon(`issueasset${schema}`, request)).asset
      const receive = await alice.call('createRgbInvoice', [{ witness: false, min_confirmations: 1 }])
      const decoded = await alice.call('decodeRgbInvoice', [receive.invoice])
      const assignment = unique ? { type: kind } : { type: kind, value: amount }
      const sent = await daemon('sendrgb', { donation: true, fee_rate: 2, min_confirmations: 1, skip_sync: false, recipient_map: { [issued.asset_id]: [{ recipient_id: receive.recipient_id, assignment, transport_endpoints: decoded.transport_endpoints }] } })
      await mine()
      await until(`${schema} funding settled`, async () => {
        await alice.call('refreshTransfers', [{ skip_sync: false }])
        await daemon('refreshtransfers', { filter: [], skip_sync: false })
        return (await alice.call('getAssetBalance', [issued.asset_id])).settled === amount
      })
      assert.equal((await alice.call('getAssetMetadata', [issued.asset_id])).name, request.name)
      assert.ok((await alice.call('listTransfersByTxid', [sent.txid])).some(item => item.status === 'Settled'))
      return issued
    })
    await step(`${schema}: witness transfer with exact assignment and two-sided settlement`, async () => {
      // An unknown UDA requires an Any invoice; NonFungible invoices need a known UDA schema.
      const receive = await bob.call('createRgbInvoice', [{ witness: true, min_confirmations: 1, ...(unique ? {} : { assignment_kind: kind, assignment_amount: 25 }) }])
      const decoded = await alice.call('decodeRgbInvoice', [receive.invoice])
      assert.equal(decoded.assignment.type, unique ? 'Any' : kind)
      if (!unique) assert.equal(decoded.assignment.value, 25)
      assert.ok(decoded.transport_endpoints.some(url => url.includes('rid_nonce=')))
      const sent = await alice.call('sendRgbAsset', [{ donation: false, fee_rate: 2, min_confirmations: 1, recipient_groups: [{ asset_id: asset.asset_id, recipients: [{ recipient_id: receive.recipient_id, assignment_kind: kind, ...(unique ? {} : { assignment_amount: 25 }), transport_endpoints: decoded.transport_endpoints, witness_data: { amount_sat: 1000 } }] }] }])
      const refresh = async () => {
        for (const wallet of [bob, alice]) {
          const changes = await wallet.call('refreshTransfers', [{ skip_sync: false }])
          for (const change of Object.values(changes.transfers)) assert.equal(change.failure, null)
        }
      }
      await until(`${schema} transfer broadcast`, async () => {
        await refresh()
        return (await rpc('getrawmempool')).includes(sent.txid)
      })
      await mine()
      await until(`${schema} settled on both sides`, async () => {
        await refresh()
        const outgoing = await alice.call('listTransfers', [asset.asset_id, sent.txid])
        const incoming = await bob.call('listTransfers', [asset.asset_id, sent.txid])
        return outgoing.some(item => item.status === 'Settled') && incoming.some(item => item.status === 'Settled')
      })
      assert.equal((await bob.call('getAssetBalance', [asset.asset_id])).settled, unique ? 1 : 25)
      assert.equal((await alice.call('getAssetBalance', [asset.asset_id])).settled, unique ? 0 : 975)
      return sent
    })
  }
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
  console.log(`Retained evidence: ${root}`)
}
