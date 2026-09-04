# Changelog

All notable changes to `@utexo/wdk-rgb-lightning` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
while pre-`1.0`.

## [0.1.0-beta.19] - 2026-07-29

### Fixed
- Construct both React Native and Node external signers with disk-backed VLS
  storage below the account's persistent `dataDir`. Per-commitment secrets and
  points now survive process restarts, so restored channels remain signable.
- Isolate the automatic legacy seed fallback in its own signer store to avoid
  opening one VLS database with two wallet identities.

### Changed
- Raised native peer floors to `@utexo/rgb-lightning-node-bare
  >=0.1.0-beta.19 <0.2.0` and `@utexo/rgb-lightning-node-nodejs
  >=0.1.0-beta.15 <0.2.0`, the first releases exposing persistent signer
  construction.
- Documented that RLN VSS currently replicates LDK state but not the external
  signer's redb database. Local restart recovery is supported; cross-device
  recovery of open channels remains incomplete until signer-state backup is
  implemented.

## [Unreleased]

### Added
- Strict linked-asset LSP contracts and composed flows for exact Lightning
  Address asset discovery, quote-only address resolution, canonical-to-linked
  receive requests, linked-to-canonical external BOLT11 relay quotes, durable
  relay-status lookup, and APay hash-pool refill metadata. Signed target and
  funding invoices are checked for payment-hash, contract, amount, network,
  payee, expiry, and fee equivalence before native payment.
- Exact APay verification for the native address-attestation and hash-batch
  protocols. The SDK verifies the recipient's Lightning-message signatures,
  reconstructs Merkle inclusion paths, and binds the proof to the configured
  LSP or external BOLT11 payee, hosted address, and decoded invoice payment
  hash.
- Exact LUD-06 metadata commitment verification. A composed Lightning Address
  quote now requires the decoded BOLT11 `description_hash` to equal SHA-256 of
  the discovery document's exact UTF-8 `metadata` bytes.
- Caller cancellation across LSP HTTP, LNURL discovery/callback, retry backoff,
  and composed linked-asset flows. Successful protocol responses are bounded
  and strictly parsed before they cross the SDK boundary.
- Restored external-payment quotes are rebound to a separately supplied trusted
  target invoice, exact funding contract, LSP fee ceiling, and routing-fee
  ceiling before they can cross the native payment boundary. This also covers
  funding representations that were selected automatically while quoting.
- RGB Lightning payments re-read native channels immediately before payment and
  require the exact asset units and BOLT11 carrier amount to coexist in one
  explicitly usable channel. Stale quotes and split-channel liquidity fail
  before `sendPayment`; channel balances are never summed as RGB MPP.
- LSP discovery decimal policy fields are bounded to the server's exact uint64
  contract before BigInt conversion or application use.
- LSP timeout and retry configuration now rejects non-integer, out-of-range,
  and type-coerced values instead of silently changing caller policy.
- Explicit recovery semantics for linked-payment relays: durable status lookup
  prevents blind duplication after a persisted quote, while documentation now
  fails closed on the unrecoverable lost-POST-response case because the current
  status endpoint does not return the funding invoice.
- Address-attested APay across the Bare and Node bindings, account surface, and
  composed LSP flow. `enableLightningAddress()` now resolves the
  LSP-provisioned address before submitting exactly one signed hash batch and
  fails closed when the generated native method is unavailable. Legacy
  unattested registration requires explicit `requireAddressAttestation: false`.
- Validated standalone RGB contract and transfer-consignment import boundaries.
  Requests are exact and bounded, transaction IDs are canonicalized, native
  responses are schema-checked, and an import fails closed if the returned
  asset differs from `expected_asset_id`.
- Stable native Lightning `failure_code` fields on immediate send results and
  persisted payment records, allowing callers to distinguish route, expiry,
  duplicate-payment, recipient, retry, and restart-abandonment failures.
- Exact `DecodedRgbInvoice` and tagged `DecodedRgbAssignment` typing across
  the WDK account boundary.
- Exact `DecodedLightningInvoice` typing across the WDK account boundary,
  including `min_final_cltv_expiry_delta`.
- Strict `listAddressReceipts(address)` validation and account exposure for
  authoritative BTC receive settlement, partial-payment, confirmation, and
  reorg reconciliation.
- Exact BTC and RGB on-chain send-plan APIs. Accounts can prepare the native
  unsigned transaction without exposing PSBT material to JavaScript, validate
  its transaction id and decimal-safe fee totals, idempotently commit that
  exact native plan, cancel abandoned BTC or RGB plans, and inspect bounded
  pending plans for crash recovery.
- Explicit, reviewable RGB wallet UTXO setup with `prepareCreateUtxos()`,
  `commitPreparedCreateUtxos()`, and `cancelCreateUtxosPlan()`. Requests and
  native responses are strictly validated, monetary values remain decimal
  strings, and no PSBT material crosses the WDK boundary.
- Strict response validation for prepared plans, committed transactions, BTC
  cancellation acknowledgements, and pending-operation records. Malformed or
  lossy native binding responses fail closed at the WDK boundary.
- UMA address-format compatibility across Lightning Address payment flows.
  `$recipient@example.com` is normalized to `recipient@example.com` before
  LNURL discovery. New root exports include `isUmaAddress`,
  `normalizeLightningAddress`, `UMA_PREFIX`, and `UMA_MAX_USERNAME_LENGTH`;
  `parseLightningAddress` now also returns the canonical address, domain, and
  whether the input used UMA form.

### Changed
- Evaluate every explicitly usable channel to the configured LSP when waiting
  for outbound liquidity. Channel ordering can no longer produce a false
  timeout when a later matching channel has sufficient balance, while malformed
  native balance evidence still fails closed.
