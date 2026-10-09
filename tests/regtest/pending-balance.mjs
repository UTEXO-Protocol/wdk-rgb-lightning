import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { WalletProcess, daemon, mine, prepareChain, prepareIssuer, rpc, until } from './harness.mjs'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wdk-rln-pending-balance-'))
fs.chmodSync(root, 0o700)
const runtime = process.argv.includes('--bare') ? 'bare' : 'node'
const wallet = new WalletProcess(root, 'receiver', runtime)
const results = { runtime, policy: 'strict', amount: 100000 }
console.log(`Evidence: ${root}; runtime=${runtime}; pending witness balance acceptance`)

try {
  await prepareChain()
  await prepareIssuer()
  await wallet.start(29506)
  await rpc('sendtoaddress', [await wallet.call('getAddress'), 1], 'miner')
  await mine()
  await wallet.call('createUtxos', [{ up_to: false, num: 3, size: 50000, fee_rate: 2, skip_sync: false }])
  await mine()
  const { asset } = await daemon('issueassetnia', {
    ticker: 'PENDING', name: 'Pending balance acceptance', precision: 6, amounts: [1000000]
  })
  results.assetId = asset.asset_id
  const invoice = await wallet.call('createRgbInvoice', [{
    witness: true, min_confirmations: 3, assignment_kind: 'Fungible', assignment_amount: results.amount
  }])
  const decoded = await wallet.call('decodeRgbInvoice', [invoice.invoice])
  const { txid } = await daemon('sendrgb', {
    donation: true,
    fee_rate: 2,
    min_confirmations: 3,
    skip_sync: false,
    recipient_map: {
      [asset.asset_id]: [{
        recipient_id: invoice.recipient_id,
        assignment: { type: 'Fungible', value: results.amount },
        transport_endpoints: decoded.transport_endpoints,
        witness_data: { amount_sat: 1000 }
      }]
    }
  })
  results.txid = txid
  await until('unconfirmed witness accepted', async () => {
    await wallet.call('refreshTransfers', [{ skip_sync: false }])
    return (await wallet.call('listTransfers', [asset.asset_id, txid])).some(item => item.status === 'WaitingConfirmations')
  })
  assert.ok((await rpc('getrawmempool')).includes(txid), 'The pending sample must be unconfirmed')
  results.pending = {
    wdk: await wallet.call('getAssetBalance', [asset.asset_id]),
    native: await wallet.call('assetBalance', [asset.asset_id], 'native'),
    transfers: await wallet.call('listTransfers', [asset.asset_id, txid])
  }
  // Retain the settled comparison even when the earlier native projection is wrong.
  await mine()
  await until('witness settlement', async () => {
    await wallet.call('refreshTransfers', [{ skip_sync: false }])
    await daemon('refreshtransfers', { filter: [], skip_sync: false })
    return (await wallet.call('listTransfers', [asset.asset_id, txid])).some(item => item.status === 'Settled')
  })
  results.settled = {
    wdk: await wallet.call('getAssetBalance', [asset.asset_id]),
    native: await wallet.call('assetBalance', [asset.asset_id], 'native')
  }
  assert.deepEqual(results.pending.wdk, results.pending.native)
  assert.deepEqual(results.settled.wdk, results.settled.native)
  assert.equal(results.pending.native.settled, 0)
  assert.equal(results.pending.native.spendable, 0)
  assert.equal(results.settled.native.settled, results.amount)
  assert.equal(results.settled.native.future, results.amount)
  assert.equal(results.settled.native.spendable, results.amount)
  assert.equal(results.pending.native.future, results.amount, 'A single incoming amount must be counted exactly once')
  results.status = 'passed'
} catch (error) {
  results.status = 'failed'
  results.error = error.message
  console.error(error)
  process.exitCode = 1
} finally {
  try { await wallet.stop() } catch (error) {
    results.status = 'failed'
    results.shutdownError = error.message
    process.exitCode = 1
  }
  fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify(results, null, 2))
  console.log(`Retained evidence: ${root}`)
}
