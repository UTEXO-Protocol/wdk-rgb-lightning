# RLN 0.13.0-beta.3 Upgrade Tracker

Status: implementation in progress. Draft PR, not release approval.

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
| Unit/type/lint/package checks | Verified locally | 693 tests in 20 suites; types/lint/33-file pack passed |
| Linked native/runtime conformance | Partial | Clean packed Node consumer passed; final Node rerun and isolated Bare consumer build underway; mobile and network remain gates |
| Final diff review | In progress | Boundary/lifecycle/LSP review found and fixed additional cases; external maintainer review required |
| Cross-repository draft PR links | Done | Links below |

## Explicit Release Gates

| ID | Gate | Status |
| --- | --- | --- |
| G1 | Existing colored-channel state can be refused by released 0.13; exact old-artifact migration qualification and operational drain/close procedure required | Blocked |
| G2 | Old password-encrypted mnemonic records are not automatically supported; distinguish WDK external-signer key-source records | Blocked |
| G3 | Full desktop/mobile build and runtime target matrix | Pending |
| G4 | Controlled two-node/regtest and operator-coordinated LSP asset flow | Regtest execution pending; operator LSP qualification blocked on coordination and deployed-build evidence |
| G5 | Integrator zero-channel report root cause | Unproven: deployed build IDs and server provisioning logs required |
| G6 | Current app depends on excluded overlay features | Separate adoption gate; do not change app pins |
| G7 | Candidate publication, promotion and merge | Not authorized by this draft-PR task |
| G8 | Native implementation pushes | Blocked: current GitHub OAuth credential lacks workflow scope; Node/Bare remote drafts still contain only their initial trackers |
| G9 | Packed Bare native build with shared Node Cargo cache | Type mismatches reproduced; isolated-cache retry running. Do not claim the Bare consumer passed yet |

Excluded capabilities: coherent wallet snapshot/FullSync, native operation registry,
prepared-send plans and inventories, address receipts, RLN import APIs, VSS delete-all
and native routing fee caps. Persistent signer and address-attested APay forwarding
are allowed only because their underlying behavior is already released.

No automatic wallet reset, seed-only recreation, stale-state rollback, implicit
virtual-channel trust change, or replacement of an unsupported safety guarantee with
a weaker implementation.

## Verification Log

- Baseline source/branch audit completed before implementation.
- Results below will distinguish mocked tests, linked host smoke, compile-only
  cross-builds, device tests and funded/network qualification.
- No funded transaction or production wallet has been used.
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

## Coordinated Drafts

- [Node #22](https://github.com/UTEXO-Protocol/rgb-lightning-node-nodejs/pull/22)
- [Bare #20](https://github.com/UTEXO-Protocol/rgb-lightning-node-bare/pull/20)
- [WDK #43](https://github.com/UTEXO-Protocol/wdk-rgb-lightning/pull/43)
