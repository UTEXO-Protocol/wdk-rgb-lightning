# Changelog

All notable changes to `@utexo/wdk-rgb-lightning` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
while pre-`1.0`.

## [Unreleased]

### Added
- **First-class read-only account:** exported
  `WalletAccountReadOnlyRgbLightning extends WalletAccountReadOnly`, with
  all seven mandatory WDK reads plus node, channel, peer, invoice, payment,
  RGB asset/transfer, BTC history, fee, media, and endpoint queries.
  `toReadOnlyAccount()` caches it and supplies an immutable query-only
  adapter with no full-account backreference or mutating capabilities.
- Native-backed Lightning message verification and explicit receive-address
  rotation. `verify(message, signature)` is now implemented; `rotateAddress()`
  remains available only on the full account.
- `AccountLockedError` (`ACCOUNT_LOCKED`) and `getAddressState()` for UI code
  that needs a non-throwing locked/ready address state.
- Txid-filtered `getTransactionsByTxid()` and `listTransfersByTxid()` reads,
  used by `getTransactionReceipt()` to distinguish confirmed, pending, and
  absent operations.
- Correct, versioned signer entropy derivation. New nodes use the first 32
  bytes of WDK's normalized BIP-39 seed. `nodeSeedDerivation: 'auto'` retries
  the exact legacy beta derivation only after RLN reports a persisted signer
  identity mismatch, preserving existing node identities.
- **`UtexoLsp` composed-flow class** (`src/utexo-lsp.js`) — brings the
  LSP surface to parity with `@utexo/rgb-sdk-rn`'s `UtexoLsp`. A
  stateful orchestration object over an account + `LspClient` covering
  the full lifecycle: `connect`, `waitForChannel`, `receiveAsset`,
  `awaitReceiveSettlement`, `waitForOutboundLiquidity`, `sendAsset`,
  `payAddress`, `enableLightningAddress`, and `claimPendingPayments`.
  All poll loops accept `WaitOptions` (`timeoutMs`, `pollIntervalMs`,
  `signal`, `onProgress`, `onEachPoll`). Construct via
  `account.createLsp(peer?)` — the no-arg form auto-discovers the peer
  from the wallet's `lspBaseUrl`. Also exports `LspChannelTimeoutError`,
  `LspSettlementError`, `peerUri()`, and `normalizeReceiveStatus()`.
- **`LspClient.resolveAddress(username, amtMsat, opts)`** — full LUD-06
  resolution (discovery + callback) routed through the LSP's `baseUrl`,
  with the callback URL rewritten onto the base origin so the second hop
  inherits the client's retry/timeout rails and survives an LSP that
  advertises an internal/emulator host (e.g. `10.0.2.2`). Mirrors
  `rgb-sdk-rn`'s `UtexoLSPClient.resolveAddress`.
- **`LspClient.getLightningAddressByPubkey(pubkey, opts)`** — reads back
  the auto-assigned `{ username, domain }` the LSP minted for a node
  pubkey (post-`apayNew`). The one raw-client endpoint we were missing.
- **`account.createLsp(peer?, peerPort?)`** + **`account.getLspConfig()`**
  — factory for `UtexoLsp` and a read of the `lspBaseUrl`/
  `lspBearerToken` the node was constructed with.
- **`account.createHodlInvoice(params)`** — named convenience over
  `createInvoice({ payment_hash })`, returning `{ bolt11, paymentHash }`.
  Parity with `rgb-sdk-rn`'s `createHodlInvoice`.
- TS declarations extended for all of the above (`UtexoLsp`, `LspPeer`,
  `WaitOptions`, `ReceiveStatus`, `ChannelReadyInfo`,
  `CreateHodlInvoiceParams`, the LSP timeout/settlement error classes, etc.).
- **`virtualPeerPubkeys` config** — plumbed through manager → binding →
  init request (`virtual_peer_pubkeys`). Required (together with
  `enableVirtualChannelsV0`) for async-payments against a production
  LSP: every mobile client must list the LSP's node_id so RLN's
  `allows_peer` accepts the `trusted_no_broadcast` virtual channel.
  Per Yurii's Signet LSP setup. The native layer already accepted the
  field via the init JSON, so no native rebuild; forwarded only when a
  non-empty array. Also documents `virtual_open_mode:
  'trusted_no_broadcast'` on `openChannel` and the 3_000_000-msat RGB
  HTLC minimum (`MIN_AMT_MSAT`).
