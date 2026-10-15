# @utexo/wdk-rgb-lightning

[![Built with WDK](./assets/built-with-wdk.png)](https://github.com/tetherto/wdk)

WDK module for RGB-over-Lightning, built on
[`rgb-lightning-node`][rgb-lightning-node] (RLN). It runs a full LDK +
`rgb-lib` Lightning node behind WDK's wallet-manager/account contract and
adds BTC/RGB on-chain transfers, channels, BOLT11 + RGB invoices, payments,
HODL invoices, async payments (APay), optional VSS cloud backup, and an LSP
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

> Status: unpublished `0.2.0-beta.4` candidate targeting RLN `v0.17.0-beta.3`.
> Not approved for production rollout. See [RELEASE-0.15-TRACKER.md](./RELEASE-0.15-TRACKER.md).
> Current verification and release decisions: [PRODUCTION-GATES.md](./PRODUCTION-GATES.md).

## Upgrade Restrictions

This breaking line requires the exact RLN `v0.17.0-beta.3` source
`ecc69f20308231400561f6f060fea88acfa40cc4`, rust-lightning
`79b9eb5166546c62692d3a672986f385c7fe047d`, and rgb-lib
`v0.3.0-beta.50-bfa` (`1b951af0c8233308c919975552487be19ad2a930`).
Install the exact native candidate `0.2.0-beta.4` for your runtime. Its compiled
source, adapter and capabilities are checked before native handles are created;
an older beta.3 artifact is rejected. Both native peers and all three Bare data
companions are published and independently verified. Fresh public Bare installs
pass normal, omitted-optional and ignored-script/manual-recovery qualification,
including all four packages' cryptographic checks. WDK itself is unpublished. See [RELEASING.md](./RELEASING.md) for the exact release status.

Upstream's new BFA Lightning support does not change Iris's on-chain-only scope
or add a WDK BFA channel guarantee. Native artifacts and funded/runtime tests
must be qualified for this graph; earlier results retain their recorded identity.

This candidate is scoped to fresh wallets: the deployment owner confirmed there
are no live wallets to migrate. No legacy-wallet migration compatibility is
promised. Channel and signer durability still matter for newly created wallets.
Never delete or recreate state to bypass refusal, or roll back stale channel state
after activity.

There is no snapshot/FullSync overlay, prepared-send/UTXO inventory, native
operation control, address receipt or VSS delete-all API. Native
routing fee caps are unavailable and are rejected before payment submission.
Contract and transfer-consignment metadata import APIs are included upstream
(PR #128); no import backport is used. They validate asset identity and
never credit funds; normal receive/settlement remains required.
Current overlay-dependent app versions cannot adopt this line unchanged.

Native JSON integer inputs must fit `Number.MAX_SAFE_INTEGER`; larger input
numbers fail before submission. Response integers outside the safe range are
preserved as exact decimal strings, including u64 limits and channel IDs; they
are never rounded first. This does not enable full-u64 request amounts.
Refresh preserves per-batch status/failure details, and unspents
preserve `utxo.exists`, including false, and `pending_blinded`. Both are required;
an absent reservation count is not treated as zero. No spendability is inferred
from absence.

Current RLN 0.17 verification and release gates are recorded in
[the release tracker](./RELEASE-0.15-TRACKER.md). The earlier
[qualification report](./tests/regtest/QUALIFICATION.md) records RLN 0.13, not
qualification of these artifacts. Strict outgoing signing, same-process reopen,
RGB reorg safety and Lightning recovery remain gates. Android requires the
byte-preserving packaging integration described below; raw `bare-link` output
is not supported for this candidate.
Permissive regtest diagnostics are not production qualification.

Earlier qualified RGB-lib graphs did not revisit settled transfers during refresh: after a
one-confirmation RGB transfer is disconnected by a reorg, `getAssetBalance`
continues reporting its units as settled/spendable, even after cold restart.
Until exact-source requalification closes P03, these fields are **not a reorg-safe
current-confirmation guarantee**. The earlier upstream limitation was not
repaired by this package. The historical tests do not
demonstrate permanent asset loss or every reorg/conflicting-spend case.

The upgrade does not establish the integrator's zero-channel root cause.
`waitForChannel` polls; provisioning needs server-side evidence. Physical-device
runs, native Rust TLS, prolonged suspension and full justice/commit-boundary fault
matrices are not implied by the recorded passes.

## Contents

- [Architecture](#architecture)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Account API](#account-api)
- [Error handling](#error-handling)
- [Mainnet policy and capabilities](#mainnet-policy-and-capabilities)
- [WebRGB integration](#webrgb-integration)
- [LSP integration](#lsp-integration)
- [VSS cloud backup](#vss-cloud-backup)
- [Async payments (APay)](#async-payments-apay)
- [Security model](#security-model)
- [Testing and local development](#testing-and-local-development)
- [Troubleshooting](#troubleshooting)
- [License](#license)

## Mainnet policy and capabilities

RLN disables Lightning **on mainnet only**. Account channel, peer, invoice
(including BOLT11 decoding), payment, HODL, APay and onion-message methods reject
with `LightningDisabledError`, code `LIGHTNING_DISABLED_ON_MAINNET`, before
native execution. Lightning recipients in `transfer` and `quoteTransfer`,
wallet-connected LSP methods and standalone account-taking LSP helpers use the
same policy before HTTP side effects. Read-only accounts follow it too.

Signet, testnet and regtest retain their Lightning APIs; availability is not a
claim that their recorded release gates are resolved. BTC/RGB on-chain methods,
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
readiness, balance or successful qualification. `getBfaCapabilities()` returns
`{ bfa: true, burn: true, consignment: true }` on a full account. The read-only
facade reports `burn: false` in both capability methods and has no `burnAsset`.
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
Consignment export uses the existing account API. Historical
[BFA qualification and RN comparison](./BFA-QUALIFICATION.md) results apply to
their recorded source, not automatically to this new native graph.

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

The runtime gate requires the exact new source/adapter identity plus
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

The `0.2.0-beta.4` candidate consumes the reviewed **main** sources recorded in
[`native-peer-sources.json`](./native-peer-sources.json): Bare
`8b692da2e896e8acfef2bf15b1e501103100c070` (lifecycle PR #22 and distribution PRs #24/#25)
and Node `04b641dce121ac690d5d0866eeba4fa76aebe7a5` (Node PR #24).
Bare #25 merged after both contract CI jobs passed in
[run 38768896810](https://github.com/UTEXO-Protocol/rgb-lightning-node-bare/actions/runs/38768896810).
Published packages retain two exact optional npm peers. Prefer the published
native versions once their registry verification is complete. The commands below
apply after the selected native binding and this WDK version are published.

```sh
npm install @utexo/wdk-rgb-lightning@0.2.0-beta.4

# Plus the native binding matching your runtime (optional peer deps):
npm install @utexo/rgb-lightning-node-nodejs@0.2.0-beta.4   # Node host
# or
npm install @utexo/rgb-lightning-node-bare@0.2.0-beta.4     # Bare / React Native host
```

Both bindings are declared as **optional** peer dependencies — install only
the one for your runtime after publication. Bare itself requires three data
packages at exact version `0.2.0-beta.4`; they are not additional WDK peers:

| Required Bare dependency | Targets |
| --- | --- |
| `@utexo/rgb-lightning-node-bare-ios` | iOS device and both simulator slices |
| `@utexo/rgb-lightning-node-bare-android-arm` | Android ARMv7 and ARM64 |
| `@utexo/rgb-lightning-node-bare-android-x64` | Android x64 |

npm installs all three on every host, including when optional dependencies are
omitted. The wrapper contains Darwin only. Its postinstall admits every data
package and all hashes before copying six mobile files into the canonical
prebuild paths, then verifies all seven targets. The data packages have no hooks,
executable entry points, dependencies or platform filters. All seven compiled
files and 13 native build/runtime inputs remain unchanged.

The already-published iOS package stays at source
`15b0ff68d1b59fa88131cfb9be6fe48c30287e6b`, publication
[run 38762929465](https://github.com/UTEXO-Protocol/rgb-lightning-node-bare/actions/runs/38762929465),
with immutable integrity
`sha512-BOfizU4fqvGyl4L2Q0YAikLEYGyOBDYQikYPPR7IgxnmKrddm3T1/Lv0YnQeYt1EsBOf2SGyLNJKOLaWOglrkg==`.
The wrapper and new Android packages use the subsequently reviewed final main.
Their package sources and real publication builders remain distinct from the
original native build; splitting distribution does not claim a rebuild.

Packed Bare installation fails if any required payload or identity is missing or
incorrect; it does not fall back to a private source build. If install scripts
were skipped, assemble and verify the installed package before bundling:

```sh
npm --prefix node_modules/@utexo/rgb-lightning-node-bare run hydrate-native
```

Complete verified native artifacts and clean consumer installs remain release
gates. Standalone Bare requires >=1.33.0. See each binding's README for native
prerequisites. The parser-only
`@utexo/wdk-rgb-lightning/lsp-info` entry is pure JS.

npm 12 requires approval before dependency install scripts run. Review and
authorize the exact native package source; a registry `name@version` grant does
not authorize a local tarball, which needs its exact file-source grant. The
nonpublishing packed-consumer canaries in [RELEASING.md](./RELEASING.md) apply
that restricted policy and require successful native artifact admission.

Source builds require authorized access to private upstream BFA repositories,
Rust 1.94.0, Git, CMake and the target SDK/toolchain. A Bare source build starts
from an explicit checkout; installing a Git dependency is not a substitute for
preparing the complete split distribution:

```sh
git clone https://github.com/UTEXO-Protocol/rgb-lightning-node-bare.git /absolute/bare-main
cd /absolute/bare-main
git checkout --detach 8b692da2e896e8acfef2bf15b1e501103100c070
npm ci --ignore-scripts
# With the documented native SDKs and ORG_READ_TOKEN configured:
node scripts/with-source-access.js npm run prepare-native -- --platform all
npm run stage:payloads
npm run check:distribution
```

The complete Bare release target set requires macOS with the iOS SDK and Android
NDK. Follow the native README to pack and verify all four archives; a local
consumer must install all three actual payload archives alongside the wrapper,
not depend on the repository's workspace links. The archive gate bounds each new
upload to 128 MiB and requires the existing 146,197,231-byte iOS archive to match
its immutable public SRI. Node source preparation follows its
own [pinned README](https://github.com/UTEXO-Protocol/rgb-lightning-node-nodejs/blob/04b641dce121ac690d5d0866eeba4fa76aebe7a5/README.md).
Neither build nor pack instructions publish a package.

The PR's `Verify merged native main sources` check fetches `main`
from both repositories and rejects a different commit, graph or dirty checkout.
To repeat that source check locally with exact main checkouts:

```sh
npm run check:native-sources -- --bare-dir /absolute/bare-main --node-dir /absolute/node-main
```

For Android, use `react-native-bare-kit@0.15.5` and apply the native package's
[Android staging hook](https://github.com/UTEXO-Protocol/rgb-lightning-node-bare/blob/main/android/README.md)
in the root Android Gradle build. The hook verifies the pinned original addon
and packages it without the ELF rewrite that damages RELRO/DYNAMIC protection.
Installing WDK or its Bare peer does not apply this hook automatically. This
integration supports ARM64, ARMv7 and x86-64; it does not change WDK APIs or
RLN's source revision. Validate the final app artifact and runtime separately.

Saved transfer consignments can be exported without exposing native paths:

```js
const bytes = await account.getConsignment(assetId, transactionId) // Uint8Array
```

This reads a consignment already stored by RLN. It does not construct a new
transfer or replace the receive/validation/settlement flow.

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
| `vssUrl` / `vssAllowHttp` / `vssAllowEmptyRestore` | — | VSS cloud backup; see [below](#vss-cloud-backup). |
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
| RGB invoices/transfers | `createRgbInvoice(request)`, `decodeRgbInvoice(invoice)`, `sendRgbAsset(request)`, `getAssetMedia(digest)`, `postAssetMedia(request)` |
| RGB burn | `burnAsset({ asset_id, amount, burn_recipient?, fee_rate, min_confirmations })` returns `{ txid, batch_transfer_idx }`; no automatic retry or bridge payout |
| RGB issuance (unsupported in this mode) | `issueAssetNia(request)`, `issueAssetUda(request)`, `issueAssetCfa(request)`, `issueAssetIfa(request)`, `inflate(request)` forward the released `UnsupportedInExternalSignerMode` error; use a separate on-chain wallet |
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
  it rejects with `AccountLockedError` unless `autoUnlockRequest` is configured; UI loaders can call
  `getAddressState()` for `{ status: 'locked', address: null }`. The WDK
  bindings default to `reuseAddresses: true`. `rotateAddress()` advances and
  reveals the next address before returning it. Fresh wallets can explicitly
  set `reuseAddresses: false`; WDK caches the current receive address within the
  account session so repeated `getAddress()` calls remain stable. Use
  `getNewAddress()` to allocate a new receive address under either policy.
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

Low-level `LspClient` methods do not authorize local payments. In particular,
`lightningSend` can create a server-side HODL quote; it is not a read-only query
or a fee-capped wallet payment. The endpoint must be enabled by the LSP operator.
Higher-level linked-asset payment execution remains excluded from this candidate.
For bridge helpers, a verified Lightning payment is not proof that the RGB delivery
leg settled; monitor that leg independently.

The WDK Bare entry requires Bare >= 1.33.0 with current dependency resolution
(`bare-thread` requires that engine). Its packed desktop canary pins 1.33.0.
The standalone native binding's 1.30.3 canary does not qualify the complete WDK
dependency graph or a React Native worklet. Qualify the app's embedded runtime
and dependency lock separately before adoption.

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
