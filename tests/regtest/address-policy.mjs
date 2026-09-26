import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { WalletProcess, daemon, mine, prepareChain, prepareIssuer, rpc, until } from './harness.mjs'
import { REQUIRED_NATIVE_RUNTIME } from '../../src/native-runtime-contract.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wdk-rln-address-policy-'))
fs.chmodSync(root, 0o700)
const runtime = process.argv.includes('--bare') ? 'bare' : 'node'
const wallets = []
const results = { runtime, scope: 'strict signer, fresh regtest wallets, VSS disabled', steps: [] }
console.log(`Evidence: ${root}`)

async function step (name, operation) {
  try {
    const evidence = await operation()
    results.steps.push({ name, status: 'passed', evidence })
    console.log(`PASS ${name}`)
  } catch (error) {
    results.steps.push({ name, status: 'failed', error: error.message })
    throw error
  } finally {
    fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify(results, null, 2), { mode: 0o600 })
  }
}

function pendingScripts (wallet) {
  const dir = path.join(wallet.directory, 'wallet')
  const databases = fs.readdirSync(dir, { recursive: true }).filter(name => path.basename(name) === 'rgb_lib_db')
  assert.equal(databases.length, 1)
  const rows = JSON.parse(execFileSync('sqlite3', ['-readonly', '-json', path.join(dir, databases[0]), 'SELECT script FROM pending_witness_script'], { encoding: 'utf8' }))
  return rows.map(row => row.script)
}

async function assertIsolated (wallet, expectedMinimum) {
  const scripts = pendingScripts(wallet)
  assert.ok(scripts.length >= expectedMinimum)
  assert.equal(new Set(scripts).size, scripts.length)
  const outputs = (await wallet.call('listUnspents', [false])).filter(item => item.utxo.colorable && item.utxo.exists)
  assert.ok(outputs.length >= 3)
  for (const { utxo, pending_blinded: pendingBlinded } of outputs) {
    assert.ok(Number.isInteger(pendingBlinded) && pendingBlinded >= 0)
    const [txid, index] = utxo.outpoint.split(':')
    const transaction = await rpc('getrawtransaction', [txid, true])
    assert.ok(!scripts.includes(transaction.vout[Number(index)].scriptPubKey.hex), 'Setup output shares an unpaid witness invoice script')
  }
  return { pendingWitnessScripts: scripts.length, colorableOutputs: outputs.length }
}

