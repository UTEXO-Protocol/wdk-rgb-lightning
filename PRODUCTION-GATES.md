# Release qualification: 0.2.0-beta.3

Working branch: `release/rln-0.15.0-beta.3`. This register separates engineering
verification from decisions about release scope. An item is closed only by the
evidence listed here, not by a general CI success.

## Candidate

- WDK runtime baseline: `0d44024e4949f399cbd24fd55c4d5c9b48dfda02`.
  This follow-up adds qualification documentation and the pending-balance
  acceptance test, without changing runtime behavior.
- Node runtime/wrapper baseline: `9617e4d3273be1b9f70e5aaa6693026e5bbae25f`;
  GNU CI compatibility correction: `66d55fc14195ca2ecff623704a4e2c410001a036`.
- Bare runtime/wrapper baseline: `d1bb37c6a220451c04d9db7f8d4c1f07f650a65e`;
  stricter post-link verification: `73f79e1b2bda310dfca6e5fa1a01c3ec651edadc`.
- Native source: RLN `a17b685615750536f0320db1cd3f3ba68a8f1c57`, including
  external-signer Ethereum RPC support merged in RLN #192. This is newer than
  the `v0.15.0-beta.3` tag; the tag alone is not an equivalent build.
- Native adapter: `93d62bb91c0ab90a7ccc4a1382a9da84498e38506170ce74d3863292f0c9f2f4`.

## Engineering Work

| Item | Status | Evidence / next check |
| --- | --- | --- |
| Private native source access in CI | Closed | `ORG_READ_TOKEN` initialization already exists. Node contract run 37629617616, Node runtime run 37629617639 and Bare contract run 37629619939 passed on attempt 2. |
| Node optimized builds and assembled package | Passed for the tested matrix | All five inputs are CI-built. The rejected ARM64 Ubuntu 24.04 artifact is excluded; both GNU replacements require glibc 2.34 and load on Ubuntu 22.04. One assembled archive passes five fresh offline installs, all-target provenance and native canaries. macOS/GNU consumers use Node 22.23.0; Alpine/musl uses 24.18.1. |
| Bare optimized seven-target build | Five passed; two packaging failures | Candidate-only run 37925315347: Darwin arm64, three iOS targets and Android armv7 pass. Both 64-bit Android builds fail after linking. The five-artifact test archive correctly fails the complete publication gate. |
| Android generic Bare post-link packaging | Reproduced; P05 remains open | Exact CI versions reproduce shifted RELRO and relocated DYNAMIC. Added protection coverage checks and regression test; original arm64/x64 prebuilds pass. |
| WDK with CI-built native packages | Passed on host | 862 WDK tests, 21 Node tests and 45 Bare tests; declarations, lint, package allowlist and clean packed Node/Bare consumer smoke tests pass. No native source revision changed for the build fixes. |
| Funded regtest checks | Happy paths pass; acceptance failures retained | Both optimized CI host addons pass four schemas, BFA receive/send/balance/history/export, cold restart and invalid-mint rejection. Both pass 12 external-unlock cases. BFA event-order acceptance fails; unlocked reopen and pending witness balance failures reproduce. |
| Android remaining runtime flows | Pending | Existing evidence covers debug BTC send/receive and settled RGB receive on a 16-KiB emulator. RGB send and interactive release-artifact qualification remain open. |

## Hard Failures

These are candidate failures, not missing CI credentials. Approval alone does
not fix them. Closure requires a verified correction or a narrower supported
configuration that removes the affected behavior.

