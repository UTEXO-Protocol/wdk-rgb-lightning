# @utexo/wdk-rgb-lightning

[![Built with WDK](./assets/built-with-wdk.png)](https://github.com/tetherto/wdk)

This branch is the unpublished `0.2.0-bfa.1` migration candidate. It requires
the matching candidate native archives; released beta.5 binaries are rejected.
See [migration qualification](./MIGRATION-QUALIFICATION.md) for the exact
source graph, integration procedure and pending acceptance checks.

WDK module for RGB-over-Lightning, built on
[`rgb-lightning-node`][rgb-lightning-node] (RLN). It runs a full LDK +
`rgb-lib` Lightning node behind WDK's wallet-manager/account contract and
adds BTC/RGB on-chain transfers, channels, BOLT11 + RGB invoices, payments,
HODL invoices, async payments (APay), and an LSP
client for the UTEXO Lightning Service Provider.

The node runs in **external-signer** mode: the BIP-39 mnemonic stays in the
WDK secret manager, and all channel-state cryptography happens in-process
through a VLS signer. Node and persistent VLS commitment state must both be
retained in app-private storage; the mnemonic alone is not channel recovery.

Complements [`@utexo/wdk-wallet-rgb`][wdk-wallet-rgb], the on-chain RGB
wallet module. The two are independent: each owns its own `rgb-lib` SQLite
state, keyed by its own wallet fingerprint, and they do **not** share asset
records. Give each module a **separate** `dataDir` — `rgb-lib` takes an
exclusive lock on a wallet directory, and the Lightning node derives a
different wallet fingerprint (it signs in-process via VLS from a 32-byte
entropy) than the on-chain module (standard BIP-32 from the full seed), so
even a shared `dataDir` resolves to different `<fingerprint>/` subfolders.
RLN holds and transfers RGB assets for its channels and invoices. Released
RLN rejects **issuance and inflation in external-signer mode**, which this
module always uses. Issue assets in a separate on-chain wallet, such as
[`@utexo/wdk-wallet-rgb`][wdk-wallet-rgb], then transfer them to this wallet.

## Contents

- [Architecture](#architecture)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Account API](#account-api)
- [Bitcoin message signing](#bitcoin-message-signing-bip-322)
- [Error handling](#error-handling)
- [Mainnet policy and capabilities](#mainnet-policy-and-capabilities)
- [WebRGB integration](#webrgb-integration)
- [LSP integration](#lsp-integration)
- [VSS cloud backup](#vss-cloud-backup)
- [Async payments (APay)](#async-payments-apay)
- [Security model](#security-model)
- [Testing and local development](#testing-and-local-development)
- [Known limitations](#known-limitations)
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

Install this module with the native binding for your runtime:

The registry commands below install the released beta.5 baseline. For this
branch, use the reviewed candidate archives described in the migration guide.

```sh
# Node.js
npm install @utexo/wdk-rgb-lightning@0.2.0-beta.5 @utexo/rgb-lightning-node-nodejs@0.2.0-beta.5

# Bare / React Native
npm install @utexo/wdk-rgb-lightning@0.2.0-beta.5 @utexo/rgb-lightning-node-bare@0.2.0-beta.5
```

Choose one binding. Bare installs its required native payload dependencies
automatically. Standalone Bare requires >=1.33.0; see the
[Bare setup guide](https://github.com/UTEXO-Protocol/rgb-lightning-node-bare/blob/main/README.md)
for React Native integration.

Allow the native package's install scripts to run. If Bare's scripts were
skipped, assemble its native files before bundling:

```sh
npm --prefix node_modules/@utexo/rgb-lightning-node-bare run hydrate-native
```

For Android, use `react-native-bare-kit@0.15.5` and apply the
[native Android setup hook](https://github.com/UTEXO-Protocol/rgb-lightning-node-bare/blob/main/android/README.md)
in your root Gradle build.

## Quick start

```js
import WalletManagerRgbLightning from '@utexo/wdk-rgb-lightning'

const manager = new WalletManagerRgbLightning(seedPhrase, {
  network: 'regtest',
  dataDir: '/path/to/persistent/dir',
  // Optional LSP wiring for async payments.
  lspBaseUrl: 'https://lsp.example.com',
  lspBearerToken: '<token>'
})

const account = await manager.getAccount(0) // RGB Lightning is single-account

await account.unlock({
  ldk_chain_sync: {
    mode: 'BlockSync',
    config: {
      bitcoind_rpc_username: 'user',
      bitcoind_rpc_password: 'pass',
      bitcoind_rpc_host: '127.0.0.1',
      bitcoind_rpc_port: 18443
    }
  },
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

await account.shutdown()
manager.dispose()
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
| `enableVirtualChannelsV0` | `false` | Explicit opt-in to virtual-channels-v0; not inferred from LSP discovery. |
| `virtualPeerPubkeys` | — | Trust list of peer node_ids allowed to open `trusted_no_broadcast` virtual channels (the LSP's node_id for APay). |
| `permissiveSignerPolicy` | `false` | Strict policy by default; permissive mode is an explicit non-mainnet option. |
| `autoUnlockRequest` | absent | Opt into address-triggered activation with a canonical or supported legacy unlock request. |
| `nodeSeedDerivation` | `auto` | New nodes use WDK's normalized BIP-39 seed directly; existing beta nodes retry the legacy identity only on an exact persisted-identity mismatch. Use `wdk-seed-v2` or `legacy-v1` to disable auto-detection. |
| `vssUrl` / `vssAllowHttp` / `vssAllowEmptyRestore` | — / `false` / `false` | Explicit VSS endpoint, local HTTP opt-in and empty-restore opt-in; see [below](#vss-cloud-backup). |
| `vssAutomaticBackupEnabled` | `true` for a new policy | Initial automatic snapshot preference; a saved wallet/network/endpoint choice takes precedence. |
| `lspBaseUrl` / `lspBearerToken` | — | LSP wiring for APay and the LSP client; see [below](#lsp-integration). |

## Account API

`getAccount(0)` returns a `WalletAccountRgbLightning`. RGB Lightning is
single-account (index `0`); RLN owns one LDK node per `dataDir`. All methods
are async and forward to the active binding.

| Group | Methods |
|-------|---------|
| Lifecycle | `unlock(request)`, `getBootstrap()`, `shutdown()`, `dispose()` |
| Node info | `getNodeInfo()`, `getNetworkInfo()`, `sync()`, `getAddress()`, `getNewAddress()`, `getAddressState()`, `rotateAddress()` |
| Peers | `connectPeer(pubkey@host:port)`, `disconnectPeer(request)`, `listPeers()` |
| Channels | `openChannel(request)`, `closeChannel(request)`, `listChannels()`, `getChannelId(tempIdHex)` |
| Invoices | `createInvoice(request)`, `createLightningInvoice(request)`, `decodeInvoice(invoice)`, `getInvoiceStatus(invoice)` |
| HODL invoices | `createHodlInvoice({ paymentHash, ... })`, `cancelHodlInvoice(request)`, `claimHodlInvoice(request)` |
| Payments | `sendPayment(request)`, `keysend(request)`, `listPayments()`, `getPayment(hash, type)` |
| RGB assets | `listAssets(filter?)`, `getAssetBalance(id)`, `getAssetMetadata(id)`, `listTransfers(id)`, `listTransfersByTxid(txid)`, `refreshTransfers(req)`, `failTransfers(req)` |
| RGB invoices/transfers | `createRgbInvoice(request)`, `decodeRgbInvoice(invoice)`, `sendRgbInvoice(request)`, `sendRgbAsset(request)`, `getAssetMedia(digest)`, `postAssetMedia(request)` |
| RGB burn | `burnAsset({ asset_id, amount, burn_recipient?, fee_rate, min_confirmations })` returns `{ txid, batch_transfer_idx }`; no automatic retry or bridge payout |
| RGB issuance (unsupported in this mode) | `issueAssetNia(request)`, `issueAssetUda(request)`, `issueAssetCfa(request)`, `issueAssetIfa(request)`, `inflate(request)` forward the released `UnsupportedInExternalSignerMode` error; use a separate on-chain wallet |
| BTC | `getBalance(skipSync?)`, `getBalanceDetails(skipSync?)`, `sendTransaction({ to, value, ... })`, `sendBtc(nativeRequest)`, `getTransactions(skipSync?)`, `getTransactionsByTxid(txid)`, `listUnspents(skipSync?)`, `createUtxos(request)`, `estimateFee(blocks)`, `estimateFeeResult(blocks)` |
| WDK-standard | `index`, `path`, `keyPair`, `sign(message)`, `verify(message, signature)`, `transfer(options)`, `quoteTransfer(options)`, `quoteSendTransaction(tx)`, `getTransactionReceipt(hash)`, `toReadOnlyAccount()` |
| Bitcoin message proofs | `getMessageSigningAddress()`, `signMessageBip322(message, address)`, `verifyMessageBip322(message, address, signature)` |
| Diagnostics | `sendOnionMessage(request)`, `checkIndexerUrl(url)`, `checkProxyEndpoint(endpoint)` |
| VSS | `vssStatus()`, `getVssBackupInfo()`, `getVssBackupMetadata()`, `setVssAutomaticBackupEnabled(enabled)`, `vssBackup()`, `prepareVssRestore(scope?)`, `getVssRestoreInfo()`, `clearVssFence(password, scope?)` |
| APay / LSP | `apayNew(hostNodeId)`, `bootstrapLsp({ peerPubkeyAndAddr, hostNodeId? })`, `getLspConfig()`, `createLsp(peer?)` |

Notes:

- **`estimateFeeResult(blocks)`** accepts targets from 1 to 1,008 blocks and
  returns `{ status: 'available', estimate: { fee_rate } }` or
  `{ status: 'unavailable' }` for the native no-estimate condition. It assigns
  no fallback rate; transport, lock, invalid-target and malformed-response
  failures still throw. Existing `estimateFee()` behavior is unchanged.
- **Bitcoin message signing** uses the explicit BIP-322 API below. Existing
  `sign()` and `verify()` retain their Lightning node-identity semantics.

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
  it rejects with `AccountLockedError` unless `autoUnlockRequest` is configured; UI loaders can call
  `getAddressState()` for `{ status: 'locked', address: null }`. The WDK
  candidate uses `reuseAddresses: false`; the new library rejects `true`.
  WDK caches the current receive address within the account session so
  repeated `getAddress()` calls remain stable. Use `getNewAddress()` to
  allocate and persist a fresh receive address. `rotateAddress()` belongs to
  the old reuse policy and rejects with guidance to use `getNewAddress()`.
  Allocation calls are serialized across full and read-only accounts, and
  shutdown waits for in-flight allocation. The current native lifecycle repair
  drains the node before explicit signer revocation and supports the qualified
  same-process reopen cases. Failed cleanup remains retryable; manager disposal
  retains failed account and signer owners while removing completed cleanup.
  FullScan and interrupted-payment recovery require separate qualification;
  see [PRODUCTION-GATES.md](./PRODUCTION-GATES.md).
- **`sendTransaction()` uses WDK's `{ to, value, feeRate?,
  confirmationTarget? }` input and `{ hash, fee }` result.** `sendBtc()` is
  the explicit low-level escape hatch for RLN's native request format.
- **RGB asset issuance and inflation are not supported in external-signer mode.**
  The node-level issuance calls (`issueAssetNia` /
  `issueAssetUda` / `issueAssetCfa` / `issueAssetIfa`, plus `inflate`) are
  exposed for API compatibility and surface the released runtime rejection.
  For issuance use [`@utexo/wdk-wallet-rgb`][wdk-wallet-rgb],
  the on-chain RGB wallet module. This module primarily holds and transfers
  assets that already exist — in channels, invoices, and on-chain — and
  keeps its own separate `rgb-lib` wallet (give each module its own
  `dataDir`).
- Atomic swaps (`makerInit` / `taker` / ...) are reachable on the binding
  but intentionally **not surfaced** on the WDK account.
- `verify` uses RLN's canonical Lightning message verifier. Only raw
  `signTransaction` remains unsupported; use the operation-specific send
  methods, which sign through VLS policy checks.

### Bitcoin message signing (BIP-322)

Use the explicit Bitcoin message API to prove the ability to receive at an
address. Check the installed native extension before offering signing:

```js
if (!account.getCapabilities().bip322.signing) {
  throw new Error('Install matching native peers with BIP-322 support')
}
const address = await account.getMessageSigningAddress()
// Show and authorize this exact address and message in your application.
const message = 'My exact message\n'
const signature = await account.signMessageBip322(message, address)
const valid = await account.verifyMessageBip322(message, address, signature)
```

The native signer uses its fixed first vanilla BIP86 receive address,
`m/86'/coin_type'/0'/0/0`, and checks the requested address against its own
bootstrap xpub. Reading this address does not allocate or rotate a receive
address. Signing requires an unlocked native wallet and attached signer; it
does not require Lightning, funds, a network request or a transaction broadcast.
Private keys remain in the native signer. Applications own the message review
and fresh user authorization before each signing request.

Messages are exact UTF-8, including spaces, line endings, empty strings and
embedded NULs. There is a 4096-byte limit. Ill-formed UTF-16 is rejected rather
than replaced or normalized. Returned proofs use BIP-322 v2's `smp` prefix
followed by the base64 witness. A signature proves neither an account balance
nor the origin of a previous payment.

`verifyMessageBip322()` is also available on read-only accounts. It verifies
P2TR key-path and P2WPKH simple proofs for the configured Bitcoin network,
including historical prefixless simple signatures. Verification uses public
data and does not create or unlock an RLN node. Full (`ful`), proof-of-funds
(`pof`), script-path and other script types are outside this API's scope.
Malformed inputs throw; a well-formed proof that fails verification returns
`false`. The capability reports native support separately from wallet readiness.
Older peers fail explicitly; this API never falls back to Lightning's legacy
node-identity `sign()` or `verify()` methods.

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
├── LightningDisabledError   code: LIGHTNING_DISABLED_ON_MAINNET
├── VssError                 code: VSS_ERROR
│   ├── VssNotConfiguredError code: VSS_NOT_CONFIGURED
│   └── VssUnsupportedError   code: ERR_VSS_UNSAFE_UPSTREAM (legacy compatibility)
├── ApayError                code: APAY_ERROR (e.g. APAY_PEER_NOT_VISIBLE)
└── NotImplementedError      code: NOT_IMPLEMENTED
```

All are exported from the package root:

```js
import {
  RgbLightningError, UnlockError, AccountLockedError, VssError,
  VssNotConfiguredError, VssUnsupportedError, ApayError, NotImplementedError
} from '@utexo/wdk-rgb-lightning'

try {
  await account.unlock(rpcArgs)
} catch (err) {
  if (err instanceof UnlockError) {
    console.error(err.code, err.message, err.cause)
  }
}
```

## Mainnet policy and capabilities

RLN disables Lightning **on mainnet only**. Account channel, peer, invoice
(including BOLT11 decoding), payment, HODL, APay and onion-message methods reject
with `LightningDisabledError`, code `LIGHTNING_DISABLED_ON_MAINNET`, before
native execution. Lightning recipients in `transfer` and `quoteTransfer`,
wallet-connected LSP methods and standalone account-taking LSP helpers use the
same policy before HTTP side effects. Read-only accounts follow it too.

Signet, testnet and regtest retain their Lightning APIs; availability is not a
claim that their recorded release gates are resolved. This unpublished migration
candidate cannot open ordinary locally funded BTC/RGB channels; see the exact
[migration limits](./MIGRATION-QUALIFICATION.md). BTC/RGB on-chain methods,
identity queries, message signing/verification and standalone LSP discovery
remain available. `getTransactionReceipt` does not query Lightning history on
mainnet, so an unknown on-chain hash returns `null`.

```js
const capabilities = account.getCapabilities()
// { network, signer: 'external', lightning, consignmentExport: true,
//   bfaAssetListing: true, bfaValidation: true, burn: true }

try {
  await account.listChannels()
} catch (error) {
  if (error.code !== 'LIGHTNING_DISABLED_ON_MAINNET') throw error
}
```

`getNetwork()` reads the configured network without unlocking.
`getCapabilities()` describes this package/signer combination, not wallet
readiness, balance or successful qualification. `getBfaCapabilities()` checks
the admitted native build's capability flags and actual facade methods without
creating a wallet. Missing capability reports fail closed. The read-only
facade reports `burn: false` and has no `burnAsset`.
Configure `eth_rpc_url` when
unlocking to enable native validation of BFA bridge events:

```js
await account.unlock({
  ldk_chain_sync: {
    mode: 'TransactionSync',
    config: { indexer_url: bitcoinIndexerUrl }
  },
  indexer_url: bitcoinIndexerUrl,
  proxy_endpoint: rgbProxyUrl,
  eth_rpc_url: ethereumRpcUrl,
  announce_addresses: []
})
```

Choose the Ethereum RPC for the chain containing the asset's bridge contract.
Omitting the field, or supplying `null`, keeps the non-BFA unlock behavior.
No endpoint is inferred or substituted. A capability flag does not establish
endpoint health, chain identity or the validity of any particular consignment.
Consignment export uses the existing account API. The
[BFA qualification report](./BFA-QUALIFICATION.md) identifies the sources and
scenarios tested; it does not establish bridge or deployment approval.

### Native Asset Burn

`account.burnAsset(request)` invokes the native `SdkNode.burn` once. It accepts
the existing RLN C-FFI request, not a WebRGB or WalletConnect request:

```js
const { txid, batch_transfer_idx } = await account.burnAsset({
  asset_id: assetId,
  amount: '1000000',
  fee_rate: 2,
  min_confirmations: 3,
  burn_recipient: recipientHex // BFA: 32-byte hex, without a 0x prefix
})
```

`amount` and `fee_rate` must be positive safe-integer numbers or canonical
decimal strings up to `18446744073709551615`. Native wrappers encode strings
as exact u64 JSON numbers. `min_confirmations` is an integer from 0 to 255;
the application owns its confirmation policy. Omit `burn_recipient` (or use
`null`) for assets that do not require it. WDK does not infer a recipient,
encode EVM addresses, choose a chain, or perform an Ethereum payout.

Await `unlock()` first. Burns are rejected during activation or after shutdown
starts. Node/Bare native calls are synchronous; RLN serializes preparation,
signing and completion under the RGB wallet mutex. The successful response
contains the native `txid` and `batch_transfer_idx`, not proof of settlement.

Failures may retain an `Initiated` transfer and input reservations. WDK passes
native errors through, never retries or automatically frees inputs. Reconcile
transfer history and on-chain state before requesting another burn, including
after a malformed or lost response. A subsequent call is a new burn, not an
idempotent retry. Persistent operation records, user approvals, transport and
bridge recovery belong to the application; none are added here. Export an
available proof separately with `getConsignment(assetId, txid)`.

The runtime gate requires the exact source/adapter identity plus
`external-signer-burn-v1`. API availability does not qualify a funded wallet,
bridge, payout or device. See the [release tracker](./RELEASE-0.15-TRACKER.md).

## WebRGB integration

The optional `@utexo/wdk-rgb-lightning/webrgb` export adapts a native WDK account
to WebRGB's receiving/read subset. It does not run RLN in a browser, inject
`window.rgb`, or establish WalletConnect sessions. It has no runtime dependency
on WebRGB or WalletConnect. TypeScript consumers of this subpath should install
the optional type peer `@utexo/webrgb@^0.1.0`; the unchanged read subset is
checked against `0.1.0` and `0.1.2`. Ordinary WDK consumers do not need it.

See [WEBRGB.md](./WEBRGB.md) for session authorization, approval handling, API
mapping and native-runtime integration. The subset matches the non-burn scope
of [rgb-sdk-rn #59](https://github.com/UTEXO-Protocol/rgb-sdk-rn/pull/59).

## LSP integration

Low-level `LspClient` methods do not authorize local payments. In particular,
`lightningSend` can create a server-side HODL quote; it is not a read-only query
or a fee-capped wallet payment. The endpoint must be enabled by the LSP operator.
Higher-level linked-asset payment execution remains excluded from this version.
For bridge helpers, a verified Lightning payment is not proof that the RGB delivery
leg settled; monitor that leg independently.

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

Lightning Address payment APIs accept both `recipient@example.com` and
[UMA's](https://www.uma.me/) `$recipient@example.com` form. UMA input is
normalized to the equivalent Lightning Address before LNURL discovery. This is
address-format compatibility; it does not implement UMA signing, compliance,
or currency negotiation.

`isUmaAddress`, `normalizeLightningAddress`, `parseLightningAddress`,
`fetchDiscovery`, `resolveAddressToInvoice` (LNURL-pay), and the account-bound
helpers `payLightningAddress`, `requestLspRgbDeposit`, `payRgbViaLsp` are
exported from the root.
LNURL callbacks are restricted to the discovery host by default; delegated
cross-host callbacks require the explicit `allowCrossHostCallback: true` opt-in.

## VSS cloud backup

Configure VSS explicitly when constructing the manager:

```js
const manager = new WalletManagerRgbLightning(mnemonic, {
  network: 'signet',
  dataDir,
  vssUrl: 'https://vss-server.utexo.com/vss',
  vssAllowHttp: false,
  vssAllowEmptyRestore: true // New wallet only; keep false when requiring an existing backup.
})
const account = await manager.getAccount()
await account.unlock(unlockRequest)
const { version } = await account.vssBackup()
const status = await account.vssStatus()
```

For an intentional seed/cloud restore, call `account.prepareVssRestore()` **before**
requesting an address or unlocking. A `{ restored: true, ... }` receipt means the
native binding downloaded and validated an existing RGB snapshot before local
wallet creation. `{ restored: false, status: 'not_found', ... }` means no snapshot
was available; do not label a newly created empty wallet as restored. Continue
through normal unlock and inspect `getVssRestoreInfo()` for the identity-bound
receipt with `unlocked: true`. The maintained native preparation validates bounded
archive paths and wallet identity, and retains authenticated local provenance for
an interrupted recovery. This recovers cloud state; it does not perform a full
seed/address gap scan or recover separate signer/application data.

No endpoint is inferred. Invalid URLs fail before native creation; HTTP requires
an explicit `vssAllowHttp: true`. Normal native initialization attempts existing
remote state before opening the wallet. Its empty-store behavior is not restore
evidence: use preparation above to require an existing snapshot. Other restore
errors are not downgraded to local-only mode.

Automatic RGB snapshots default to on. The native runtime durably retains this
preference for the wallet, network and exact VSS endpoint and loads it before
unlock; an existing preference takes precedence over the optional initial config.
Full accounts also schedule serialized checkpoints after on-chain sends, issuance,
receive-invoice and address creation, RGB refresh/import/burn and output creation.

Status, metadata and other pure reads do not upload snapshots. Synchronizing
balance, transaction or unspent-output reads can discover wallet changes. An
unchanged synchronization does not upload; changed incoming or spent Bitcoin
state triggers an automatic snapshot when enabled. While automatic backup is
off, discovered changes remain pending for manual backup or re-enable catch-up.

```js
await account.setVssAutomaticBackupEnabled(false)
const metadata = await account.getVssBackupMetadata()
// metadata.automatic_backup_enabled === false
await account.vssBackup() // Manual backup remains available while automatic is off.
await account.setVssAutomaticBackupEnabled(true) // Includes catch-up before acknowledgement.
```

A policy transition drains previously admitted mutations and snapshots and holds
later mutation dispatch until it confirms. Disabling automatic snapshots retains
the VSS client, manual backup and restore; other VSS configuration/key-value and
writer-lock traffic can continue. Enabling backs up current state before saving
the on preference. Upload failures retain the previous preference. After any
transition error, re-read `getVssBackupMetadata()` before displaying a confirmed
choice: a storage/rollback failure can leave the outcome unknown. Automatic hooks
re-read native policy after an error and pause when it cannot be confirmed.
Shutdown joins admitted work and never starts an extra automatic snapshot while
the preference is off. A checkpoint failure does not change a completed financial
operation into a failed payment. Use `vssBackup()` to explicitly await a backup.

`getVssBackupMetadata()` is a separate, versioned local receipt API. It returns
`schema_version: 1`, `automatic_backup_enabled`, and `last_backup`. The last field
is null when the runtime has no reliable completion receipt, including historical
backups created before timestamp tracking. Otherwise it contains the canonical
`version`, `completed_at_ms` (Unix milliseconds), `network`, `vss_url` and `node_id`.
The timestamp records acknowledged native upload completion, never the time a
health read noticed an existing backup. The WDK validates the receipt's exact
fields, chain, endpoint and wallet identity. A receipt is not current remote health
or proof that later wallet changes are backed up. Read-only accounts can query this
metadata but cannot change the automatic snapshot preference. Completion timestamps
are positive integers in the JavaScript Date range and remain valid if the device
clock later moves backward or forward. A future-dated receipt should be displayed
without a date; it must not disable policy controls or invalidate remote health.

`vssStatus()` returns exactly `configured`, `url`, `allowHttp`,
`lastBackupVersion`, `supported`, `enabled`, and `disabledReason`. Support is
`true`; enabled follows explicit configuration; the disabled reason is `null`.
`vssBackup()` acknowledges an upload only after reading the canonical remote RGB
manifest and verifying that backup exists and no further backup is required. Its
returned version is that manifest's version, rather than the raw upload object's
counter. A failed post-upload read is an indeterminate acknowledgement, not proof
that the upload failed; do not blindly replay it. The status version is the last
successful RGB manifest observed by this binding session,
not remote health or a complete-wallet recovery guarantee. It resets on a new
binding. `getVssBackupInfo()` reads actual native/remote state while unlocked and
returns `backup_exists`, `version`, `backup_required`, and
`last_auto_backup_failed`; it also updates the locally observed version. The
failure flag includes failed WDK mutation checkpoints. A successful checkpoint
clears the wrapper's flag; a historical native automatic-upload failure can remain
recorded until a later native automatic upload succeeds. That historical flag
does not invalidate a successful manual receipt. Merely reading status never
uploads or clears a fence. Raw single-object and chunked upload counters differ;
WDK receipts use the canonical manifest version instead.

`clearVssFence(password)` is an explicit recovery takeover and is allowed by
native only while the node is locked. Never clear a fence automatically or while
another writer might still be active. Read-only accounts can inspect local
status but expose no backup, restore or takeover writes. Remote erasure is not
implemented.

VSS does not replicate the separate VLS signer database, mnemonic or Iris
application state. Upstream external-signer credentials still derive from public
bootstrap data; interrupted chunked replacement and stale writer fences retain
the upstream recovery limitations. Enabling VSS does not change those protocol
semantics or establish arbitrary crash/device-loss recovery.

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
  `NativeExternalSigner.createWithStorage`, and preserves the signer's commitment
  database below `dataDir/vls-signer` (or `vls-signer-legacy` for the legacy identity).
  Re-deriving entropy preserves identity, not all safety-critical channel state.
  Local signer persistence is not proof of fresh-device VSS recovery.
- **All channel-state crypto runs in-process** through
  [`vls-protocol-signer`][vls]. The signer's lifecycle is tied to the
  binding and is destroyed on `manager.dispose()`. Retained seed copies use
  zeroizable buffers and are erased with `sodium_memzero` on successful
  fallback resolution and successful shutdown. Failed shutdown retains handles
  and required state for explicit retry; errors must not be ignored.
- **VSS recovery scope:** RGB upload versions are not whole-wallet atomic snapshots.
  Signer/application state is separate; upstream credential and interrupted-upload
  limitations remain. See [VSS cloud backup](#vss-cloud-backup).
- **Plain `http://` is rejected by default** for LSP endpoints; opt
  in with `LspClient({ allowHttp: true })` only for loopback
  or development.

## Testing and local development

### Unit tests

The host-side logic — recipient routing, fee estimation, typed-error
wrapping, and binding config mapping — is covered by a jest suite that
runs with no live node and no native binding (the addon is mocked).
Use Node 22 or newer and npm 12.0.1 for the release-package checks:

```sh
npm ci --ignore-scripts
npm test -- --runInBand
npm run test:coverage -- --runInBand
```

### Integration / end-to-end

The source repository includes a
[Node/Bare regtest harness](https://github.com/UTEXO-Protocol/wdk-rgb-lightning/blob/v0.2.0-beta.5/tests/regtest/README.md)
for real native nodes, transfers, channels and recovery scenarios, with a
dedicated Docker Compose stack. These files are not included in the npm package.
Run destructive reorg and process-interruption scenarios only against disposable,
isolated wallets and chain volumes.

Each scenario records its actual source, runtime, completed checks and failures.
The [qualification register](./PRODUCTION-GATES.md) is the current summary; the
[older regtest report](https://github.com/UTEXO-Protocol/wdk-rgb-lightning/blob/v0.2.0-beta.5/tests/regtest/QUALIFICATION.md)
and [mobile fixture](https://github.com/UTEXO-Protocol/wdk-rgb-lightning/blob/v0.2.0-beta.5/tests/mobile/README.md)
retain their historical source/framework scopes. A passing host test or an
updated package declaration does not qualify a mobile application.

## Known limitations

The pinned native graph retains the following financial and security limitations:

1. **Interrupted BTC send:** process death during a send can leave an
   orphaned input reservation and reduce reported spendable balance after restart.
   Automatic reconciliation or safe abort recovery is not provided.
2. **RGB reorg accounting:** a disconnected settled receipt can remain in
   `settled` and `spendable` balances, including after cold restart. These fields
   are **not a reorg-safe current-confirmation guarantee**.
3. **Pending RGB accounting:** one incoming witness receipt can be counted
   twice in `future` before settlement. Correct settled balances do not make the
   pending projection reliable.
4. **BFA event selection:** an earlier wrong-amount lock for a mint can
   cause validation to reject a later valid lock for the same mint. Ordinary BFA
   receive/send and burn passes do not cover this event-order case.
5. **Native dependency security:** security findings in the selected Rust
   dependency graph still require disposition. A clean npm audit covers the npm
   tree and does not resolve these native findings.

## Troubleshooting

- **`Rln(Conflict)`** — the binding handles the expected already-initialized
  response during startup. Conflicts from other operations still require
  investigation; retain the operation name and full error. A VSS writer conflict
  requires stopping the other writer before explicit recovery.
- **`VssNotConfiguredError` / `VSS_NOT_CONFIGURED`** — configure an explicit
  `vssUrl` to use backup or recovery. The legacy `VssUnsupportedError` export remains
  for compatibility. For local-only operation omit the VSS URL. A writer-fence
  error requires an explicit recovery decision after stopping other writers.
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
[vls]: https://gitlab.com/lightning-signer/validating-lightning-signer
