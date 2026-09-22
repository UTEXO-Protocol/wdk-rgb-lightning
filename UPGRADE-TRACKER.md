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
| Canonical unlock, persistent signer and strict policy | Pending | Reviewed source, focused regression tests |
| Released refresh/invoice/UTXO response contract | Pending | No silent fallbacks; fail before mutation |
| Selected discovery, APay, multi-channel and validation ports | Pending | Clean consumers and negative tests |
| Unit/type/lint/package checks | Pending | Exact commands and results below |
| Linked native/runtime conformance | Pending | Real artifacts, not only mocks |
| Independent final diff review | Pending | Every plan item classified |
| Cross-repository draft PR links | Pending | Add after creation |

## Explicit Release Gates

| ID | Gate | Status |
| --- | --- | --- |
| G1 | Existing colored-channel state can be refused by released 0.13; exact old-artifact migration qualification and operational drain/close procedure required | Blocked |
| G2 | Old password-encrypted mnemonic records are not automatically supported; distinguish WDK external-signer key-source records | Blocked |
| G3 | Full desktop/mobile build and runtime target matrix | Pending |
| G4 | Controlled two-node/regtest and operator-coordinated LSP asset flow | Blocked: operator/environment evidence required |
| G5 | Integrator zero-channel report root cause | Unproven: deployed build IDs and server provisioning logs required |
| G6 | Current app depends on excluded overlay features | Separate adoption gate; do not change app pins |
| G7 | Candidate publication, promotion and merge | Not authorized by this draft-PR task |

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
