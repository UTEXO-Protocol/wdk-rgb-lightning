# RLN 0.13.0-beta.3 Upgrade Tracker

Status: 2026-09-24 local released-runtime qualification completed within the
recorded scope. Strict outgoing signer and same-process reopen failures remain
explicit blockers. Draft PR, not release approval.

## Scope

- Target RLN `af03c7f1a65135a429f05a5820600338215954dc` (v0.13.0-beta.3).
- Target rust-lightning submodule `38d73bc918f27956590585d2bb83c86f059679b0`.
- Target RGB-lib v0.3.0-beta.34 and Rust 1.94.0.
- Candidate package line: `0.2.0-beta.1`; no npm publication in this task.
- Start from main. Do not merge dev/iris-wallet wholesale.
- No upstream wallet, channel, signer-policy, VSS or routing behavior patches.

## Implementation

| Work | Status | Required Evidence |
| --- | --- | --- |
| Dedicated upgrade branch | Done | `codex/rln-0.13.0-beta.3` |
| Canonical unlock, persistent signer and strict policy | Implemented | Single-flight activation, shutdown retry, failed creation cleanup and disposal tests |
| Released refresh/invoice/UTXO response contract | Implemented | Fail-before-mutation input checks; preserve per-batch failures and exists=false |
| Selected discovery, APay, multi-channel and validation ports | Implemented | Discovery/proof/invoice/credential tests; no unmerged native execution APIs |
| Unit/type/lint/package checks | Verified locally | 694 tests in 20 suites; types/lint/33-file pack passed |
| Linked native/runtime conformance | Partial | Packed Node/Bare consumers and real regtest scenarios executed; strict outgoing and same-process reopen failures remain; see qualification report |
| Final diff review | In progress | Boundary/lifecycle/LSP review found and fixed additional cases; external maintainer review required |
| Cross-repository draft PR links | Done | Links below |

## Explicit Release Gates

| ID | Gate | Status |
| --- | --- | --- |
| G1 | Existing colored-channel migration | Out of scope: owner confirmed no live wallets on 2026-09-24; fresh wallets only, no migration compatibility promise |
| G2 | Old password-encrypted mnemonic migration | Out of scope under the same owner decision; no reset or stale-state rollback workaround |
| G3 | Full desktop/mobile build and runtime target matrix | All seven Bare targets compile and pass artifact checks, including Android 64-bit 16 KiB alignment. Device/emulator/embedded runtime and remaining Node targets still need qualification |
| G4 | Controlled two-node/regtest and operator-coordinated LSP asset flow | Real local Node/Bare flows executed; strict outgoing signer and same-process reopen blockers remain. Deployed Signet/mainnet LSP qualification is separate |
| G5 | Integrator zero-channel report root cause | Unproven: deployed build IDs and server provisioning logs required |
| G6 | Current app depends on excluded overlay features | Separate adoption gate; do not change app pins |
| G7 | Candidate publication, promotion and merge | Not authorized by this draft-PR task |
| G8 | Native implementation pushes | Resolved on 2026-09-23: Node 875cff3 and Bare 22ce493 pushed after user refreshed workflow authorization; both draft PRs now contain implementation. Native CI qualification is in progress |
| G9 | Packed Bare native build with shared Node Cargo cache | Type mismatches reproduced; identical source built with dedicated cache. Keep Node/Bare caches separate; no upstream graph workaround |
| G10 | Fresh Bare dependency graph requires newer engine | WDK entry declares Bare >=1.32.0. Packed consumer passed on pinned 1.32.0 after bare-type 1.3.0 rejected the former 1.30.3 canary. No app embedded-runtime pin changed |

Excluded capabilities: coherent wallet snapshot/FullSync, native operation registry,
prepared-send plans and inventories, address receipts, RLN import APIs, VSS delete-all
and native routing fee caps. Persistent signer and address-attested APay forwarding
are allowed only because their underlying behavior is already released.

No automatic wallet reset, seed-only recreation, stale-state rollback, implicit
virtual-channel trust change, or replacement of an unsupported safety guarantee with
a weaker implementation.

## Verification Log

### 2026-09-24 Local Qualification

