# Released RLN On-Chain Adoption

## Approved Import Extension (2026-09-27)

This candidate is RLN `v0.13.0-beta.3` (`af03c7f1a65135a429f05a5820600338215954dc`)
plus the narrowly scoped [RLN import PR #128](https://github.com/UTEXO-Protocol/rgb-lightning-node/pull/128)
at `5d5aa742984d52767e1055fed6aa154ad732d551`. It is not an unmodified upstream release.
The released RGB-lib revision, root Cargo lockfile and rust-lightning gitlink are unchanged.
Contract import validates public metadata and grants no balance. Transfer-consignment import
registers metadata only; it does not replace the normal RGB receive/settlement protocol.

Current checks: funded Rust SDK NIA/IFA import, idempotence, identity rejection, zero balance
before receipt, named IFA invoice, real transfer and allocation-preserving reimport passed.
Node host debug build, 14 wrapper/installer tests, native lifecycle canary and types passed.
Bare host debug build, 37 wrapper/installer tests and native lifecycle canary passed.
WDK: 706 tests, types, lint and package verification passed. Fresh-wallet IFA import
and actual named-invoice receipt/send settled on both Node and Bare 1.32.0. Both
started with zero imported balance, received 250000 units, sent 100000 units and
preserved the resulting 150000/100000 balances across reimport. Node also repeated
NIA/IFA/CFA/UDA receipt and two-sided transfer settlement. These are regtest fixtures,
not production USDT. Mobile release artifact requalification and final Iris integration
are in progress; historical artifact/runtime passes below do not qualify
this new import patch. No physical-device tests, publication or production approval.
The existing signer-reopen, reorg/recovery, VSS and deployment gates remain separate.


Target: RLN 0.13.0-beta.3, fresh wallets, on-chain Iris. Continue the existing
release/rln-0.13.0-beta.3 drafts: WDK #44, Bare #21, NodeJS #23, Iris #8.
No VSS work, upstream behavioral fork, wallet migration or physical device run.

## Acceptance Gates

| ID | Work | Status | Evidence / remaining gate |
| --- | --- | --- | --- |
| P01 | Preserve pending_blinded through C-FFI and wrapper types | Node and Bare host native pass | Funded blinded counts 1/2 preserved through process restart; Rust conversion regression passed for 0/3/u32::MAX; Node 13/Bare 34 installer tests |
| P02 | Normalize released DTOs at Iris boundary | Implemented and unit-tested | Strict assignment grammar/u64 boundary, WaitingBroadcast and sequential portfolio/history reads; full Iris suite and coverage gates pass |
| P03 | Replace prepared-plan UX with released one-shot sends | Implemented; bounded Android funded pass | Released BTC send and RGB output setup with recipient/amount or output-count/fee-rate review, durable markers and no replay. Funded app RGB transfer and remaining mobile lanes are open |
| P04 | Explicit non-reuse address policy and safe legacy rotation | WDK implemented; Node and Bare funded pass | Seven strict native checks pass on each runtime: setup/witness script isolation, actual settlement of all three interleaved witness invoices, and balances/reservations/funded BTC addresses persisting after process restart |
| P05 | Fresh-wallet unknown-asset receive | Planned | Generic invoices must not promise a particular asset; no custom import or mislabeled USDT invoice |
| P06 | Sequential refresh/history with partial/error states | Implemented; Android native BTC reads pass | Strict native network enum normalization; source-specific history health avoids false BTC warnings from unconfigured RGB. Sequential/known-script scope and untracked address receipts remain explicit |
| P07 | Native signer lifecycle and runtime containment | Signer lock open; app containment verified | Android reproduces same-process lock; sanitized restart guidance is observed, no reset/reinstall or automatic retry. Bare Android TLS unload fix passes two normal worklet Reload cycles; separate Expo debug deep-link exception remains |
| P08 | One-shot failure and interrupted-broadcast recovery | Host tests and bounded Android SQLCipher recovery pass | Real app process death after setup broadcast/ack before confirmation retains unresolved marker, no resend, then reconciles after six blocks. BTC send survives cold restart. Arbitrary commit-boundary kills and mobile disk-full remain unqualified |
| P09 | New-wallet restore and address discovery | Pending | FastSync alone is insufficient evidence |
| P10 | Rebuild and fingerprint all supported artifacts | Seven Bare artifacts and five Node CI targets pass | Bare source 642572d relinks all seven with verified archive hashes. Iris current Android Debug APK passes 72 ELF/ZIP checks and live 16-KiB RELRO; funded flow identities recorded separately. Funded iOS and latest Release execution remain open |
| P11 | VSS and Lightning-only extensions | Excluded | Preserve existing WIP; do not advertise unsupported guarantees |

## Current Mobile Follow-Up (2026-09-27)

- Iris now uses released one-shot sends/setup and sequential reads. Unsupported
  contract/consignment imports are removed; named USDT requires exact native
  membership and never substitutes a generic invoice. Unknown-asset first receive
  remains unavailable; seed discovery remains unproven with FastSync.
- Fresh Android 16-KiB wallet was funded with 1,000,000 regtest sats. Native
  output setup creates four 20,000-sat outputs (567-sat fee); 10,000-sat BTC send
  has independently verified 285-sat fee and six confirmations. Persisted setup
  survives process termination before confirmation without replay. Cold restart
  restores balance/history. Exact public transactions and binary hashes are in
  Iris's integration tracker, not inferred from mock tests.
- Bare source `642572d` adds Android DF_1_NODELETE and bounded validation plus
  link-recipe provenance. This fixes a separately symbol-correlated Rust TLS
  destructor call into unmapped addon code. Two normal Reload cycles replace
  worklet threads in one surviving process, with no crash and protected live
  RELRO. Re-authentication still reproduces the independent signer database lock.
  A dev-client deep link hits a separate Expo debug React-context exception;
  it is not reported as passing or as an observed Release crash.
- Iris current gates: 212 suites / 2,372 tests, unchanged coverage, typecheck,
  lint, Expo Doctor, production export credential scans and dependency audit
  pass. Required installed API gate fails only on deferred `vssDeleteAll`;
  remote CI is not green. Original dev/VSS work remains untouched.
- Existing stack passes its read-only pinned-image doctor at height 3852.
  No volume reset or real-network funds. Mobile first-asset RGB receipt, funded
  iOS, latest Release execution, production connectivity/asset approval,
  remaining adverse recovery and full native lifecycle remain release gates.
  The original generic mobile fixture's older dependency audit is separate from
  the now-passing Iris audit.

## Verification Log

### 2026-09-27 Current Identity Follow-Up

- All seven Bare targets rebuilt and verified at `78d34c4`; all five Node native
  matrix targets passed run 36228166056 at source commit `549c428`. These are
  artifact/offline checks, not funded networking on every target.
- Updated strict host disk-full fixtures pass: Node `wdk-rln-storage-0DGXfK`,
  Bare `wdk-rln-storage-DV69PE`. Interrupted-send fixtures pass: Node
  `wdk-rln-interrupted-BzwkU1`, Bare `wdk-rln-interrupted-tkKNn8`. The bounded
  volume was restored and unmounted; no wallet replacement or automatic resend.
  Timing is dispatch-relative, not a proven database-commit crash boundary.
- Iris `88a9062` pins the verified artifacts and explicit address policy. New
  iOS Debug build and cold launch reach the locked-wallet screen. This is not
  authenticated wallet or funded app evidence. Android input staging passes
  provenance, symbols and 16-KiB ELF checks for all three ABIs, but APK assembly
  timed out downloading Kotlin 2.1.20 from Maven before app compilation.
- WDK CI run 36231326910 and Bare CI run 36229814128 pass. Source, artifacts and
  private wallet evidence were retained while only completed compiler caches
  were removed. Historical mobile runs below qualify their original identities.

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
