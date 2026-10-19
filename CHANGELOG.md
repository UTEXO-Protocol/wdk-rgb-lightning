# Changelog

All notable changes to `@utexo/wdk-rgb-lightning` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
while pre-`1.0`.

## [Unreleased]

### Added

- Explicit BIP-322 simple Bitcoin message proofs through
  `getMessageSigningAddress()`, `signMessageBip322(message, address)` and
  read-only `verifyMessageBip322(message, address, signature)`. Signing uses the
  native signer's first vanilla BIP86 address, verifies ownership and emits the
  v2 `smp` prefix without broadcasting. Messages retain their exact UTF-8 bytes,
  with a 4096-byte bound and rejection of unpaired UTF-16 surrogates.
- Runtime BIP-322 capability detection, public offline P2TR/P2WPKH verification,
  strict native result validation and signing-operation drain before shutdown.
  Existing Lightning node-identity `sign()` / `verify()` semantics are unchanged.

### Changed

- Follow the maintained native peers' merged `main` sources: Bare
  `338d94e2ce5a1c2865296edf32f6c061ce0be175` and Node
  `3ccfdc72c8620a35871bddffd1f44d1dd0a9954e`. Their trees match the qualified
  BIP-322/VSS-containment feature heads. Published beta.4 artifacts do not contain
  these unpublished extensions; exact source/artifact admission remains required.

### Security

- Disable VSS backup, recovery and fence takeover pending upstream fixes for
  public-derived external-signer credentials and unsafe chunked snapshot
  replacement. Supplied VSS URLs fail before native creation with
  `VssUnsupportedError` / `ERR_VSS_UNSAFE_UPSTREAM`; no unsafe override, scheduler
  or automatic fence deletion is introduced.
- Require the exact compiled `vss-safety-policy-v1` capability and disabled-policy
  metadata. Advertise unavailable backup/recovery capabilities and local disabled
  status, without treating old checkpoint evidence or mixed upload counters as
  proof of remote health or complete recovery.

## [0.2.0-beta.4] — 2026-10-16

This breaking beta consolidates the changes developed under the unpublished
0.2.0-beta.1, beta.2 and beta.3 candidates.

### Breaking changes

- Require exact native peers `@utexo/rgb-lightning-node-bare@0.2.0-beta.4`
  or `@utexo/rgb-lightning-node-nodejs@0.2.0-beta.4` for the selected runtime.
  Verify compiled source, adapter and capabilities before creating native handles;
  preceding native graphs are rejected.
- Adopt RLN `v0.17.0-beta.3` (`ecc69f20308231400561f6f060fea88acfa40cc4`),
  rust-lightning `79b9eb5166546c62692d3a672986f385c7fe047d` and rgb-lib
  `v0.3.0-beta.50-bfa` (`1b951af0c8233308c919975552487be19ad2a930`).
- Replace the former custom runtime behavior with the released API. Snapshot/
  FullSync, prepared-send/UTXO inventory, custom operation control, address
  receipts, VSS delete-all and native routing fee caps are unavailable; unsupported
  controls fail before submission. Existing overlay-dependent applications need
  integration changes. Legacy wallet/channel migration is not qualified.
- Enforce upstream mainnet Lightning rejection before native or HTTP work with
  `LIGHTNING_DISABLED_ON_MAINNET`. Mainnet on-chain APIs and non-mainnet
  Lightning APIs retain their documented availability and qualification scope.

### Added

- Typed `burnAsset(request)` on full accounts, with exact u64 decimal-string
  amount/fee inputs and one native submission. Read-only accounts expose no burn
  operation. There is no automatic retry, bridge payout or operation journal.
- Optional `eth_rpc_url` on external unlock for native BFA event validation.
  Omitted or null values retain non-BFA behavior; endpoint and chain identity
  remain application responsibilities.
- `getConsignment(assetId, txid)` on full and read-only accounts, returning
  exact bytes. Upstream contract/transfer metadata imports validate identity
  without crediting funds or replacing normal receipt settlement.
- Optional transport-neutral WebRGB receiving/read adapter, with session
  approval, revocation checks, strict request mapping and sanitized errors.
  The optional type peer supports the unchanged `@utexo/webrgb@^0.1.0` subset;
  it does not add a browser node, WalletConnect transport or remote burn API.
- Local network, lifecycle and signer-aware capability reporting, plus typed
  parser-only LSP discovery and address-attested APay registration.
- UMA-form Lightning Address normalization (`$name@example.com` to
  `name@example.com`) and the corresponding normalization/parser exports.