| ID | Gate and origin | Network / feature | Required closure |
| --- | --- | --- | --- |
| P01 | Persistent signer database lock after unlock, shutdown and same-process recreation. Native RLN/VLS lifetime, not a Jest or app-only failure. | Signet and mainnet; both wrappers | Correct ownership/teardown upstream, or qualify real process isolation with secure lock/unlock and crash recovery. Do not keep an unlocked signer alive after app lock or reset its database. The CI-built Node addon reproduces the failure even without funding. |
| P02 | Process death during BTC send can leave an orphaned input reservation. RLN external-signer begin/sign/end integration with rgb-lib. | BTC sends on both networks | Expose and qualify reconciliation/abort recovery. Prove no unintended replay and retained spendability after interrupted submission. The missing custom prepared-send UX is separate from this underlying recovery requirement. |
| P03 | RGB settlement remains stale after a receipt is disconnected by a reorg. Pinned rgb-lib behavior. | RGB on both networks | Prove rollback, cold restart and reconfirmation against an approved upstream graph. Additional confirmations reduce exposure but are not evidence that rollback works. |
| P04 | Incoming witness `future` balance double-counts one receipt before settlement. Raw native balance already contains the duplicate amount; WDK passes it through. | RGB pending balances on both networks | Fix native accounting, or explicitly omit unqualified pending projections while retaining truthful settled/spendable balances. Do not divide every pending balance by two. Run `tests/regtest/pending-balance.mjs` on both runtimes. |
| P05 | bare-link/bare-lief rewrite invalidates the RLN addon's 16-KiB layout and moves DYNAMIC outside RELRO. Original prebuilds pass; generic post-link outputs fail. | Android delivery on either network | Adopt and qualify a supported byte-preserving consumer integration, or fix the upstream linker. Iris's app-specific staging does not automatically make another consumer safe. Do not relax ELF checks. |
| P06 | The BFA validator selects an earlier wrong-amount lock instead of a later valid lock for the same mint. Pinned consensus/rgb-lib behavior. | BFA receipt on either network | Merge and propagate the correction represented by rgb-lib #103, then pass the funded event-order acceptance test. #103 remains open as checked October 9. Ordinary BFA receipt/send passes are not sufficient. |

Existing recovery evidence and reproduction commands are in
[the release tracker](./RELEASE-0.15-TRACKER.md),
[the regtest report](./tests/regtest/QUALIFICATION.md) and
[the BFA report](./BFA-QUALIFICATION.md). The current source is pinned; an issue
recorded here is not a claim that every newer upstream revision has the same bug.

## Scope Decisions

| ID | Decision | Current boundary |
| --- | --- | --- |
| S01 | On-chain-only release, or non-mainnet Lightning as well? | Mainnet Lightning already fails with `LIGHTNING_DISABLED_ON_MAINNET`. Signet Lightning APIs remain available, but strict outbound settlement, mature BTC force-close sweep, RGB commitment acceptance and channel recovery are not qualified. On-chain-only scope removes those channel gates, not P01-P06. |
| S02 | Keep the #192 native source or adopt newer merged upstream work? | RLN #194 (external burn), #195 (no LDK startup on mainnet), and #200 (rgb-lib beta.47-bfa plus new rust-lightning) have merged to `dev`. They are absent from this candidate. Moving to #200 is 24 commits and changes the dependency graph; it is not only a burn toggle. Review the full delta, regenerate adapters/locks, rebuild and rerun qualification before selecting it. |
| S03 | Include burn in this release? | Burn remains unavailable in the current pin. The upstream path merged as #194 at `f1105c207f4750a4258ae7b0df45d7e4caa04b4f`. Enabling it also requires Node/Bare C-FFI exposure, WDK APIs, durable operation recovery and funded verification. No burn capability is falsely advertised. |
| S04 | Which asset schemas and deployments are supported? | Mainnet IFA is rejected by the current upstream library. Local six-decimal IFA/NIA fixtures are not production USDT. Mainnet BFA needs an approved bridge/token/contract identity and Ethereum RPC configuration, plus P06 closure. |
| S05 | Is VSS part of this release? | Deferred by request. No device-loss or VSS recovery claim. The source contains VSS APIs but that does not qualify the service or recovery policy. |
| S06 | Retain the breaking 0.2 API boundary? | Thirteen legacy custom on-chain operations and related unreleased semantics remain explicit unsupported capabilities. No broad behavior fork is added. WDK base-contract upgrades are a separate change from this native release. |

RLN #180 also merged to `dev`, but it authenticates the separate TCP signer
daemon. The WDK native path uses `NativeExternalSigner` in process. Its title
alone is not evidence of an unauthenticated TCP endpoint in this integration.

## Security And Distribution

