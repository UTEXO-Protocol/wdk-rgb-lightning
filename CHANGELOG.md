# Changelog

All notable changes to `@utexo/wdk-rgb-lightning` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
while pre-`1.0`.

## [Unreleased]

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
