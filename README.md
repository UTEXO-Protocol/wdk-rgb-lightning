# @utexo/wdk-rgb-lightning

[![Built with WDK](./assets/built-with-wdk.png)](https://github.com/tetherto/wdk)

WDK module for RGB-over-Lightning, built on
[`rgb-lightning-node`][rgb-lightning-node] (RLN). It runs a full LDK +
`rgb-lib` Lightning node behind WDK's wallet-manager/account contract and
adds channels, BOLT11 + RGB invoices, payments, HODL invoices, atomic
swaps, async payments (APay), optional VSS cloud backup, and a complete LSP
client for the UTEXO Lightning Service Provider.

The node runs in **external-signer** mode: the BIP-39 mnemonic stays in the
WDK secret manager, and all channel-state cryptography happens in-process
through a VLS signer. RLN's on-disk state holds only public identifying
material.

Complements [`@utexo/wdk-wallet-rgb`][wdk-wallet-rgb], the on-chain RGB
wallet module. The two are independent: each owns its own `rgb-lib` SQLite
state, keyed by its own wallet fingerprint, and they do **not** share asset
records. Give each module a **separate** `dataDir` — `rgb-lib` takes an
exclusive lock on a wallet directory, and the Lightning node derives a
different wallet fingerprint (it signs in-process via VLS from a 32-byte
entropy) than the on-chain module (standard BIP-32 from the full seed), so
even a shared `dataDir` resolves to different `<fingerprint>/` subfolders.
RLN holds and transfers RGB assets for its channels and invoices. For RGB
asset **issuance**, prefer [`@utexo/wdk-wallet-rgb`][wdk-wallet-rgb], the
on-chain RGB wallet module. The node-level issuance calls are also forwarded
on the account (see the Account API table), but `wdk-wallet-rgb` is the
supported path for issuance flows.

> Status: pre-1.0 beta (`0.1.0-beta` line).

## Contents

- [Architecture](#architecture)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Account API](#account-api)
- [Error handling](#error-handling)
- [LSP integration](#lsp-integration)
- [VSS cloud backup](#vss-cloud-backup)
- [Async payments (APay)](#async-payments-apay)
- [Security model](#security-model)
- [Testing and local development](#testing-and-local-development)
- [Troubleshooting](#troubleshooting)
- [License](#license)

## Architecture

```
@utexo/wdk-rgb-lightning                    ← this package (WDK module)
       │                                       manager + account + LSP client
       ▼
[Bare runtime]                  [Node runtime]
@utexo/rgb-lightning-node-bare  @utexo/rgb-lightning-node-nodejs
       │                                │
       └──────────────┬─────────────────┘
                      ▼
   rgb-lightning-node/bindings/c-ffi      ← Rust C FFI (librlncffi.a)
                      │
                      ▼
              LDK + tokio + rgb-lib
```

The package exposes one entry per runtime via conditional `exports`:

- `import '@utexo/wdk-rgb-lightning'` on Node → `index-node.js`, which wires
  [`@utexo/rgb-lightning-node-nodejs`][rgb-lightning-node-nodejs].
- `require('@utexo/wdk-rgb-lightning')` inside a Bare worklet (React Native)
  → `bare.js`, which wires
  [`@utexo/rgb-lightning-node-bare`][rgb-lightning-node-bare].

Both paths re-export the same `WalletManagerRgbLightning`, account class,
error types, and LSP surface; only the native binding selected at
module-load differs.

## Installation

```sh
npm install @utexo/wdk-rgb-lightning

# Plus the native binding matching your runtime (optional peer deps):
npm install @utexo/rgb-lightning-node-nodejs   # Node host
# or
npm install @utexo/rgb-lightning-node-bare     # Bare / React Native host
```

Both bindings are declared as **optional** peer dependencies — install only
the one for your runtime. Each binding's `postinstall` downloads the
platform-specific prebuilt native artifact from its GitHub Release (no Rust
toolchain required on the consumer machine). See the binding READMEs for the
supported platform matrix.

## Quick start

```js
import WalletManagerRgbLightning from '@utexo/wdk-rgb-lightning'

const manager = new WalletManagerRgbLightning(seedPhrase, {
  network: 'regtest',
  dataDir: '/path/to/persistent/dir',
  // Optional VSS cloud backup — omit to disable.
  vssUrl: 'https://vss.example.com',
  vssAllowHttp: false,
  // Optional LSP wiring for async payments.
  lspBaseUrl: 'https://lsp.example.com',
  lspBearerToken: '<token>'
})

const account = await manager.getAccount(0) // RGB Lightning is single-account

await account.unlock({
  bitcoind_rpc_username: 'user',
  bitcoind_rpc_password: 'pass',
  bitcoind_rpc_host: '127.0.0.1',
  bitcoind_rpc_port: 18443,
  indexer_url: 'tcp://localhost:50001',
  proxy_endpoint: 'rpc://localhost:3000/json-rpc',
  announce_addresses: [],
  announce_alias: 'my-node'
})

const info = await account.getNodeInfo()
console.log(info.pubkey)

await account.connectPeer('<pubkey>@<host>:<port>')

const channel = await account.openChannel({
  peer_pubkey_and_opt_addr: '<pubkey>@<host>:<port>',
  capacity_sat: 1_000_000,
  push_msat: 0,
  public: true,
  with_anchors: true
})

const invoice = await account.createInvoice({
  amt_msat: 5000,
  expiry_sec: 3600
})

await account.sendPayment({ invoice: '<bolt11>' })

await manager.dispose()
```

A complete end-to-end example — LSP wiring, RGB-over-Lightning transfers,
and a regtest stack via Docker Compose — lives in
[utexo-rgb-wdk-demo].

### Manager configuration

`network` and `dataDir` are required. Notable optional fields:

| Field | Default | Purpose |
|-------|---------|---------|
| `daemonListeningPort` / `ldkPeerListeningPort` | `0` | RLN listening ports; `0` = ephemeral. |
| `maxMediaUploadSizeMb` | `5` | Cap on RGB media uploads. |
| `enableVirtualChannelsV0` | `false` | Enable virtual-channels-v0 (required for APay against a production LSP). |
| `virtualPeerPubkeys` | — | Trust list of peer node_ids allowed to open `trusted_no_broadcast` virtual channels (the LSP's node_id for APay). |
| `permissiveSignerPolicy` | `true` | Loosen the VLS policy filter for in-process single-user use. |
| `nodeSeedDerivation` | `auto` | New nodes use WDK's normalized BIP-39 seed directly; existing beta nodes retry the legacy identity only on an exact persisted-identity mismatch. Use `wdk-seed-v2` or `legacy-v1` to disable auto-detection. |
| `vssUrl` / `vssAllowHttp` / `vssAllowEmptyRestore` | — | VSS cloud backup; see [below](#vss-cloud-backup). |
| `lspBaseUrl` / `lspBearerToken` | — | LSP wiring for APay and the LSP client; see [below](#lsp-integration). |

## Account API

`getAccount(0)` returns a `WalletAccountRgbLightning`. RGB Lightning is
single-account (index `0`); RLN owns one LDK node per `dataDir`. All methods
are async and forward to the active binding.

| Group | Methods |
|-------|---------|
| Lifecycle | `unlock(request)`, `getBootstrap()`, `shutdown()`, `dispose()` |
| Node info | `getNodeInfo()`, `getNetworkInfo()`, `sync()`, `getAddress()`, `getAddressState()`, `rotateAddress()` |
| Peers | `connectPeer(pubkey@host:port)`, `disconnectPeer(request)`, `listPeers()` |
| Channels | `openChannel(request)`, `closeChannel(request)`, `listChannels()`, `getChannelId(tempIdHex)` |
| Invoices | `createInvoice(request)`, `createLightningInvoice(request)`, `decodeInvoice(invoice)`, `getInvoiceStatus(invoice)` |
| HODL invoices | `createHodlInvoice({ paymentHash, ... })`, `cancelHodlInvoice(request)`, `claimHodlInvoice(request)` |
| Payments | `sendPayment(request)`, `keysend(request)`, `listPayments()`, `getPayment(hash, type)` |
| RGB assets | `listAssets(filter?)`, `getAssetBalance(id)`, `getAssetMetadata(id)`, `listTransfers(id)`, `listTransfersByTxid(txid)`, `refreshTransfers(req)`, `failTransfers(req)` |
| RGB invoices/transfers | `createRgbInvoice(request)`, `decodeRgbInvoice(invoice)`, `sendRgbAsset(request)`, `getAssetMedia(digest)`, `postAssetMedia(request)` |
| RGB issuance (forwarded) | `issueAssetNia(request)`, `issueAssetUda(request)`, `issueAssetCfa(request)`, `issueAssetIfa(request)`, `inflate(request)` — forward to the binding; `@utexo/wdk-wallet-rgb` is the supported path (see note) |
| BTC | `getBalance(skipSync?)`, `getBalanceDetails(skipSync?)`, `sendTransaction({ to, value, ... })`, `sendBtc(nativeRequest)`, `getTransactions(skipSync?)`, `getTransactionsByTxid(txid)`, `listUnspents(skipSync?)`, `createUtxos(request)`, `estimateFee(blocks)` |
| WDK-standard | `index`, `path`, `keyPair`, `sign(message)`, `verify(message, signature)`, `transfer(options)`, `quoteTransfer(options)`, `quoteSendTransaction(tx)`, `getTransactionReceipt(hash)`, `toReadOnlyAccount()` |
| Diagnostics | `sendOnionMessage(request)`, `checkIndexerUrl(url)`, `checkProxyEndpoint(endpoint)` |
| VSS | `vssStatus()`, `vssBackup()`, `clearVssFence(password)` |
| APay / LSP | `apayNew(hostNodeId)`, `bootstrapLsp({ peerPubkeyAndAddr, hostNodeId? })`, `getLspConfig()`, `createLsp(peer?)` |

Notes:

- **`createInvoice` / `createLightningInvoice`** accept either RLN's native
  snake_case request or a camelCase convenience shape
  (`{ amountMsat?, expirySec, assetId?, assetAmount?, paymentHash?,
  descriptionHash?, minFinalCltvExpiryDelta? }`).
- **`transfer(options)`** is a generic router: it classifies
  `options.recipient` (BOLT11 invoice, LN pubkey, BTC address, or RGB
  invoice) and dispatches to the right primitive. `options.token` is an RGB
  `asset_id` when present. Amounts are msats for LN flows and sats for
  on-chain flows.
- **`getBalance()` returns `bigint` satoshis**, matching WDK's account
  contract. `getTokenBalance(assetId)` returns the spendable RGB amount as a
  `bigint` and falls back to the settled amount when needed.
- **`getAddress()` never returns a fabricated spend address.** Before unlock
  it rejects with `AccountLockedError`; UI loaders can call
  `getAddressState()` for `{ status: 'locked', address: null }`. The WDK
  bindings initialize RLN with address reuse enabled so reads stay stable;
  `rotateAddress()` is the explicit mutating operation for advancing it.
- **`sendTransaction()` uses WDK's `{ to, value, feeRate?,
  confirmationTarget? }` input and `{ hash, fee }` result.** `sendBtc()` is
  the explicit low-level escape hatch for RLN's native request format.
- **RGB asset issuance is forwarded, but `@utexo/wdk-wallet-rgb` is the
  supported path.** The node-level issuance calls (`issueAssetNia` /
  `issueAssetUda` / `issueAssetCfa` / `issueAssetIfa`, plus `inflate`) are
  exposed on the account and forward straight to the binding. For
  issuance-centric flows prefer [`@utexo/wdk-wallet-rgb`][wdk-wallet-rgb],
  the on-chain RGB wallet module. This module primarily holds and transfers
  assets that already exist — in channels, invoices, and on-chain — and
  keeps its own separate `rgb-lib` wallet (give each module its own
  `dataDir`).
- Atomic swaps (`makerInit` / `taker` / ...) are reachable on the binding
  but intentionally **not surfaced** on the WDK account.
- `verify` uses RLN's canonical Lightning message verifier. Only raw
  `signTransaction` remains unsupported; use the operation-specific send
  methods, which sign through VLS policy checks.

### Read-only accounts

`WalletAccountReadOnlyRgbLightning` is exported from the package root and
extends WDK's `WalletAccountReadOnly`. `account.toReadOnlyAccount()` returns a
cached instance backed by an immutable query-only adapter. It includes the
seven WDK read methods plus RLN query extensions for node/network state,
channels, peers, invoices, payments, RGB assets and transfers, BTC history,
fee estimates, media, and endpoint checks.

The adapter uses the same manager-owned native query transport, so dispose
the read-only account with its originating manager rather than retaining it
after `manager.dispose()`.

The read-only object has no full-account backreference and no signing,
broadcasting, channel mutation, lifecycle, VSS recovery, or LSP credential
methods. Address rotation is also full-account-only.

## Error handling

Most of the surface forwards to RLN, which reports failures as
`Rln(<Variant>): <message>` strings. This package wraps the boundaries that
matter in a typed hierarchy so callers can branch on `err.name` / `err.code`
instead of substring-matching. The original RLN message is preserved
verbatim and the underlying error is attached as `cause`; each error has a
`toJSON()` for structured logging.

```
RgbLightningError            code: RGB_LIGHTNING_ERROR
├── UnlockError              code: UNLOCK_FAILED
├── AccountLockedError       code: ACCOUNT_LOCKED
├── VssError                 code: VSS_ERROR
│   └── VssNotConfiguredError code: VSS_NOT_CONFIGURED
├── ApayError                code: APAY_ERROR (e.g. APAY_PEER_NOT_VISIBLE)
└── NotImplementedError      code: NOT_IMPLEMENTED
```

All are exported from the package root:

```js
import {
  RgbLightningError, UnlockError, AccountLockedError, VssError,
  VssNotConfiguredError, ApayError, NotImplementedError
} from '@utexo/wdk-rgb-lightning'

try {
  await account.unlock(rpcArgs)
} catch (err) {
  if (err instanceof UnlockError) {
    console.error(err.code, err.message, err.cause)
  }
}
```

## LSP integration

The package ships a pure-`fetch` LSP client and a composed high-level flow
object, both exported from the root. They work unchanged in Bare (via the
`bare-fetch` global installed by `bare.js`) and Node >= 18 (native `fetch`).

### `LspClient`

A thin, retrying HTTP client over the UTEXO LSP REST API:

```js
import { LspClient, LspError } from '@utexo/wdk-rgb-lightning'

const lsp = new LspClient({ baseUrl: 'https://lsp.example.com' })
const info = await lsp.getInfo()
```

Methods include `health()`, `getInfo()`, `lnurlDiscovery(username)`,
`lnurlCallback(username, amountMsat)`, `resolveAddress(username, amountMsat)`,
`getLightningAddressByPubkey(pubkey)`, `onchainSend({ rgbInvoice, ln })`, and
`lightningReceive({ lnInvoice, rgb })`. Failures throw `LspError`
(carrying `endpoint`, `status`, `body`).

### `UtexoLsp` (composed flows)

`account.createLsp(peer?)` returns a `UtexoLsp` that orchestrates the
multi-step LSP interactions — connect, wait for channel readiness,
receive/send RGB over Lightning, pay a Lightning Address, enable a Lightning
Address, and claim pending payments. The no-arg form auto-discovers the peer
from the wallet's `lspBaseUrl` (`GET /get_info`).

```js
const lsp = await account.createLsp()
await lsp.connect()
const { lnInvoice, rgbInvoice } = await lsp.receiveAsset({ assetId, amountRgb: 100 })
await lsp.awaitReceiveSettlement(lnInvoice)
```

Key methods: `connect()`, `waitForChannel(assetId, opts?)`,
`receiveAsset(opts)`, `awaitReceiveSettlement(lnInvoice, opts?)`,
`waitForOutboundLiquidity(minMsat, opts?)`, `sendAsset(opts)`,
`payAddress(opts)`, `enableLightningAddress()`, `claimPendingPayments()`.
Channel and liquidity wait timeouts throw `LspChannelTimeoutError` and
`LspLiquidityTimeoutError`; terminal settlement failures throw
`LspSettlementError`.

### LNURL / Lightning Address helpers

`parseLightningAddress`, `fetchDiscovery`, `resolveAddressToInvoice`
(LNURL-pay), and the account-bound helpers `payLightningAddress`,
`requestLspRgbDeposit`, `payRgbViaLsp` are also exported from the root.
LNURL callbacks are restricted to the discovery host by default; delegated
cross-host callbacks require the explicit `allowCrossHostCallback: true` opt-in.

## VSS cloud backup

Set `vssUrl` at construction to mirror LDK channel state and RGB wallet data
to a remote VSS key-value store in near-real-time. Payloads are client-side
encrypted (XChaCha20-Poly1305, keyed via HKDF of a signing key derived from
the BIP-39 mnemonic at BIP-32 path `m/535'/1'`); the server sees only
ciphertext, and recovery requires the original seed. Plain `http://` is
rejected for non-loopback hosts unless `vssAllowHttp: true`.

- `account.vssStatus()` — local view: whether VSS is configured, the URL +
  allow-http flag, and the snapshot version from the most recent
  `vssBackup()` this session.
- `account.vssBackup()` — force an immediate flush, returning `{ version }`.
  Useful for app-controlled checkpoints (e.g. before app suspend).
- `account.clearVssFence(password)` — forcibly take over a stale VSS
  ownership fence after a previous node died holding it (restarts otherwise
  fail with `Rln(VssFenceHeld)`). Only call this when certain the previous
  owner is gone — pointing two live nodes at one VSS store corrupts state.

VSS operations on a wallet constructed without `vssUrl` throw
`VssNotConfiguredError`.

## Async payments (APay)

APay lets the wallet receive over Lightning while offline: it uploads a
batch of pre-allocated payment hashes to an LSP, which accepts payments on
the wallet's behalf. Against a production LSP this requires
`enableVirtualChannelsV0: true` and the LSP's node_id in
`virtualPeerPubkeys`.

- `account.apayNew(hostNodeId)` — register with the LSP as an APay recipient
  (`hostNodeId` is the LSP node_id, hex). Requires `lspBaseUrl`
  (and `lspBearerToken` if the LSP enforces auth).
- `account.bootstrapLsp({ peerPubkeyAndAddr, hostNodeId? })` — connect to the
  LSP peer, wait until it appears in `listPeers`, then (if `hostNodeId` is
  given) call `apayNew`. Refuses to register before the peer is visible to
  avoid RLN's host-response timeout (throws `ApayError` with code
  `APAY_PEER_NOT_VISIBLE`).

## Security model

- **Seed never leaves the host.** The mnemonic is owned by the WDK secret
  manager. The binding derives a 32-byte BIP-32 entropy, passes it once to
  `NativeExternalSigner.create`, and RLN persists only public identifying
  material (xpubs, node id, master fingerprint). Re-deriving from the same
  mnemonic reproduces the same entropy, matches the on-disk key-source, and
  keeps the LDK node identity stable across restarts.
- **All channel-state crypto runs in-process** through
  [`vls-protocol-signer`][vls]. The signer's lifecycle is tied to the
  binding and is destroyed on `manager.dispose()`. Retained seed copies use
  zeroizable buffers and are erased with `sodium_memzero` on successful
  fallback resolution and shutdown, including cleanup failure paths.
- **VSS payloads are client-side encrypted** (see above); the server only
  ever holds ciphertext.
- **Plain `http://` is rejected by default** for VSS and LSP endpoints; opt
  in (`vssAllowHttp` / `LspClient({ allowHttp: true })`) only for loopback
  or development.

## Testing and local development

### Unit tests

The host-side logic — recipient routing, fee estimation, typed-error
wrapping, and binding config mapping — is covered by a jest suite that
runs with no live node and no native binding (the addon is mocked):

```sh
npm ci
npm test            # jest, host-side units
npm run test:coverage
```

### Integration / end-to-end

End-to-end coverage (a real LDK node, RGB assets, channels, payments,
and a regtest stack via Docker Compose) lives in [utexo-rgb-wdk-demo]. To
exercise a local build of this package instead of a published tag, check
the demo out next to this repo so the relative paths resolve:

```
parent/
  wdk-rgb-lightning/        # this repo
  utexo-rgb-wdk-demo/
```

The Node E2E harness already links this repo by path —
`utexo-rgb-wdk-demo/node-demo/package.json` declares
`"@utexo/wdk-rgb-lightning": "file:../../wdk-rgb-lightning"` (and the Node
binding via `file:../../packages/rgb-lightning-node-nodejs`). Installing
the harness symlinks your working tree in; the dockerised LSP + regtest
stack then runs the suite:

```sh
cd utexo-rgb-wdk-demo/node-demo
npm install                                          # links file:../../wdk-rgb-lightning
./lsp/up.sh                                           # docker compose up --build; waits on :8080/health
LSP_BASE_URL=http://127.0.0.1:8080 npm run test:e2e  # tsx test-runner/run.ts
./lsp/down.sh
```

The React Native app at the demo root instead pins a published tag
(`github:UTEXO-Protocol/wdk-rgb-lightning#v<tag>`). To test local changes
on device, repoint that dependency to `file:../wdk-rgb-lightning`, re-run
`npm install`, and rebuild the worklet bundle.

## Troubleshooting

- **`Rln(Conflict)` on a re-launch** — expected on every launch after the
  initial wallet create. The binding swallows it internally; if it bubbles
  up you're calling the lower-level binding directly instead of going
  through the WDK account.
- **`UnlockError` / `Rln(FailedVssInit)`** — bad bitcoind/indexer/proxy
  credentials or an unreachable backend; for VSS, an unreachable URL or a
  rejected auth challenge. Check `vssUrl` (https vs http) and reachability;
  for fence takeover see `clearVssFence`.
- **`ApayError` (`APAY_PEER_NOT_VISIBLE`)** — `apayNew` was attempted before
  the LSP peer reached `listPeers`. Use `bootstrapLsp` or retry once the
  peer is visible.
- **Channels fail to open with a fresh node** — confirm bitcoind RPC is
  reachable from inside the worklet's network sandbox; on regtest set
  `rpcallowip=127.0.0.1/32` so loopback connections are accepted.
- **Port conflict on Metro / Expo** — a local VSS test server may squat on
  port 8081 (Metro's default). Stop it before starting Metro, or move VSS
  to another port.

## License

Apache-2.0. See [`LICENSE`](./LICENSE).

[rgb-lightning-node]: https://github.com/UTEXO-Protocol/rgb-lightning-node
[rgb-lightning-node-nodejs]: https://github.com/UTEXO-Protocol/rgb-lightning-node-nodejs
[rgb-lightning-node-bare]: https://github.com/UTEXO-Protocol/rgb-lightning-node-bare
[wdk-wallet-rgb]: https://github.com/UTEXO-Protocol/wdk-wallet-rgb
[utexo-rgb-wdk-demo]: https://github.com/UTEXO-Protocol/utexo-rgb-wdk-demo
[vls]: https://gitlab.com/lightning-signer/validating-lightning-signer