- Apply the documented `onEachPoll` hook before every account sync in receive
  settlement and outbound-liquidity waits, matching channel-readiness polling
  and allowing callers to perform deterministic chain or peer maintenance.
- Match the deployed Go LSP request contract by emitting exact JSON numbers for
  Lightning uint64 fields and rejecting values above JavaScript's safe range
  instead of sending server-invalid quoted numbers.
- Validate polling inputs and native channel balances before they can affect
  readiness decisions, propagate Lightning Address cancellation through
  discovery, and verify requested description-hash and final-CLTV invoice data.
- Raised native peer floors to `@utexo/rgb-lightning-node-bare
  >=0.1.0-beta.20 <0.2.0` and `@utexo/rgb-lightning-node-nodejs
  >=0.1.0-beta.16 <0.2.0`, the first published wrappers exposing
  address-attested APay through their generated native APIs. The Node package
  smoke now consumes the minimum registry peer and verifies that capability.
- Raised native peer floors to `@utexo/rgb-lightning-node-bare
  >=0.1.0-beta.18 <0.2.0` and `@utexo/rgb-lightning-node-nodejs
  >=0.1.0-beta.14 <0.2.0`. These releases preserve duplicate-channel
  protection while allowing a trusted virtual channel to be opened again
  after the previous native session reaches its terminal abandoned state.
- Raised native peer floors to `@utexo/rgb-lightning-node-bare
  >=0.1.0-beta.17 <0.2.0` and `@utexo/rgb-lightning-node-nodejs
  >=0.1.0-beta.13 <0.2.0`, the first releases with stable RGB assignment
  decoding.
- Raised native peer floors to `@utexo/rgb-lightning-node-bare
  >=0.1.0-beta.16 <0.2.0` and `@utexo/rgb-lightning-node-nodejs
  >=0.1.0-beta.12 <0.2.0`, the first releases that preserve Lightning CLTV
  metadata through the C-FFI decode response.

### Fixed
- Rejected zero-unit RGB LNURL requests and locally expired receive invoices
  before invoking their state-creating callback or bridge endpoint.
- Preserved RGB contract identifiers as case-sensitive authorization values
  during Lightning Address and relay-funding selection. Human-facing tickers
  remain case-insensitive, but differently cased contract IDs no longer match.
- Treated native `Cancelled` and `Canceled` receive statuses as terminal
  settlement failures instead of silently polling them as `Pending` until the
  caller timeout.
- Prevented an LSP from substituting either side of an on-chain RGB delivery
  bridge. `sendAsset()` and `receiveAsset()` now require local verification of
  the recipient RGB invoice and signed BOLT11 by default; the legacy downgrade
  requires explicit `requireInvoiceVerification: false`.
- Prevented automatic retries of state-creating Lightning Address callbacks.
  Discovery and status reads retain bounded retries, but an ambiguous callback
  failure cannot silently consume a second APay hash or create a second quote.
- Hardened LNURL callback construction against credentials, fragments,
  unsupported schemes, duplicate reserved query keys, incomplete RGB asset
  pairs, unadvertised contracts, invalid comments, and oversized streamed
  responses. LSP and LNURL requests ask the transport to reject redirects and
  independently reject responses whose final URL changed. Mobile `bare-fetch`
  still follows before returning, so redirected state-creating callbacks remain
  ambiguous and are never automatically retried.
- Made the exported APay verifiers validate their complete public inputs before
  cryptographic processing, so malformed direct calls fail through the stable
  `LspQuoteMismatchError` contract.
- Required both same-asset and converted RGB receive invoices to preserve the
  exact fungible amount, rejected expired or networkless bridge invoices, and
  applied an explicit native routing-fee ceiling to `sendAsset()` (zero by
  default).
- Moved locally decidable signed-invoice checks ahead of non-idempotent LSP
  bridge requests, enforced cross-leg expiry ordering, and bound APay address
  discovery and registration to the configured LSP and wallet node identities.
- Bound hosted Lightning Address quotes to fresh LSP identity and network
  discovery before invoking their state-creating callback. Restored external
  relay quotes now refresh that discovery and require the exact funding asset
  to remain advertised immediately before native payment.
- Bound legacy on-chain/Lightning bridge creation to fresh LSP identity and
  network discovery as well. Receive refuses an unadvertised payout contract
  before creating a local invoice, and locally created invoices must preserve
  the requested expiry and LSP network before registration.
- Centralized canonical invoice and RGB asset validation so state-creating
  bridge calls reject whitespace, malformed selectors, and unsupported
  selection policies before transport or native work.
- Aligned the wallet snapshot runtime fingerprint and public TypeScript
  contract with the required v0.11 native peers. Snapshot refreshes now accept
  `rgb-lightning-node-v0.11.0-beta.3+utexo-wallet-v3` and continue to reject
  snapshots from incompatible native runtimes.

## [0.1.0-beta.15] — 2026-07-23

### Added
- **Versioned wallet refresh contract:** `account.refreshWalletSnapshot()`
  serializes/coalesces refreshes, explicitly FullSyncs or recovery FullScans
  both native keychains, validates bounded BigInt-safe snapshot DTOs, retries
  one moving-tip capture, and reports partial sync, native, contract, and
  coherence failures through `WalletSyncError` / `WalletSnapshotError`.
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
- Wallet snapshot validation now canonicalizes only recognized legacy native
  network casing (for example, `Regtest` to `regtest`) before enforcing the
  strict v1 contract. This keeps source-PR installs compatible with published
  beta.14 native prebuilds while unknown network names still fail closed.
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