### Fixed

- Normalize canonical and supported flat unlock settings, reject ambiguous
  configuration, and use persistent strict external signing. Serialize activation,
  receive-address allocation and teardown.
- Drain the node before revoking its signer. Retain failed account/default-signer/
  registered-signer cleanup ownership for explicit retries without repeating
  completed cleanup. Native beta.4 provides terminal signer shutdown and owned
  session task/listener cleanup.
- Preserve exact response integers outside JavaScript's safe range, per-batch
  refresh failures, `utxo.exists` (including false) and `pending_blinded`.
  Ordinary numeric request inputs reject unsafe integers; the typed burn boundary
  additionally accepts full-u64 decimal strings.
- Validate LSP/LNURL response amounts, usable single-channel liquidity, terminal
  cancellation, Lightning Address/invoice mapping and local invoice decoding
  before convenience-helper payments. Linked-asset auto-quoting is not added.
- Validate exactly the two native release peers independently of optional WebRGB,
  checking their reviewed main sources and declared native graph.

### Native distribution and release tooling

- Consume reviewed main sources: Bare `8b692da2e896e8acfef2bf15b1e501103100c070`
  and Node `04b641dce121ac690d5d0866eeba4fa76aebe7a5`.
- Bare requires exact-version iOS, Android ARMv7/ARM64 and Android x64 data
  packages. Its Darwin wrapper validates all three payloads before restoring six
  mobile paths and verifying all seven targets. Missing/corrupt payloads fail
  without a private source-build fallback; ignored-script installs have an
  explicit hydration route. Distribution splitting preserves the original native
  binaries and compilation provenance.
- Build reproducible tarballs from clean committed source with the exact Git
  identity stamped only in staging. npm 12 consumer canaries authorize exact
  native sources, require observed postinstall admission and reject script-policy
  bypasses. The release workflow includes this version's curated changelog entry
  in its GitHub notes alongside package metadata and generated changes.

### Known limitations

- Interrupted BTC sends can leave reservations requiring recovery (P02).
- RGB settled/spendable accounting can remain stale after a Bitcoin reorg (P03).
- Incoming witness receipts can be double-counted in pending projections before
  settling to the correct amount (P04).
- An earlier wrong-amount BFA lock can cause a later valid mint to fail (P06).
- Native dependency security review remains open (D01). Passing the production
  npm audit does not establish a clean Rust dependency audit.
- Recorded host and iOS 27 Debug regtest passes have their stated scope;
  optimized mobile Release, remaining platform/public-network qualification,
  redistribution/notices and recovery gates remain as recorded. VSS/device-loss
  and general channel recovery are not qualified by those passes.