- Complete isolated stack setup passed: Core 31.1, standalone Electrs 0.12.0,
  mempool Electrs 3.3.0 Esplora, RGB proxy 0.3.0, RLN 0.13.0-beta.3, pinned
  LSP main b865c88 and a loopback-only explorer. Exact sources/digests in
  `tests/regtest/`; no upstream behavior modifications.
- Strict Node/Bare NIA/IFA/CFA/UDA receipt and witness transfers pass. Both
  TransactionSync and BlockSync are exercised with a separate RGB indexer.
- Diagnostic permissive Node/Bare runs pass BTC/RGB channels, payments, keysend,
  HODL claim/cancel, process crash recovery, post-restart payment, cooperative
  closes and confirmed BTC force-close. Same-process reopen fails in both.
- Real Node/Bare IFA LSP provisioning, signed APay proof/claim/payment and both
  bridges pass in the permissive diagnostic; settlement is independently checked.
  Strict inbound provisioning/payment and proof pass, but outgoing payment stalls.
  Diagnostic permissive success is not mainnet or strict-policy qualification.
- Fixed large-response integer handling in both native packages and tightened
  WDK transfer filter validation/types. Witness nonce preservation regression added.
- Migration excluded by owner (no live wallets); VSS disabled and upstream VSS
  repair excluded. Issuance/inflation rejection in external-signer mode documented.
- Detailed run IDs, reproduced blockers, warnings, fixture corrections and
  unexecuted surfaces: [qualification report](./tests/regtest/QUALIFICATION.md).

### Earlier Implementation Evidence

- Baseline source/branch audit completed before implementation.
- Results below will distinguish mocked tests, linked host smoke, compile-only
  cross-builds, device tests and funded/network qualification.
- Only disposable local regtest wallets were funded. No real-network funds or production wallets were used.
- Unit tests use mocked native modules, not proof of native or network behavior.
  Ran `npm test -- --runInBand --watchman=false`, types, lint and package verification.
- Packed package: 33 files; parser-only discovery entry does not load native peers.
- Targeted within-range updates fixed four transitive audit findings; audit now zero.
- Additional review fixes: terminal Cancelled invoices; LSP peer matching; exact
  sats-to-msats conversion; failed account creation retains retryable native state;
  convenience payment helpers verify signed invoice amount/asset/metadata locally.
- Low-level `LspClient` quote methods are HTTP DTOs, not payment authorization.
  `/lightning_send` and its status route exist in audited LSP main `b865c8868e202ba90055d4924382eada62c52cd6`;
  quote creation can mutate server state and is operator-gated. No automatic
  linked-payment execution or native routing-fee guarantee was imported.
  Bridge verification does not prove the LSP completed the on-chain RGB leg;
  settlement must be observed independently. No native fee cap is promised.
- Retain existing WDK staged/OIDC/manual release flow. Exact native peers are
  unpublished, so registry smoke/provenance is intentionally not bypassed.
- Final review verifies caller-supplied payment/description hashes, CLTV and
  expiry duration against signed bridge invoices, not only amount and asset.
  Exact released init-conflict recognition rejects unrelated errors containing
  "Conflict"; numeric-string payments are converted to the exact numeric DTO.
- Real optimized Node canary and a clean packed Node/WDK source installation
  passed. Packed consumer tests are separate from the mocked unit suite.
- Docker, iOS SDK and the pinned Android NDK are locally available. Their
  existence is not evidence that regtest, mobile builds or device tests passed.
- Packed Bare/WDK consumer passed normal source-build install, conditional
  exports, native identity, persistent signer and offline lifecycle on 1.32.0.
  Source/dependency caches assisted installation. Embedded mobile qualification
  remains separate, as does the native-only 1.30.3 canary.
- GitHub build checks passed for ba38656 and engine-metadata commit aa25faa.
  Final Node tarball consumer retest passed (92 packages, nine-minute install).

## Coordinated Drafts

- [Node #22](https://github.com/UTEXO-Protocol/rgb-lightning-node-nodejs/pull/22)
- [Bare #20](https://github.com/UTEXO-Protocol/rgb-lightning-node-bare/pull/20)
- [WDK #43](https://github.com/UTEXO-Protocol/wdk-rgb-lightning/pull/43)