try {
  await prepareChain()
  const fresh = new WalletProcess(root, 'non-reuse', runtime)
  wallets.push(fresh)
  await step('native provenance and non-reuse unlock', async () => {
    const info = await fresh.start(29581, 'TransactionSync', { reuseAddresses: false })
    for (const [key, value] of Object.entries(REQUIRED_NATIVE_RUNTIME)) assert.equal(info.runtime[key], value)
    assert.ok(info.runtime.capabilities.includes('pending-blinded-v1'))
    return info.runtime
  })
  const witnessInvoices = []
  const witness = async () => {
    const invoice = await fresh.call('createRgbInvoice', [{ witness: true, min_confirmations: 1, duration_seconds: 3600 }])
    witnessInvoices.push(invoice)
    return invoice
  }
  await step('fund new address, stable reads, invoice before setup', async () => {
    const address = await fresh.call('getNewAddress')
    assert.equal(await fresh.call('getAddress'), address)
    await rpc('sendtoaddress', [address, 0.03], 'miner')
    await mine()
    assert.equal((await fresh.call('getBalanceDetails', [false])).vanilla.settled, 3000000)
    await witness()
    await fresh.call('createUtxos', [{ up_to: false, num: 3, size: 100000, fee_rate: 2, skip_sync: false }])
    await mine()
    return assertIsolated(fresh, 1)
  })
  await step('witness invoices between and after funded setup calls stay isolated', async () => {
    await witness()
    await fresh.call('createUtxos', [{ up_to: false, num: 2, size: 100000, fee_rate: 2, skip_sync: false }])
    await mine()
    await witness()
    return assertIsolated(fresh, 3)
  })
  await step('native blinded reservations remain nonzero through WDK', async () => {
    await fresh.call('createRgbInvoice', [{ witness: false, min_confirmations: 1, duration_seconds: 3600 }])
    const outputs = await fresh.call('listUnspents', [false])
    const reservations = outputs.reduce((total, output) => total + output.pending_blinded, 0)
    assert.equal(reservations, 1)
    await fresh.call('createRgbInvoice', [{ witness: false, min_confirmations: 1, duration_seconds: 3600 }])
    const updated = await fresh.call('listUnspents', [false])
    assert.equal(updated.reduce((total, output) => total + output.pending_blinded, 0), 2)
    return { firstReservations: reservations, secondReservations: 2 }
  })
  await step('allocated BTC address and reservation counts survive process restart', async () => {
    const address = await fresh.call('getNewAddress')
    const before = (await fresh.call('getBalanceDetails', [false])).vanilla.settled
    await fresh.crashRestart()
    await rpc('sendtoaddress', [address, 0.001], 'miner')
    await mine()
    const after = (await fresh.call('getBalanceDetails', [false])).vanilla.settled
    assert.equal(after - before, 100000)
    const outputs = await fresh.call('listUnspents', [false])
    assert.equal(outputs.reduce((total, output) => total + output.pending_blinded, 0), 2)
    return { amountReceivedSats: after - before }
  })
  await step('pre-setup and interleaved witness invoices settle after restart', async () => {
    await prepareIssuer()
    assert.equal(witnessInvoices.length, 3)
    const settled = []
    for (const [index, invoice] of witnessInvoices.entries()) {
      const asset = (await daemon('issueassetnia', {
        ticker: `SETUP${index}`, name: `Setup isolation ${index}`, precision: 0, amounts: [100]
      })).asset
      const decoded = await fresh.call('decodeRgbInvoice', [invoice.invoice])
      assert.equal(decoded.asset_id, null)
      assert.equal(decoded.assignment.type, 'Any')
      const sent = await daemon('sendrgb', {
        donation: true, fee_rate: 2, min_confirmations: 1, skip_sync: false,
        recipient_map: {
          [asset.asset_id]: [{
            recipient_id: invoice.recipient_id,
            assignment: { type: 'Fungible', value: 100 },
            transport_endpoints: decoded.transport_endpoints,
            witness_data: { amount_sat: 1000 }
          }]
        }
      })
      await mine()
      await until(`interleaved witness ${index} settlement`, async () => {
        for (const response of [
          await fresh.call('refreshTransfers', [{ skip_sync: false }]),
          await daemon('refreshtransfers', { filter: [], skip_sync: false })
        ]) {
          for (const change of Object.values(response.transfers)) assert.equal(change.failure, null)
        }
        const transfers = await fresh.call('listTransfersByTxid', [sent.txid])
        return transfers.some(transfer => transfer.status === 'Settled')
      })
      assert.equal((await fresh.call('getAssetBalance', [asset.asset_id])).settled, 100)
      settled.push({ assetId: asset.asset_id, transactionId: sent.txid, received: 100 })
    }
    await fresh.crashRestart()
    for (const transfer of settled) {
      assert.equal((await fresh.call('getAssetBalance', [transfer.assetId])).settled, transfer.received)
    }
    return { invoicesSettled: settled.length, persistedAfterRestart: true }
  })
  const reuse = new WalletProcess(root, 'reuse', runtime)
  wallets.push(reuse)
  await step('legacy rotation reveals the address before restart and funded receipt', async () => {
    await reuse.start(29582)
    await reuse.call('rotateAddress')
    const address = await reuse.call('rotateAddress')
    await reuse.crashRestart()
    await rpc('sendtoaddress', [address, 0.001], 'miner')
    await mine()
    assert.equal((await reuse.call('getBalanceDetails', [false])).vanilla.settled, 100000)
    return { receivedSats: 100000 }
  })
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  for (const wallet of wallets) await wallet.stop()
}
