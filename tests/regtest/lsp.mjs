import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { WalletProcess, daemon, here, mine, prepareChain, prepareIssuer, rpc, until } from './harness.mjs'
import { LspClient } from '../../src/lsp-client.js'

const runtime = process.argv.includes('--bare') ? 'bare' : 'node'
const permissive = process.argv.includes('--diagnostic-permissive')
const schema = process.argv.includes('--ifa') ? 'Ifa' : 'Nia'
const policy = permissive ? 'permissive diagnostic (NOT production qualification)' : 'strict'
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wdk-rln-lsp-'))
fs.chmodSync(root, 0o700)
const results = []
const wallets = []
const baseUrl = 'http://127.0.0.1:29380'
const http = new LspClient({ baseUrl })
console.log(`Evidence: ${root}; runtime=${runtime}; schema=${schema}; policy=${policy}; VSS disabled`)

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
    fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify({ runtime, schema, policy, results }, null, 2))
  }
}

try {
  await step('isolated regtest chain', prepareChain)
  execFileSync('docker', ['compose', '-f', path.join(here, 'compose.yaml'), 'up', '-d', '--no-deps', 'rln', 'peer-proxy-loopback'], { stdio: 'inherit' })
  await until('daemon HTTP startup', async () => {
    try { return !!(await fetch('http://127.0.0.1:29301/nodeinfo', { signal: AbortSignal.timeout(2000) })) } catch { return false }
  })
  await step('released fixture daemon unlocked', prepareIssuer)
  const asset = await step('LSP asset and colorable liquidity provisioned', async () => {
    await daemon('createutxos', { up_to: false, num: 10, size: 500000, fee_rate: 2, skip_sync: false })
    await mine()
    return (await daemon(schema === 'Ifa' ? 'issueassetifa' : 'issueassetnia', {
      ticker: 'LSPTEST',
      name: 'Local LSP asset',
      precision: 0,
      amounts: [100000, 100000, 100000, 100000],
      ...(schema === 'Ifa' ? { inflation_amounts: [100000] } : {})
    })).asset
  })
  execFileSync('docker', ['compose', '-f', path.join(here, 'compose.yaml'), 'up', '-d', '--no-deps', 'lsp'], {
    stdio: 'inherit', env: { ...process.env, REGTEST_ASSET_ID: asset.asset_id }
  })
  const info = await step('real LSP discovery and exact peer/asset validation', async () => {
    const value = await until('LSP startup', async () => {
      try { return await http.getInfo() } catch { return false }
    })
    assert.equal(value.network, 'regtest')
    assert.ok(value.supported_assets.some(item => item.asset_id === asset.asset_id && item.schema === schema))
    assert.equal(value.pubkey, (await daemon('nodeinfo', undefined, 'GET')).pubkey)
    return value
  })
  for (const [name, port] of [['alice', 29601], ['bob', 29602]]) {
    const wallet = new WalletProcess(root, name, runtime)
    wallets.push(wallet)
    await step(`${name}: signer, discovery, standard channel provisioning`, async () => {
      await wallet.start(port, 'BlockSync', { lspBaseUrl: baseUrl, lspBearerToken: 'disposable-local-apay-only', permissiveSignerPolicy: permissive })
      const address = await wallet.call('getAddress')
      await rpc('sendtoaddress', [address, 1], 'miner')
      await mine()
      await wallet.call('createUtxos', [{ up_to: false, num: 5, size: 500000, fee_rate: 2, skip_sync: false }])
      await mine()
      await wallet.call('lsp', [], 'control')
      await wallet.call('connect', [], 'lsp')
      await until('LSP provisions confirmed RGB channel', async () => {
        if ((await rpc('getrawmempool')).length) await mine(12)
        await wallet.call('sync')
        return (await wallet.call('listChannels')).some(channel => channel.asset_id === asset.asset_id && channel.is_usable)
      }, 120000)
      return await wallet.call('waitForChannel', [asset.asset_id, { timeoutMs: 3000, pollIntervalMs: 100 }], 'lsp')
    })
  }
  const [alice, bob] = wallets
  await step('LSP funds client outbound RGB liquidity', async () => {
    const invoice = await alice.call('createLightningInvoice', [{ amountMsat: 3000000, assetId: asset.asset_id, assetAmount: 1000, expirySec: 600 }])
    await daemon('sendpayment', { invoice: invoice.invoice })
    await until('LSP payment settled', async () => (await alice.call('getInvoiceStatus', [invoice.invoice])).status === 'Succeeded')
    await alice.call('waitForOutboundLiquidity', [3000000, { timeoutMs: 3000 }], 'lsp')
  })
  const address = await step('address-attested APay registration', () => bob.call('enableLightningAddress', [], 'lsp'))
  const verifiedQuote = await step('signed Lightning Address quote and inclusion proof verified locally', async () => {
    const options = { address: address.address, amtMsat: 3000000, asset: { assetId: asset.asset_id, assetAmount: 10 } }
    const quote = await alice.call('quoteAddress', [options], 'lsp')
    assert.ok(quote.proof)
    return quote
  })
  await step('APay payment and recipient claim settle on both sides', async () => {
    const quote = verifiedQuote
    const decoded = await alice.call('decodeInvoice', [quote.invoice])
    await alice.call('sendPayment', [{ invoice: quote.invoice }])
    await until('APay arrived and claimed', async () => {
      const claims = await bob.call('claimPendingPayments', [], 'lsp')
      for (const claim of claims) assert.equal(claim.claimed, true, claim.error)
      return (await alice.call('listPayments')).some(payment => payment.payment_hash === decoded.payment_hash && payment.status === 'Succeeded') &&
        (await bob.call('listPayments')).some(payment => payment.status === 'Succeeded' && payment.asset_id === asset.asset_id && payment.asset_amount === 10)
    }, 120000)
    return { payment_hash: decoded.payment_hash }
  })
  await step('verified Lightning-to-onchain bridge and independent RGB settlement', async () => {
    const invoice = await bob.call('createRgbInvoice', [{ asset_id: asset.asset_id, assignment_kind: 'Fungible', assignment_amount: 5, min_confirmations: 1, witness: false, duration_seconds: 600 }])
    const before = await bob.call('getAssetBalance', [asset.asset_id])
    const sent = await alice.call('sendAsset', [{ rgbInvoice: invoice.invoice, ln: { amtMsat: 3000000, assetId: asset.asset_id, assetAmount: 5, expirySec: 600 } }], 'lsp')
    await until('bridge RGB settled independently', async () => {
      await bob.call('refreshTransfers', [{ skip_sync: false }])
      if ((await rpc('getrawmempool')).length) await mine()
      const balance = await bob.call('getAssetBalance', [asset.asset_id])
      return balance.settled === before.settled + 5
    }, 120000)
    return { mapping_id: sent.mappingId }
  })
  await step('onchain-to-Lightning bridge and final invoice settlement', async () => {
    const request = await bob.call('receiveAsset', [{ assetId: asset.asset_id, amountSats: 3000, amountRgb: 5, expirySeconds: 600 }], 'lsp')
    const transfer = await bob.call('transfer', [{ recipient: request.rgbInvoice, amount: 5, token: asset.asset_id, feeRate: 2 }])
    await until('bridge consignment acknowledged and broadcast', async () => {
      await bob.call('refreshTransfers', [{ skip_sync: false }])
      return (await rpc('getrawmempool')).includes(transfer.hash)
    })
    await mine()
    assert.equal(await bob.call('awaitReceiveSettlement', [request.lnInvoice, { timeoutMs: 90000, pollIntervalMs: 500 }], 'lsp'), 'settled')
    return { mapping_id: request.mappingId }
  })
  assert.equal(info.virtual_channel_mode ?? '', '')
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
