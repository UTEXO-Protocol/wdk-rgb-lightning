# Changelog

All notable changes to `@utexo/wdk-rgb-lightning` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
while pre-`1.0`.

## [Unreleased]

## [0.2.0-beta.5] — 2026-10-20

This breaking beta combines the unpublished beta.4 WDK candidate with Bitcoin
message proofs and enabled VSS backup/recovery. The earlier beta.4 npm stage is
superseded; the published native beta.4 packages remain unchanged.

### Breaking changes

- Require the exact native peer `@utexo/rgb-lightning-node-bare@0.2.0-beta.5`
  or `@utexo/rgb-lightning-node-nodejs@0.2.0-beta.5` for the selected runtime.
  Check compiled RLN, adapter and capabilities before creating native handles;
  older native graphs are rejected.
- Adopt RLN `v0.17.0-beta.3` (`ecc69f20308231400561f6f060fea88acfa40cc4`),
  rgb-lib `v0.3.0-beta.50-bfa` (`1b951af0c8233308c919975552487be19ad2a930`)
  and LDK `79b9eb5166546c62692d3a672986f385c7fe047d`.
- Replace the former custom runtime surface with the released API. Snapshot/
  FullSync, prepared send/UTXO inventory, custom operation control, address
  receipts, VSS delete-all and native routing fee caps remain unavailable.
  Unsupported operations fail before submission; legacy wallet/channel
  migration is not qualified.
- Reject mainnet Lightning before native or HTTP work with
  `LIGHTNING_DISABLED_ON_MAINNET`. Mainnet on-chain and non-mainnet Lightning
  APIs retain their documented availability and qualification scope.

### Added

- Owned BIP-322 Bitcoin address proofs: `getMessageSigningAddress()`,
  `signMessageBip322(message, address)` and read-only
  `verifyMessageBip322(message, address, signature)`. Signing uses the stable
  first vanilla BIP86 Taproot address, verifies ownership and emits a v2 `smp`
  simple proof without broadcasting. Messages preserve exact UTF-8 bytes with
  a 4096-byte bound and malformed-surrogate rejection. Offline verification
  supports P2TR key-path and P2WPKH simple proofs. Existing Lightning
  node-identity `sign()` / `verify()` semantics are unchanged.
- Explicitly configured VSS backup and pre-unlock `prepareVssRestore(scope?)`,
  with bounded archive-path checks, wallet/network identity validation,
  no-overwrite promotion and authenticated local restore receipts.
  `getVssRestoreInfo()` separates preparation from completed native unlock.
  A missing snapshot is not reported as a restored wallet.
- Default-on, durable automatic RGB backup preference through
  `setVssAutomaticBackupEnabled(enabled)`. The saved wallet/network/endpoint
  choice wins initial configuration. Off retains manual backup and pending
  changes; On checkpoints current state before confirmation.
- Separate `getVssBackupInfo()` remote-health and `getVssBackupMetadata()` local
  receipt APIs. Receipts record canonical manifest version and actual upload
  completion time; valid receipts remain readable after clock corrections.
- Typed `burnAsset(request)` with exact u64 decimal-string amounts and fee
  inputs, optional external-unlock `eth_rpc_url`, saved-consignment export and
  contract/transfer-metadata imports. Burn has one native submission and no
  automatic retry, bridge payout or application operation journal.
- Optional transport-neutral WebRGB receive/read integration, local capability
  reporting, parser-only LSP discovery, address-attested APay and UMA-form
  Lightning Address normalization. WebRGB adds no browser node, WalletConnect
  transport or remote burn API.

### Fixed

- Serialize activation, receive-address allocation, backup-policy transitions,
  admitted mutations, checkpoints and shutdown. Drain the node before signer
  revocation. Retain failed account/signer cleanup ownership for explicit retry
  without repeating successful cleanup; native session tasks/listeners are
  cleaned up before normal same-process reopening.
- Preserve pending backup state and the prior automatic preference after upload
  failure. Manual backup remains available while automatic snapshots are off.
  Unchanged syncing reads and pure status reads do not create upload timestamps;
  discovered incoming/spent BTC changes checkpoint when enabled.
- Use the canonical remote RGB manifest version for backup acknowledgments.
  A historical automatic-error flag does not invalidate a successful manual
  receipt. Backup failure does not turn a completed transfer into a failed
  payment or automatically repeat that payment.
- Normalize canonical/legacy unlock inputs, retain persistent strict external
  signing, preserve exact large response integers and per-batch refresh errors,
  and retain `utxo.exists` and `pending_blinded` values.
- Validate LSP/LNURL amounts, usable single-channel liquidity, terminal
  cancellation, Lightning Address mapping and local invoice decoding before
  convenience-helper payments.

### Distribution and release tooling

- Version Bare and all three required iOS/Android data companions together at
  beta.5. Validate every payload and all seven Bare targets before use; retain
  all five qualified Node targets. Native build inputs, binary hashes and
  original compilation provenance remain unchanged by package versioning.
- Build reproducible, allowlisted npm archives from clean committed source.
  Native registry admission checks exact versions, source commits and the
  complete runtime graph. npm 12 packed consumers approve exact native install
  sources and require observed artifact admission. Bare's packed canary keeps
  asynchronous checks alive and requires a completion marker within a bounded
  timeout, preventing an early successful exit from being reported as a pass.
  Curated GitHub release notes come from this complete changelog entry.
- Admit exact merged-main beta.5 Bare and Node sources after their release PRs
  merge. Complete Git trees equal the qualified release heads; native build
  inputs and existing binary/qualification identities remain unchanged.

### Known limitations

- Interrupted BTC sends can leave input reservations requiring recovery.
- RGB settled/spendable accounting can remain stale after a Bitcoin reorg;
  pending witness receipts can be double-counted before correct settlement.
- An earlier wrong-amount BFA lock can make a later valid mint fail validation.
- Upstream VSS external-signer credentials derive from public bootstrap data.
  VSS does not replicate the mnemonic, separate VLS signer database or
  application journals. Interrupted chunk replacement, stale writer fences and
  arbitrary crash/device-loss recovery remain qualification limits. Explicit
  recovery never clears a foreign writer automatically; remote erasure is absent.
- Native dependency security, notices, remaining supported-platform/device and
  public-network financial qualification retain their recorded open scope.
  A clean npm audit or host/simulator pass does not establish those results.

See [PRODUCTION-GATES.md](./PRODUCTION-GATES.md) for exact evidence and remaining
qualification. This beta does not make a production-readiness claim.

## [0.2.0-beta.4] — 2026-10-16

Superseded staged WDK candidate; not published to npm. Its changes are included
in 0.2.0-beta.5. The earlier Git tag and staged-artifact identity are retained as
history; do not approve or finalize that obsolete stage.

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