| ID | Gate | Evidence / required decision |
| --- | --- | --- |
| D01 | Native dependency security review | RustSec refreshed October 9 to `7eebec69c352c7191b1f13eb95dd510eeca5d1de`. Both locks still report five vulnerabilities. rkyv/rsa are absent from the selected normal/build graph. `rustls-webpki 0.101.7` is selected through minreq/esplora-client. The inspected minreq server-certificate path supplies no CRLs, so the CRL parsing advisory is not shown reachable there. URI/wildcard name-constraint advisories still require documented security disposition or an approved correction. There are also three unmaintained-crate warnings and two yanked lock entries; selected `chacha20 0.10.1` needs disposition. A clean npm audit does not close native findings. No advisory is suppressed. |
| D02 | Redistribution and notices | Private-source read access is resolved. It is not redistribution approval. Review licenses/notices for the exact selected native graph and approve distribution of the bundled binaries. Dependency metadata is retained locally for this review. |
| D03 | Final artifacts and publication | Review exact final tarballs, hashes, provenance and supported runtime floors, then approve registry versions/dist-tags and publication order: Node/Bare peers before WDK. No registry publication, tag or merge is authorized by a successful test. |

## Remaining Qualification

| ID | Gate | Completion criteria |
| --- | --- | --- |
| Q01 | Mobile release-runtime acceptance | Actual release worklets on supported iOS simulators and Android 4-KiB/16-KiB emulators: native loading, runtime identity, TLS, BTC/RGB send/receive, pending/settled/history, background authentication and teardown. Debug flows and ELF audits do not substitute. Android RGB send/history and interactive release-artifact checks remain incomplete. Desktop control failed during this pass (`cgWindowNotFound`). |
| Q02 | Public Signet / mainnet deployment | Approve exact asset IDs, indexers, proxy, Ethereum RPC/bridge, confirmation policy and operational recovery. Local regtest proves neither public endpoint compatibility nor long-history validation performance. Mainnet startup must be checked independently of API-level Lightning rejection. |
| Q03 | Supported Node/runtime range | Record tested Node versions, OS floors, libc/OpenSSL and architectures. Five platform builds are not a claim that every version allowed by a broad engine range was exercised. |
| Q04 | Release signing and operations | Android artifacts use local test signing. Approve distribution/signing, privacy-safe diagnostics, service configuration and incident/recovery ownership. Existing-wallet migration is excluded because there are no live wallets. Physical devices remain excluded by request, not counted as a pass. |

Wallets, source checkouts, existing chain volumes and prior evidence are retained.
Only disposable local fixtures are used for this qualification.

## Evidence Index

Local artifacts and command logs: `/tmp/wdk-release-ci-20261009/`.
No wallet directories or seeds are committed.

- Node five-platform archive/manifest/consumer results: `node-verified/complete-matrix.json`.
  CI inputs are from runtime run 37629617639, with both GNU inputs replaced by
  successful jobs from run 37926368735. Native source, adapter, wrapper and lock
  identities match. The latter PR merge ref has the same tree as the release
  branch fix; its Git merge SHA differs.
- External unlock: `wdk-external-eth-unlock-lNKzHX` (Node),
  `wdk-external-eth-unlock-WWu2Tx` (Bare), 12 cases each.
- Unlocked same-process reopen: `wdk-rln-reopen-8eehA5` (Node),
  `wdk-rln-reopen-duDSvd` (Bare), both fail to reacquire signer storage.
- Four-schema funded/export: `wdk-rln-assets-LyKvwE` (Node),
  `wdk-rln-assets-xMmHFd` (Bare), all 14 recorded steps each.
- BTC cold-copy and confirmed spend: `wdk-rln-cold-copy-jeoSn0` (Node),
  `wdk-rln-cold-copy-J0sCzR` (Bare), all six recorded steps each.
- BFA funded/invalid-mint: `wdk-bfa-L0N3N2` (Node), `wdk-bfa-qum9YP` (Bare),
  ten steps each. `wdk-bfa-ugIt93` fails the valid-after-wrong-lock case.
- Pending balance: `wdk-rln-pending-balance-J4Fnwq` (Node),
  `wdk-rln-pending-balance-3r4Ga0` (Bare). WDK and direct native responses are
  equal: pending future 200000 for one 100000-unit receipt; settled/future/
  spendable each become 100000 after confirmation. Both acceptance runs fail.
- Native audit: `rust-node-audit.json`, `rust-cffi-audit.json`,
  `native-metadata.json`, `native-selected-tree.txt`. All three production npm
  audits report zero findings.
