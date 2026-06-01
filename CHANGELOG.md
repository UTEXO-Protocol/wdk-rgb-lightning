# Changelog

All notable changes to `@utexo/wdk-rgb-lightning` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
while pre-`1.0`.

## [Unreleased]

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
