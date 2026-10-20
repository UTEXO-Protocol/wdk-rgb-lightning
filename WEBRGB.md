# WebRGB Native Wallet Adapter

```text
dApp
  -> host-approved transport session (for example, WalletConnect)
  -> WebRgbProvider from @utexo/wdk-rgb-lightning/webrgb
  -> WalletAccountRgbLightning
  -> Node.js or Bare native binding
  -> pinned RLN / rgb-lib-bfa native graph
```

This is a wallet-side adapter, not a browser runtime. Use the existing WDK
manager/account setup in the [README](./README.md#quick-start), then initialize
and unlock the account before serving wallet requests. In React Native, the
account runs in the Bare worklet; the host must bridge approval prompts to its
UI and authorization checks to its transport session. This package does not
provide that UI, IPC protocol or transport.

The adapter implements the read/receive subset of the
[WebRGB contract](https://github.com/UTEXO-Protocol/webrgb/blob/dev/SPEC.md),
checked against `@utexo/webrgb@0.1.0`. JavaScript needs only the WDK subpath.
TypeScript consumers should additionally install the optional type peer:

```sh
npm install @utexo/webrgb@0.1.0
```

## Session Setup

Create one provider for each approved dApp session. Supply the origin from
transport metadata verified by the host, never from the dApp's method arguments.
`confirm` must display the origin, operation and parameters and resolve to
exactly `true` only after explicit approval. A missing, rejected or failed
approval cannot allocate a receive invoice.

```js
import { WebRgbProvider } from '@utexo/wdk-rgb-lightning/webrgb'

export async function connectRgbSession(account, session, approveRequest) {
  const provider = new WebRgbProvider(account, {
    origin: session.origin,
    confirm: approveRequest,
    assertAuthorized: () => {
      if (!session.active) throw new Error('Session disconnected')
    },
    minConfirmations: 3
  })

  await provider.enable() // Requests connection approval.
  return provider
}
```

For a host that already approved/restored the connection, `sessionApproved:
true` skips the connection prompt, but not invoice approval. `assertAuthorized`
is synchronous: return `undefined` on success and throw when the session is no
longer authorized. Promises and boolean results are rejected. It is checked
around asynchronous work. Call `provider.revoke()` on disconnect; create a new
provider on wallet/account/network switches. Revocation during a prompt prevents
the native call; revocation during a native read prevents its result from being
returned. It cannot undo an operation already submitted to native code.

Only dispatch methods listed in `getInfo().methods`. Reject other RPC methods
with `METHOD_NOT_SUPPORTED`; do not expose arbitrary account or provider members
to a remote caller. The transport must enforce its own origin/session binding,
request-size limits and rate limits. `revoke` is a host lifecycle method, not a
remote RPC method.

## Methods

| WebRGB | WDK/native operation | Behavior |
| --- | --- | --- |
| `enable()` | None | Approves this session; concurrent calls share a prompt. |
| `getInfo()` | Local account network | Advertises only implemented methods; `ready` means session-enabled, not synchronized/funded. |
| `getAddress()` | `account.getAddress()` | Returns `{ address }`. |
| `blindReceive(args?)` | `account.createRgbInvoice()` | Explicit approval; maps camelCase to native fields; `witness: false`. |
| `listAssets()` | `account.listAssets()` | Flattens NIA, IFA, CFA, UDA and BFA groups; BFA listing does not enable BFA validation/burn. |
| `getAssetBalance(assetId)` | `account.getAssetBalance(assetId)` | Uses `spendable`, not future balance; preserves native response in `raw`. |
| `listTransfers(assetId?)` | `account.listTransfers(assetId)` | Maps native assignment strings and transfer fields; omitted asset enumerates known assets. |
| `getTransferStatus(id, assetId?)` | Refresh, then transfer lookup | Matches transfer index, recipient ID or txid. A txid can be queried without an asset ID. |
| `decodeRgbInvoice(invoice)` | `account.decodeRgbInvoice(invoice)` | Maps tagged assignment value, recipient, network and transport endpoints. Also accepts `{ invoice }`. |

```js
const info = await provider.getInfo()
const { address } = await provider.getAddress()
const receive = await provider.blindReceive({
  // Omit assetId when receiving an asset not yet known to this wallet.
  amount: 1000000,
  durationSeconds: 86400,
  minConfirmations: 3
})
const decoded = await provider.decodeRgbInvoice(receive.invoice)

// After the incoming transfer has been accepted and its asset is known:
const assets = await provider.listAssets()
const asset = assets[0]
if (asset?.id) {
  const status = await provider.getTransferStatus(receive.recipientId, asset.id)
  const balance = await provider.getAssetBalance(asset.id)
  const history = await provider.listTransfers(asset.id)
  // balance.balance is in base units; use the asset precision for display.
}
```

All WebRGB amounts must be non-negative safe JavaScript integers; requested
receive amounts must be positive. Values too large for the protocol's number
fields fail, never round. Native WDK methods still preserve large response
integers as decimal strings. Nonfungible/inflation-right transfers do not acquire
a fabricated fungible amount. A zero/Any invoice decodes to `amount: null`.

Receive defaults to 24 hours and at least three confirmations; the host can
raise the floor, and the dApp cannot lower it. This floor does not fix upstream
RGB reorg handling. `getTransferStatus` reports native status, not independent
Bitcoin finality. Unknown-asset blind receives may not appear in asset-based
history until the transfer/asset is known: the released API cannot enumerate
unassigned pending receives. `found: false` is not evidence that an invoice was
never created. See the [release gates](./RELEASE-0.15-TRACKER.md).

`protocol: 'RGB_LN'` identifies the backend, not permission to call Lightning.
This adapter advertises no Lightning, send, issuance, burn or burn-proof methods.
The existing WDK send and consignment-export APIs remain available directly to
the host; they are not implicitly granted to a dApp. No burn journal is included.

## Protocol-1.0 invoice sends

Use `account.sendRgbInvoice({ invoice, asset_id, amount, donation, fee_rate,
min_confirmations, witness_data? })` for encrypted proxy sends. Pass the complete
invoice unchanged. Native parsing preserves its recipient public key, encryption
policy and expiry, validates asset/amount/network, and uses the sender's configured
proxy. A witness invoice additionally needs `witness_data: { amount_sat }`; native
derives proxy blinding. A blinded invoice takes no witness data. Amount and fee
accept exact positive u64 decimal strings where necessary.

The generic `transfer()` RGB route uses this complete-invoice path. It never
falls back to rebuilding an old recipient request when the binding lacks support.
`sendRgbAsset()` remains a raw native API for explicitly supported request forms;
an old recipient projection cannot supply missing protocol-1.0 keys.

## V1 burn helpers

The same subpath exports `burnDestinationFor(payout, qualifiedRoutes)`,
`validateBurnDestination(value)`, `burnDestinationHash(value)` and
`createBurnPackage(proofBytes, destination)`. These pure helpers do not invoke a
wallet, persist an operation, enable a route or burn tokens. Route construction
currently accepts explicitly qualified EVM routes only; it rejects all other
chains. The generic hash validator supports the portable V1 byte format and the
independent bridge/enclave vectors.

The hash is the `UtexoBurnDestinationV1` hashStruct commitment to destination
chain, endpoint and recipient bytes, returned as 32-byte hexadecimal without
`0x` for the native `burn_recipient`. It is not a signed-message/domain digest.
The host must validate the requested destination against wallet-owned route
policy, show it in consent and durably save its preimage **before** invoking
native burn. Carry the same metadata through WalletConnect results and saved
transfer lookup. Advertise V1 routes only after qualification.

`createBurnPackage` wraps an already saved binary RGB Transfer proof and the V1
destination in one versioned `.utexoburn` JSON file, preserving exact bytes and
canonical Base64. Its proof limit is 10 MiB. Export failure must never trigger
another burn. A matching transaction ID alone does not reconcile an ambiguous
native outcome; independent proof validation is still required.

## Errors

Catch `error.code`, not native message text. The adapter uses `NOT_ENABLED`,
`USER_REJECTED`, `INVALID_PARAMS`, `ASSET_NOT_FOUND`, `METHOD_NOT_SUPPORTED` and
`INTERNAL_ERROR`. Native failures are sanitized so local paths and backend
credentials are not disclosed to dApps. Error serialization preserves code and
message without a native cause. Transport serialization must preserve the code.

Mainnet Lightning restrictions apply separately at the WDK account layer as
`LIGHTNING_DISABLED_ON_MAINNET`. Signet/testnet/regtest retain their account
Lightning APIs; the WebRGB subset is identical on every network.
