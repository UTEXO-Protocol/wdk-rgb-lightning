# @utexo/wdk-rgb-lightning

WDK module for RGB-over-Lightning, built on [`rgb-lightning-node`][rgb-lightning-node]
(RLN) — channels, BOLT11 + RGB invoices, payments, hodl, atomic swaps,
async payments (APay), and optional VSS cloud backup.

Pairs with [`@utexo/wdk-wallet-rgb`][wdk-wallet-rgb] for the on-chain
RGB side. They share the same `rgb-lib` SQLite `dataDir`, so on-chain
balances and Lightning balances surface against the same asset records.

## Architecture

```
@utexo/wdk-rgb-lightning                    ← this package (Layer C)
       │                                       (WDK manager + account)
       ▼
[bare runtime]                  [Node runtime]
@utexo/rgb-lightning-node-bare  @utexo/rgb-lightning-node-nodejs
       │                                │
       └──────────────┬─────────────────┘
                      ▼
   rgb-lightning-node/bindings/c-ffi      ← Rust C FFI (librlncffi.a)
                      │
                      ▼
              LDK + tokio + rgb-lib
```

The package exposes one entry per runtime through `exports`:

- `import '@utexo/wdk-rgb-lightning'` from Node → `index-node.js`
- `require('@utexo/wdk-rgb-lightning')` from a bare worklet (RN) →
  `bare.js`

Both paths re-export the same `WalletManagerRgbLightning` + account
class; the only difference is the underlying binding selected at
module-load.

## Installation

```sh
npm install @utexo/wdk-rgb-lightning
# plus the runtime-matching native binding — install from the
# GitHub Release directly until the matrix-CI publish pipelines
# for these packages land (they're not on npm yet):
npm install github:UTEXO-Protocol/rgb-lightning-node-nodejs#v0.1.0-beta.8    # Node host
# or
npm install github:UTEXO-Protocol/rgb-lightning-node-bare#v0.1.0-beta.12     # Bare / RN host
```

Both bindings are declared as optional peer deps; install the one
that matches your runtime.

> **Why the `github:` install spec?** The bindings ship platform-
> specific prebuilds (7 targets for Bare, 5 for the napi binary) and
> are released as GitHub tags with the prebuilt artifacts attached.
> The npm publish pipelines for them aren't live yet, so the
> `github:UTEXO-Protocol/<repo>#v<tag>` spec is the current install
> path. Each binding's `postinstall` then downloads the matching
> prebuilt artifact from its GitHub Release. Once both bindings are
> on npm, this will collapse back to a plain `npm install
> @utexo/rgb-lightning-node-{bare,nodejs}`.

## Why a separate module from `wdk-wallet-rgb`?

`rgb-lightning-node` (RLN) runs its own LDK + rgb-lib runtime, so it
ships as its own WDK module. We run it in external-signer mode
(`NativeExternalSigner`) so the seed stays in WDK. Both modules
target the same `rgb-lib` SQLite `dataDir`, so on-chain and Lightning
views stay unified.

### Use `wdk-wallet-rgb` for asset issuance + inflation

Five ops aren't exposed here — `issueAssetNia` / `issueAssetIfa` /
`issueAssetCfa` / `issueAssetUda`, and `inflate`. Use
[`@utexo/wdk-wallet-rgb`][wdk-wallet-rgb] for those; assets issued
there are available here for channels and invoices on the shared
`dataDir`.

## Usage

```js
import WalletManagerRgbLightning from '@utexo/wdk-rgb-lightning'

const manager = new WalletManagerRgbLightning(seedPhrase, {
  network: 'regtest',
  dataDir: '/path/to/persistent/dir',
  // Optional VSS cloud backup — leave undefined to disable.
  vssUrl: 'https://vss.example.com',
  vssAllowHttp: false,
  vssAllowEmptyRestore: false
})

const account = await manager.getAccount(0)

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
  peer_pubkey_and_addr: '<pubkey>@<host>:<port>',
  capacity_sat: 1_000_000,
  push_msat: 0,
  asset_amount: undefined,
  asset_id: undefined,
  public: true,
  with_anchors: true,
  fee_base_msat: 1000,
  fee_proportional_millionths: 0
})

const invoice = await account.createInvoice({
  amount_msat: 5000,
  expiry_sec: 3600,
  description: 'demo',
  min_final_cltv_expiry_delta: 144
})

// Pay an invoice.
await account.sendPayment({ invoice: '<bolt11>' })

// Optional: register with an LSP as an async-payments recipient.
await account.apayNew('<lsp-node-id-hex>')

await manager.dispose()
```

A more complete end-to-end example — including LSP wiring, RGB asset
issuance over LN, and a regtest stack via Docker Compose — lives in
[utexo-rgb-wdk-demo].

## Security model

- **Seed never leaves the host.** The mnemonic is owned by the WDK
  secret manager. The binding derives a 32-byte BIP-32 entropy
  (`seedHex`), passes it once to `NativeExternalSigner.create`, and
  RLN persists only public identifying material (xpubs, node id,
  master fingerprint) in its key-source file. Re-deriving from the
  same mnemonic on the next launch reproduces the same `seedHex`,
  matches the on-disk key-source, and keeps the LDK node identity
  stable across restarts.
- **All channel-state crypto runs in-process** through
  [`vls-protocol-signer`][vls]. The VLS signer's lifecycle is tied to
  the binding — it's destroyed on `manager.dispose()`.
- **VSS payloads are client-side encrypted.** When `vssUrl` is set,
  channel state and RGB wallet data are mirrored to the configured
  VSS endpoint using XChaCha20-Poly1305, keyed via HKDF of a
  signing key derived from the BIP-39 mnemonic (BIP-32 path
  `m/535'/1'`). Recovery requires the original seed; the VSS server
  sees only ciphertext.
- **Plain `http://` is rejected by default.** Set `vssAllowHttp:
  true` only for loopback / development use.

## VSS recovery + fence takeover

If a previous node crashed while holding the VSS ownership fence,
restarts will fail with `Rln(VssFenceHeld)`. `account.clearVssFence(
password)` forcibly takes over. Only call this when you're certain
the previous owner is gone — pointing two live nodes at the same VSS
store corrupts state.

## Troubleshooting

- **`Rln(Conflict)` on first launch after `unlock()` returned OK** —
  expected on every re-launch after the initial wallet create. The
  binding swallows this internally; if you see it bubble up, you're
  calling the lower-level binding directly instead of going through
  the WDK account.
- **`Rln(FailedVssInit)`** — the VSS URL is unreachable or rejected
  the auth challenge. Check `vssUrl` (https vs http) and network
  reachability; for fence takeover see above.
- **Port already in use on Metro / Expo launcher** — the default VSS
  test server squats on port 8081 (Metro's default). Stop the local
  VSS container before starting Metro, or move VSS to a different
  port.
- **Channels fail to open with a fresh node** — confirm bitcoind RPC
  is reachable from inside the worklet's network sandbox; on regtest,
  set `rpcallowip=127.0.0.1/32` so loopback connections are
  accepted.

## License

Apache-2.0. See [`LICENSE`](./LICENSE).

[rgb-lightning-node]: https://github.com/UTEXO-Protocol/rgb-lightning-node
[wdk-wallet-rgb]: https://github.com/UTEXO-Protocol/wdk-wallet-rgb
[utexo-rgb-wdk-demo]: https://github.com/UTEXO-Protocol/utexo-rgb-wdk-demo
[vls]: https://gitlab.com/lightning-signer/validating-lightning-signer