- **TypeScript declarations.** Ship a hand-authored `index.d.ts`
  covering the full public surface (manager, account, bindings,
  errors, `LspClient`, LNURL + LSP helpers) and wire it via the
  `types` field + the `types` condition in the `exports` map. The
  package previously shipped no types; consumers now get IntelliSense
  + type-checking. Verified with `tsc --strict` (internal + consumer
  resolution under `nodenext`).
- **Typed error hierarchy** (`src/errors.js`): `RgbLightningError`
  (base, with `code` + `cause` + `toJSON()`) and `UnlockError`,
  `AccountLockedError`, `VssError`, `VssNotConfiguredError`, `ApayError`,
  `NotImplementedError`. `unlock`, locked address reads, `clearVssFence`,
  `vssBackup`, `apayNew`, `bootstrapLsp`, and `signTransaction` now throw
  these instead of bare `Error`, so callers branch on `err.name` /
  `err.code` rather than substring-matching `Rln(...)` strings. The
  original RLN message is preserved verbatim and attached as `cause`,
  so existing substring checks keep working.
- `account.vssStatus()` — local-view VSS status
  (`{ configured, url, allowHttp, lastBackupVersion }`) with no server
  round-trip. (RLN's C-FFI has no read-only server-side backup-info
  query; call `vssBackup()` for a live version.)
