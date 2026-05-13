# @utexo/wdk-rgb-lightning

WDK module for RGB Lightning (rgb-lightning-node) — channels, invoices, payments, swaps, hodl, RGB-over-LN.

Pairs with [`@utexo/wdk-wallet-rgb`](https://github.com/UTEXO-Protocol/wdk-wallet-rgb) for on-chain RGB. They share the same rgb-lib SQLite dataDir so on-chain views stay unified.

## Status

Alpha skeleton. Layer A (rgb-lightning-node C-FFI) and Layer B
(`@utexo/rgb-lightning-node-bare`) are in place; this Layer C module
mirrors `wdk-wallet-rgb`'s structure and wires every method that doesn't
need the upstream watch-only / external-signer rework. See the inline
`✅ / 🚧 / ⏸` markers in `src/wallet-account-rgb-lightning.js` for the
per-method status.

## Architecture

```
@utexo/wdk-rgb-lightning              ← this package
        │
        ▼
@utexo/rgb-lightning-node-bare        ← bare native addon
        │
        ▼
rgb-lightning-node/bindings/c-ffi     ← Rust C-FFI (PR #25)
        │
        ▼
LDK + tokio + rgb-lib
```

## Why a separate module from `wdk-wallet-rgb`?

`rgb-lightning-node` *owns* its seed today (LDK `KeysManager` derives
from a stored mnemonic), which is incompatible with WDK's
secret-manager-owned-seed contract. Rather than fork the on-chain
module to accommodate, we ship a separate LN-only module. The two
share the same rgb-lib SQLite dataDir so balances stay unified.

Once Roman's upstream RLN update lands (watch-only + `*Begin/*End` PSBT
endpoints + remote-signer wrapper for `KeysManager`), the seed argument
will be removed from `WalletManagerRgbLightning` and a `BareSigner`
implementation will plug into the LDK signing path.

## Usage

```js
import WalletManagerRgbLightning from '@utexo/wdk-rgb-lightning'

const manager = new WalletManagerRgbLightning(seedPhrase, {
  network: 'regtest',
  dataDir: '/path/to/persistent/dir',
  password: 'wallet-password'   // RLN-owned encryption key (TEMP)
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
  description: 'test',
  asset_id: undefined,
  asset_amount: undefined
})

await manager.dispose()
```

## License

Apache-2.0