This is an experimental beta, not a production-readiness claim. See
[PRODUCTION-GATES.md](https://github.com/UTEXO-Protocol/wdk-rgb-lightning/blob/v0.2.0-beta.4/PRODUCTION-GATES.md)
for exact evidence, supported scopes and unresolved items.

## [0.1.0-beta.15] — 2026-07-23

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
- Consolidated LSP wire-shape and uint conversion helpers. Fractional,
  unsafe, negative, and overflowing uint values now fail predictably;
  `lightningReceive()` sends the documented default RGB assignment `Any`.
- Hardened Lightning Address resolution: generic flows reuse the shared
  LNURL implementation, constrain callbacks to the discovery host by
  default, and never resolve an external domain as a same-named LSP user.
- Removed the binding `node` getter in favor of consistent `ensureNode()`
  access. Bare and Node bindings now retain signer seeds in zeroizable
  buffers, wipe fallback material when it is superseded or no longer needed,
  wipe replaced primary material after fallback recovery, and wipe all retained
  material during shutdown even when native cleanup fails.
- `waitForOutboundLiquidity()` now throws `LspLiquidityTimeoutError` when
  its deadline expires instead of resolving without the requested capacity.

### Changed
- Aligned the manager, writable account, read-only account, and declarations
  with `@tetherto/wdk-wallet@1.0.0-beta.14`, including structural type checks
  in build and release CI.
- Updated native peer requirements to
  `@utexo/rgb-lightning-node-bare >=0.1.0-beta.14 <0.2.0` and
  `@utexo/rgb-lightning-node-nodejs >=0.1.0-beta.10 <0.2.0`.
- Aligned `bare-node-runtime` with WDK Core at `^1.5.0`, producing one
  deduplicated runtime tree for consumers.
- Restricted the npm tarball to the public runtime, types, license, changelog,
  and README, with clean-install and native-binding smoke validation.
- Replaced the direct-push release job with a reviewed, tag-driven pipeline
  that validates native peers, package integrity, npm provenance, registry
  installation, and the immutable GitHub release artifact.
- Scoped the blocking release audit to production dependencies while retaining
  lint, type, coverage, package-content, and native smoke validation for the
  dev toolchain used to build the release.
- Documented the account's forwarded node-level issuance and inflation calls
  while identifying `@utexo/wdk-wallet-rgb` as the supported path for
  issuance-focused flows and clarifying that the two modules own separate
  wallet state and `dataDir` values.

## [0.1.0-beta.14] — 2026-06-19

### Added
- TypeScript vocabulary for native payment discriminants, RGB invoice and send
  requests, binding lifecycle methods, LSP bridge responses, and terminal
  settlement errors.

### Fixed
- Generic RGB `transfer()` now decodes the invoice and constructs RLN's nested
  `recipient_groups` request with the required assignment and transport
  endpoints instead of sending the rejected legacy flat shape.
- Corrected public declarations and request documentation for RLN payment,
  keysend, RGB invoice, and RGB send wire formats.

## [0.1.0-beta.13] — 2026-06-19

### Fixed
- `getTransactionReceipt()` now queries RLN's `Outbound`,
  `InboundAutoClaim`, and `InboundHodl` payment discriminants instead of the
  obsolete `sent` and `received` values.

### Changed
- Expanded the unit suite across the wallet account, bindings, LSP client,
  LNURL, transfer routing, and composed LSP flows.

## [0.1.0-beta.12] — 2026-06-18

### Removed
- Removed unsupported RGB issuance and inflation methods from the public
  declarations and documentation. Asset creation belongs to
  `@utexo/wdk-wallet-rgb`.

### Changed
- Release automation now marks the newly published package as the latest
  GitHub release.

## [0.1.0-beta.11] — 2026-06-18

### Changed
- Updated WDK Core to `@tetherto/wdk-wallet@1.0.0-beta.10`.
- Added the Jest unit suite and coverage execution to build and release CI.
- Reworked the README around the supported runtime, security, configuration,
  account, LSP, and troubleshooting contracts.

## [0.1.0-beta.10] — 2026-06-16

### Added
- `UtexoLsp`, a composed account and `LspClient` orchestration surface for
  connecting, channel readiness, RGB receive/send, Lightning Address payment,
  outbound liquidity, APay registration, and pending-payment claims.
- `LspClient.resolveAddress()` and
  `LspClient.getLightningAddressByPubkey()`.
- `account.createLsp()`, `account.getLspConfig()`, and
  `account.createHodlInvoice()`.
- `virtualPeerPubkeys` configuration for trusted virtual-channel peers.
- Full TypeScript declarations for the public package surface.
- The `RgbLightningError` hierarchy, local `account.vssStatus()`, and the
  `account.createLightningInvoice()` cross-SDK alias.

### Fixed
- Removed duplicate `apayNew` implementations from both runtime bindings.

### Changed
- Updated native peers to `@utexo/rgb-lightning-node-bare@^0.1.0-beta.13`
  and `@utexo/rgb-lightning-node-nodejs@^0.1.0-beta.9`.
- Added build and provenance-enabled release workflows.

## [0.1.0-beta.9] — 2026-06-15

### Changed
- Updated both native binding peer requirements to `^0.6.0-beta.1`.

## [0.1.0-beta.8] — 2026-06-10

### Added
- Forwarded `lspBaseUrl` and `lspBearerToken` through the wallet manager and
  both bindings for RLN's internal APay client.

### Changed
- Updated both native binding peer requirements to `^0.5.2-beta.1`.

## [0.1.0-beta.7] — 2026-06-04

### Changed
- Rebased both native binding peer requirements to the
  `^0.1.0-beta.3` package line.
- Clarified the RGB Lightning and on-chain RGB module boundary and directed
  asset issuance and inflation to `@utexo/wdk-wallet-rgb`.
- Added the first automated release workflow for native release dispatches.

`0.1.0-beta.1` and `0.1.0-beta.2` were repository-tagged releases. npm
publishing for this package began at `0.1.0-beta.7`; versions
`0.1.0-beta.3` through `0.1.0-beta.6` were not released.

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
  three-call sequence for peer connection, readiness polling, and
  optional APay registration.
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
  registration through the native RLN binding.
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
  exposed by the native binding.

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