- `account.createLightningInvoice(request)` — cross-SDK alias for
  `createInvoice` (matches `@utexo/rgb-sdk-rn`'s naming), accepting
  either the native snake_case request or a camelCase convenience
  shape.

### Fixed
- WDK conformance for `index`, `path`, `keyPair`, `sign()`, `getBalance()`,
  `getTokenBalance()`, `sendTransaction()`, quotes, and confirmed receipt
  semantics. Balance failures are no longer silently converted to zero unless
  the node is actually locked.
- Removed the synthetic pre-unlock Bitcoin address. `getAddress()` now either
  returns RLN's stable current address or raises `AccountLockedError`.
- WDK bindings now force RLN's pinned-address mode, so inherited read-only
  `getAddress()` calls do not allocate a fresh address each time; explicit
  rotation remains a full-account command.
- Aligned exactly with the current `@tetherto/wdk-wallet@1.0.0-beta.14`
  architecture and added strict declaration checks to build/release CI.
- Automatic releases wait for both minimum native peer versions to be
  available from npm before bumping or publishing the WDK package.
- Removed a duplicate `apayNew` method definition in both
  `node-binding.js` and `bare-binding.js` (the shadowed first copy
  used `this.node`, which throws pre-unlock).
- Consolidated LSP wire-shape and uint conversion helpers. Fractional,
  unsafe, negative, and overflowing uint values now fail predictably;
  `lightningReceive()` sends the documented default RGB assignment `Any`.
- Hardened Lightning Address resolution: generic flows reuse the shared
  LNURL implementation, constrain callbacks to the discovery host by
  default, and never resolve an external domain as a same-named LSP user.
- Removed the binding `node` getter in favor of consistent `ensureNode()`
  access. Bare and Node bindings now retain signer seeds in zeroizable
  buffers and wipe both current and #26 legacy-fallback material during
  replacement, successful unlock, and shutdown failure paths.
- `waitForOutboundLiquidity()` now throws `LspLiquidityTimeoutError` when
  its deadline expires instead of resolving without the requested capacity.

### Changed
- README: tightened the *"Why a separate module from `wdk-wallet-rgb`?"*
  section. Added a *"Use `wdk-wallet-rgb` for asset issuance +
  inflation"* subsection pointing at the on-chain module for the five
  ops not exposed here (`issueAssetNia/Ifa/Cfa/Uda`, `inflate`). Both
  modules target the same `rgb-lib` SQLite `dataDir`, so assets
  issued via `wdk-wallet-rgb` are available here for channels and
  invoices. No code changes.

## [0.1.0-beta.2] — 2026-06-01

Wires up `account.vssBackup()` end-to-end + ships the LspClient
production hardening from the Unreleased section.

### Changed
- Peer-dep floors raised:
  - `@utexo/rgb-lightning-node-bare` → `^0.1.0-beta.12`
  - `@utexo/rgb-lightning-node-nodejs` → `^0.1.0-beta.8`
  Both ship the new `sdkNodeVssBackup` C-FFI wrapper so
  `account.vssBackup()` resolves at runtime.

### Added
- `account.bootstrapLsp({ peerPubkeyAndAddr, hostNodeId,
  waitForPeerMs, pollIntervalMs })` — opt-in one-shot LSP
  bootstrap. Connects the peer, polls `listPeers` until the noise
  handshake settles, then calls `apayNew`. Replaces the manual
  three-call sequence and addresses Renat's May 27 dev-plan items 3
  + 4 (connectPeer + apay/new during SDK init).
- `account.vssBackup()` — force an immediate VSS backup flush.
  Returns `{ version }` of the snapshot just persisted. For app-
  controlled checkpoints (e.g. fsync-before-suspend). Backed by
  upstream `vss_backup()` UniFFI; requires the C-FFI patch series
  at `rgb-lightning-node-bare/patches/` to be applied before the
  static lib is built.
- `LspClient` production hardening:
  - HTTPS enforcement: rejects `http://` for non-loopback hosts
    unless `allowHttp:true` is set (mirrors the `vssAllowHttp`
    pattern).
  - Retry + exponential backoff on 502/503/504/429 for idempotent
    methods (GET/HEAD/OPTIONS/PUT/DELETE). POST endpoints fail-fast
    until utexo-lsp grows idempotency-key support.
  - `LspError` now parses `{error, code, name}` from the response
    JSON body — exposed as `err.errorBody`, `err.errorCode`,
    `err.errorTag` so callers can match on structured fields
    rather than substring-match the message.
  - Per-call `timeoutMs` override on every method (e.g.
    `health({ timeoutMs: 2000 })`).
  - `onchainSend()` + `lightningReceive()` responses normalized
    to camelCase (`{lnInvoice, rgbInvoice, mappingId}`); raw
    snake_case fields preserved on the same object for backward
    compatibility.

### Fixed
- Duplicate `apayNew` method on `WalletAccountRgbLightning` — the
  second definition shadowed the first; same implementation, only
  the docstring differed. Consolidated into a single definition.

## [0.1.0-beta.1] — 2026-06-01

First public beta. Status promoted from alpha; README, LICENSE, and
CHANGELOG brought to beta quality.

### Added
- LSP client surface (`LspClient`, `LnurlPay`, helpers) for routed
  Lightning Address payments and RGB-over-LSP deposits.
- `clearVssFence(password)` and VSS init options (`vssUrl`,
  `vssAllowHttp`, `vssAllowEmptyRestore`) on the wallet manager.
- `apayNew(hostNodeId)` for receiver-side async-payments (APay)
  registration against an LSP (upstream RLN PR #51).
- `min_final_cltv_expiry_delta` documented on `createInvoice`.
- Apache-2.0 `LICENSE` file.
- This `CHANGELOG.md` (Keep a Changelog format).

### Changed
- Peer-dep floors raised to the validated bindings: `^0.1.0-beta.11`
  for `@utexo/rgb-lightning-node-bare` and `^0.1.0-beta.7` for
  `@utexo/rgb-lightning-node-nodejs` — the versions this beta was
  exercised against (47/59 Node E2E baseline, iOS sim parity on
  iPhone 17 Pro Max).
- README expanded to beta depth: install matrix, end-to-end example
  with VSS + APay, security model section, troubleshooting.

## [0.1.0-alpha.2] — 2026-05-20

### Added
- Extended `IWalletAccount` surface to cover the full RLN method set
  (PR #5).

## [0.1.0-alpha.1] — 2026-05-20

### Changed
- Refactored the binding interface to support a Node target alongside
  the Bare worklet target — same JS surface, two underlying addons.

## [0.1.0-alpha.0] — 2026-05-13

### Added
- Initial WDK manager + account integration on top of
  `rgb-lightning-node`'s external-signer path. Host owns the BIP-39
  mnemonic; the binding derives a 32-byte BIP-32 seed and wires it
  to `NativeExternalSigner`.
