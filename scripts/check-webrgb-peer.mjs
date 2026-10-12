import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import { WebRgbProvider, WEBRGB_READ_METHODS } from '../src/webrgb.js'

// Accept a separately installed peer to check multiple versions without
// replacing the development baseline or adding a transport dependency.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const peerRoot = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.dirname(fileURLToPath(import.meta.resolve('@utexo/webrgb/package.json')))
const pkg = JSON.parse(readFileSync(path.join(peerRoot, 'package.json'), 'utf8'))
assert.equal(pkg.name, '@utexo/webrgb')
const config = ts.readConfigFile(path.join(root, 'tsconfig.types.json'), ts.sys.readFile)
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root)
const program = ts.createProgram(parsed.fileNames, {
  ...parsed.options,
  paths: { '@utexo/webrgb': [path.join(peerRoot, 'index.d.ts')] }
})
const errors = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)]
if (errors.length) {
  throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, {
    getCanonicalFileName: value => value,
    getCurrentDirectory: () => root,
    getNewLine: () => '\n'
  }))
}

const peer = await import(pathToFileURL(path.join(peerRoot, 'index.js')))
const wallet = {
  getNetwork: () => 'mainnet',
  isDisposed: () => false,
  getAddress: async () => 'bc1test',
  createRgbInvoice: async () => ({}),
  listAssets: async () => ({ bfa: [{ asset_id: 'rgb:test', name: 'Test', precision: 6 }] }),
  getAssetBalance: async () => ({ spendable: 10 }),
  listTransfers: async () => [],
  refreshTransfers: async () => ({ transfers: {} }),
  decodeRgbInvoice: async () => ({})
}
const provider = new WebRgbProvider(wallet, { origin: 'https://example.com', confirm: async () => true })
await assert.rejects(provider.getAddress(), error => peer.providerErrorCode(error) === 'NOT_ENABLED')
await provider.enable()
const info = await provider.getInfo()
assert.deepEqual(info.methods, [...WEBRGB_READ_METHODS])
for (const method of WEBRGB_READ_METHODS) assert.equal(peer.supports(info, method), true)
assert.equal(peer.supports(info, 'burnAsset'), false)
assert.deepEqual(await provider.getAddress(), { address: 'bc1test' })
assert.equal(peer.toAssetArray(await provider.listAssets())[0].id, 'rgb:test')
assert.deepEqual(peer.toTransferArray(await provider.listTransfers('rgb:test')), [])
assert.deepEqual(await provider.getAssetBalance('rgb:test'), {
  assetId: 'rgb:test', balance: 10, raw: { spendable: 10 }
})
provider.revoke()
await assert.rejects(provider.getAddress(), error => peer.providerErrorCode(error) === 'NOT_ENABLED')
console.log(`WebRGB ${pkg.version}: strict declarations and unchanged read-subset compatibility passed`)
