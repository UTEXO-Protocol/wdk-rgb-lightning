# Released RLN On-Chain Adoption

Target: RLN 0.13.0-beta.3, fresh wallets, on-chain Iris. Continue the existing
release/rln-0.13.0-beta.3 drafts: WDK #44, Bare #21, NodeJS #23, Iris #8.
No VSS work, upstream behavioral fork, wallet migration or physical device run.

## Acceptance Gates

| ID | Work | Status | Evidence / remaining gate |
| --- | --- | --- | --- |
| P01 | Preserve pending_blinded through C-FFI and wrapper types | Node and Bare host native pass | Funded blinded counts 1/2 preserved through process restart; Rust conversion regression passed for 0/3/u32::MAX; Node 13/Bare 34 installer tests |
| P02 | Normalize released DTOs at Iris boundary | Implemented and unit-tested | Strict assignment grammar/u64 boundary, WaitingBroadcast and sequential portfolio/history reads; full Iris suite and coverage gates pass |
| P03 | Replace prepared-plan UX with released one-shot sends | Explicit approval required | Automated safety review rejected removal of exact-fee/preauthorized-transaction guarantees; proposed edit was not applied. Approval requested for clearly disclosed fee-rate authorization and durable unknown-outcome handling, or disabled sends |
| P04 | Explicit non-reuse address policy and safe legacy rotation | WDK implemented; Node and Bare funded pass | Seven strict native checks pass on each runtime: setup/witness script isolation, actual settlement of all three interleaved witness invoices, and balances/reservations/funded BTC addresses persisting after process restart |
| P05 | Fresh-wallet unknown-asset receive | Planned | Generic invoices must not promise a particular asset; no custom import or mislabeled USDT invoice |
| P06 | Sequential refresh/history with partial/error states | Implemented; app native qualification pending | Iris contract v4 records sequential/known-scripts reads and null block hash; recovery remains pending; BTC requests explicitly untracked without released address receipts |
| P07 | Native signer lifecycle and runtime containment | Upstream defect; containment pending | Same-process retained DB lock is not fixed by handle disposal |
| P08 | One-shot failure and interrupted-broadcast recovery | Pending | No duplicate submission; signing/write-failure qualification |
| P09 | New-wallet restore and address discovery | Pending | FastSync alone is insufficient evidence |
| P10 | Rebuild and fingerprint all supported artifacts | Pending after adapter edit | Host native probes, mobile builds, installed identity, post-link alignment |
| P11 | VSS and Lightning-only extensions | Excluded | Preserve existing WIP; do not advertise unsupported guarantees |

## Verification Log

- 2026-09-26: all four remote draft heads match the audited local release heads.
  Original Iris dev worktree contains unrelated VSS work and remains untouched.
- Baseline source audit: `docs/engineering/rln-013-custom-patch-audit.md` in the
  Iris workspace. Historical tests apply only to their recorded binary identities.
- Signet/mainnet are not certified by regtest or mocked tests. No release or merge
  approval is implied by an implementation or build passing.
- Initial WDK run: 21 suites / 700 tests pass; declarations pass. Bare 34 installer
  tests pass after updating the expected adapter checksum. Native Node rebuild is
  in progress; its earlier runtime evidence does not qualify the changed adapter.
- Adapter SHA-256 is now
  `4a4272cb616ceb2f21e01677a24fe7b246c233408c22e6a103bd2db1cea30c94`.
  The dependency graph and allowed native source files remain unchanged.
- Node optimized rebuild completed in 12m42s. Native offline canary passed.
  Funded fixture: `tests/regtest/address-policy.mjs`, run ID
  `wdk-rln-address-policy-rRid0l`: all six checks passed. Private wallet directories
  contain seed material and must not be committed or uploaded; only sanitized
  results may be retained. Bare host rebuild is in progress.
- Bare host optimized rebuild and offline canary passed. Funded fixture run
  `wdk-rln-address-policy-tDsKgJ`: all six checks passed. The initial Bare fixture
  invocation had an incorrect executable path and performed no wallet work;
  rerun used the installed Bare 1.32 executable directly.
- iOS arm64 simulator native rebuild passed. Other changed mobile artifacts
  still require rebuilding; previous-identity evidence is not reused.
- Removed only the completed Node Rust `target` cache (3.0 GiB). Packaged native
  binary, source, wallet data and qualification evidence were preserved.
- Iris read/DTO milestone pushed as `f9b08c9` to existing PR #8: all 212 suites /
  2,341 tests pass on Node 22. Prepared-send adoption is not included. Bare adapter
  milestone pushed as `78d34c4` to existing PR #21. NodeJS PR #23 CI passed;
  native matrix is still running (three platforms passed at last inspection).
- Extended funded fixture runs `wdk-rln-address-policy-ScQkKP` (Node) and
  `wdk-rln-address-policy-G85b3k` (Bare) each passed all seven checks, including
  actual RGB settlement after setup and persistence after another process restart.
- Iris receive/pin follow-up: 212 suites / 2,340 tests and existing coverage
  thresholds pass; typecheck and lint pass. Required installed-account API gate
  still fails on 13 custom on-chain methods and deferred `vssDeleteAll`.
- macOS arm64, all three iOS targets and Android arm64 rebuilt with the new
  identity. Android arm32/x64 and updated app mobile qualification remain pending.
- WDK CI detected the engineering tracker in the npm tarball. Added a specific
  `.npmignore` exclusion; package allowlist check now passes. No package gate
  was relaxed. The initial local pack attempt lacked npm cache access; rerun
  with normal cache access passed.
- Removed 6.0 GiB of completed iOS compiler caches only after artifact import
  and provenance verification. Source, binaries, wallet data and active Android
  compiler output were retained. Read-only stack doctor passes at regtest 3630.
