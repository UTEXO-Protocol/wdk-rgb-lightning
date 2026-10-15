# Release qualification: 0.2.0-beta.4

Working branch: `release/rln-0.15.0-beta.3`. This register separates engineering
verification from decisions about release scope. An item is closed only by the
evidence listed here, not by a general CI success.

## Candidate

October 15 lifecycle repair supersedes the October 14 native adapter identity
below. Both native peers now expose explicit terminal signer shutdown and own
session task/listener cleanup; WDK drains its node before revoking/freeing the
signer and retains failed cleanup handles for retry. Terminal metadata pools
close on their owning runtime; nonterminal REST lock keeps its database. Exact overlay identity is
enforced by `src/native-runtime-contract.js`; required capabilities include
`native-signer-shutdown-v1` and `owned-session-cleanup-v1`.

Focused native qualification passes 31 lifecycle/signer/startup/VSS tests and
14 C-FFI tests. WDK passes 26 suites / 977 tests, lint, types and package checks.
Rebuilt artifacts, repeated real same-process reopening and funded iOS 27
acceptance are in progress. P01 remains open until those tests demonstrate
closure for this exact implementation. Historical failures below retain their
original identities. Iris stays on-chain only; no wallet migration is required
because Iris has not shipped. No merge or publication is part of this repair.

October 14 source upgrade: WDK requires RLN `v0.17.0-beta.3`
(`ecc69f20308231400561f6f060fea88acfa40cc4`), rust-lightning
`79b9eb5166546c62692d3a672986f385c7fe047d`, rgb-lib
`v0.3.0-beta.50-bfa` (`1b951af0c8233308c919975552487be19ad2a930`), and the
shared native adapter
`bbec56a1ef9c05feb9d50a9edab556837be872f482bf1183493a4f449f45275d`.
WDK and exact native peers are unpublished `0.2.0-beta.4` candidates. The
compiled runtime version is `0.17.0-beta.3`. The existing branch name is retained.

The runtime gate rejects stale versions, source/LDK/adapter identities and
missing required capabilities before handle creation. The on-chain WDK API
is unchanged, including `external-signer-burn-v1`; Iris remains on-chain only.
No BFA channel support, merge, publication or production approval is inferred.

### October 14 Qualification

Fresh tests for this exact graph are recorded here as they complete. Native
artifact, funded, adverse-recovery and mobile results require their own evidence;
October 12 successes and failures below retain their original source and scope.
P01/P02/P03/P04/P06, D01/D02/D03 and Q01/Q02/Q03/Q04 remain release gates until
individually requalified or explicitly resolved within the supported scope.
A beta.50 version number alone does not close a native behavior or security gate.

- Normal peer-checked `npm ci --ignore-scripts` passes on Node 22.23.3/npm 10.9.9.
- Production `npm audit --omit=dev` reports zero findings. Full development
  audit reports 33 findings (28 high, five moderate), propagated from
  [braces GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
  and [sprintf-js GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c).
  Both primary advisories list no patched version as checked October 14;
  registry latest `braces 3.0.3` / `sprintf-js 1.1.3` remain affected. No finding
  is suppressed, and a production-only audit is not a clean full-audit claim.
- Full WDK coverage passes **26 suites / 969 tests** on Node 22.23.3, including
  rejection of every preceding identity field and missing fields on both native
  bindings before `SdkNode.create`. Runtime admission and burn-contract modules
  each retain 100% statement, branch, function and line coverage.
- Strict declarations, Standard lint, the unchanged WebRGB 0.1.0 read/type subset,
  package-content allowlist (44 packed files), three fault-harness process-group
  tests and `git diff --check` pass. None of these mock/packaging checks proves
  native settlement or mobile lifecycle recovery.
- Fresh native lock audits report ten vulnerabilities in each lock against
  RustSec database `6aed84668c23d7f535077a9fe918bf1fa0f6a5bc`. These include
  five new Quinn 0.11.16 findings plus the earlier rkyv/rsa/webpki findings.
  All-target normal/build dependency trees show Quinn/rkyv/rsa are unselected.
  `rustls-webpki 0.101.7` is selected through `minreq 2.14.1` ->
  `esplora-client 0.12.3` -> rgb-lib/LDK. The inspected server-certificate path
  supplies no CRLs; a CRL exploit path is not demonstrated. The remaining
  name-constraint advisories still need security disposition, and no compatible
  patched version for this older API is available. No advisory is suppressed.
  D01 remains open. The October 9 five-finding audit below is historical.
- The test-only beta.50 Rust issuer builds with Rust 1.94.0, `--locked --release`,
  two jobs and a separate target directory (initial build 6m 22s; typed burn
  inspection follow-up 18.73s). Final executable SHA-256:
  `98ede42860e8adb4d868f2e7cf4bbb85ebd11f10f41bc3b29f77a53e20ba78a9`;
  final issuer lock SHA-256:
  `fd04a78e7b83bcca67d27d09b5776dd14775224b8104a36013ab63dcbfda8c2e`.
  Missing/malformed proof inputs reject in two real-helper negative controls.
  The read-only typed inspector decodes metadata without importing proof or
  claiming consensus validation. Compilation is not funded acceptance.
- Earlier [WDK source CI](https://github.com/UTEXO-Protocol/wdk-rgb-lightning/actions/runs/38535330952)
  passed at `ffc21385cf4b507428e0efe0b9c5eca9ffd0d82c` with the first beta.4
  adapter identity; final-source CI is tracked separately after the build-profile
  correction. It is not a native packed-consumer result.
- The final adapter binds a reproducible native build-profile correction for
  Rust 1.94 proc-macro loading on macOS 27: compile-time build dependencies use
  `strip = "none"`; final library stripping and Android protection gates are
  unchanged. C-FFI/source behavior and the WDK API are unchanged. Exact adapter
  provenance still changes, and older beta.4 artifacts are rejected.
- Final WDK source CI passes at `b773f71a717488a36e2483819a4f65934db007cd`
  ([run 38536205990](https://github.com/UTEXO-Protocol/wdk-rgb-lightning/actions/runs/38536205990)).
  The later burn-fixture commit changes qualification tooling, not the WDK
  implementation identity consumed by Iris. Latest qualification-tooling CI also
  passes at `1f3db541ec889e3eddeb93611913727313aa1f58`
  ([run 38543074023](https://github.com/UTEXO-Protocol/wdk-rgb-lightning/actions/runs/38543074023)).
- A clean packed Bare/WDK host consumer passes with the final `bbec56a1` addon
  and `bare-runtime 1.33.0`: public exports, exact provenance, signer bootstrap,
  mainnet Lightning rejection and unchanged WebRGB policy. This qualifies the
  tested macOS ARM64 host package, not a complete seven-target release archive.
- Exact-source Bare 1.33.4 passes all 12 external-unlock cases and the four-schema
  funded NIA/IFA/CFA/UDA receive/witness-send scenario (14 recorded steps).
  The scenarios use the isolated qualification chain and strict persistent signer.
- **P01 freshly fails on RLN 0.17 / beta.50 / final `bbec56a1` Bare host.** The
  unfunded unlocked same-process reopen case returns
  `FFI panic in rln_native_external_signer_new_with_storage` and
  `Database already open. Cannot acquire lock.` It fails after 12.13s on
  October 14. Cold restart, fresh builds and passing mock tests do not close it.
  Evidence: `../release-evidence/2026-10-14/bare-reopen-20261014T085201Z.summary.json`
  plus the private fixture's retained `results.json`. No storage reset was used.
- **P04 freshly fails on the same exact beta.4 Bare graph.** For one incoming
  100,000-unit witness receipt, native and WDK both report pending `future: 200000`;
  after confirmation, settled/future/spendable each become 100,000. Correct
  settlement does not close the unconfirmed double-counting failure. Evidence:
  `../release-evidence/2026-10-14/bare-pending-balance-20261014T090114Z.log`
  and the retained private fixture's raw `results.json`.
- A clean packed Node/WDK host consumer passes against the earlier native Node
  implementation `9c86498585382fe7d6e2fae3cbb2842b7c9cb233`, actual Node
  `22.23.3` on macOS ARM64. Native recipe
  `f7113f4e7b8f3bef09c97568f7f4ec0bc24a16f049f4268dbe9fba490a3b177c`
  uses Apple linker symbol/debug stripping plus a structural Mach-O guard to
  preserve loader alignment. The rejected pre-fix LINKEDIT artifact is not
  qualification evidence. Independent review subsequently found that consumers
  skipping postinstall could reach native loading before sidecar/recipe/layout
  checks. The native owner rebuilt a pre-loader correction; this dated
  `9c864985` result cannot qualify that later wrapper. Runtime core/adapter
  identity remains unchanged.
- Final pre-loader Node source correction
  `42b5fcbe505ec9b6aa7b48273507fb43cf96c491` is independently reviewed; all
  four admission regressions pass, including hash-matching malformed Mach-O
  rejection before any native loading. A clean packed WDK consumer then passes
  on actual Node `22.23.3` / macOS 27 ARM64 using the newly rebuilt host pack
  at `82eeb4cea5038c007b44036307834156a26c71d5`: wrapper
  `3647ddc882ff0e04133f69d14123f2dba3c111ca31d47ffc4946a4bf402ef30d`,
  recipe `07c989d17d2bf6be5cbb6d9e491937316dd67a68dd09aafa755aa91dc4ec7a84`.
  Public exports, exact native admission, strict signer bootstrap, mainnet
  Lightning rejection and WebRGB policy pass. This qualifies the tested host
  pack; other targets require their own evidence.
- The final `3647ddc8` / `07c989d1` Node host then independently passes 12
  external-unlock cases, 14 four-schema steps, 11 BFA mint/send/burn steps,
  seven address-policy checks, six cold-copy steps and eight BTC reorg steps.
  It freshly reproduces P01, P03 and P04; exact addon/sidecar identity and
  unchanged native inputs are recorded per run. Its default interrupted-BTC
  case passes eight steps, and all seven widened delays pass (12 recorded
  steps). This Node timing result does not close the clean Bare 10ms P02
  failure. The complete serial batch has 13 cases: nine pass and four fail
  (P01/P03/P04/P06). Its final event-selection case also fails after ten earlier
  passing steps; its bounded HFS disk-full case passes all nine steps. Evidence
  summaries `node-bfa-event-selection-20261014T120343Z.summary.json` and
  `node-disk-full-20261014T120433Z.summary.json` bind the final sidecar, addon
  SHA-256 `f446350f13157bcbc7d9942bd719dd490e69ae490a67e75125d8245a94759767`
  and unchanged input bytes.
- The corrected Bare `--burn` fixture passes all 11 recorded steps at
  qualification-tooling commit `1f3db541ec889e3eddeb93611913727313aa1f58`:
  mint 1,000, witness send 25, one burn 100, five-field on-chain-only balances
  875/25, public proof metadata/bytes, and exact balances/proof through cold
  restart. Missing-lock and wrong-amount-lock rejection checks still execute.
  The first burn attempt stopped before submission because its test expected
  only three balance fields; the corrected fixture also requires both zero
  off-chain fields. Failed fixture/log retained; no burn replay occurred.
- Current Bare cold-copy (six steps) and BTC reorg (eight steps) pass within
  their fixture scopes. **P03 freshly fails:** after disconnecting a settled RGB
  receipt, the beta.50 host still reports 10,000 settled units. These passing BTC
  scenarios do not qualify RGB rollback.
- **P02 remains intermittent/open on the current Bare graph.** The 100ms
  interrupted-BTC case leaves spendable balance 0 instead of 2,000,000 after
  recovery. A separate clean default three-delay run passes. A widened seven-
  delay run stops before interruption during funding sync with transient
  `Esplora 404 Blocknotfound`; it is a precondition failure, not another proven
  reservation failure. A later clean widened run passes 0ms, then reproduces
  the actual 0-versus-2,000,000 spendable failure at 10ms. Evidence:
  `bare-interrupted-btc-wide-20261014T113851Z.summary.json`. Mixed passes do
  not erase the observed failed timings.
- The `9c864985` Node host passes all 12 external-unlock cases; unlocked
  same-process reopen freshly reproduces P01 on that wrapper too. These results
  retain that earlier wrapper identity; final-wrapper results are recorded above.
- Both exact beta.4 wrappers freshly fail **P06**: for one mint OpId, an earlier
  amount 1 lock followed by the valid amount 1,000 lock yields `Failed`, not
  `Settled`. Ten earlier leaf steps pass in each scenario. Latest serial evidence:
  `bare-bfa-event-selection-20261014T113414Z.summary.json` and
  `node-bfa-event-selection-20261014T120343Z.summary.json`. The earlier
  `9c864985` reproduction is retained in the index. This event-order gate is
  separate from ordinary mint/burn and independent burn-proof happy paths.
- All seven Bare targets and the earlier five-target `9c864985` Node hosted
  matrix pass. The [final pre-loader Node matrix](https://github.com/UTEXO-Protocol/rgb-lightning-node-nodejs/actions/runs/38559279576)
  at `82eeb4cea5038c007b44036307834156a26c71d5` now passes all five targets,
  including actual GNU/musl runtimes; its source CI passes. Both GNU binaries
  independently require a maximum GLIBC 2.34. Original hosted Darwin arm64
  and x64 artifacts also pass actual macOS 27 / Node 22.23.3 canaries (Rosetta
  for x64). The complete final five-target local artifact gate passes and is
  independently rerun: original hosted sidecars/archives remain preserved;
  the central set records two separately qualified local Darwin builds and
  three original hosted Linux binaries, without restamping. Origins, checksums
  and actual runtime versions are recorded in the native report and
  `native-node-final-admission-artifact-origins.json`.
  This does not qualify mobile app execution or resolve P01/P02/P03/P04/P06.
- The earlier `9c864985` Node host passes 14 four-schema steps, 11 normal BFA
  mint/send/burn steps, six cold-copy steps, eight BTC reorg steps and eight
  default interrupted-BTC steps. It also fails P01/P03/P04. These dated results
  are retained alongside the final-wrapper rerun.
- A separate locked/rebuilt beta.50 validator passes the Bare and Node burn
  proofs with live Bitcoin and FundsIn resolution. The final Node wrapper's
  fresh exported proof also passes; proof SHA-256
  `d213c151309dc65f507f8637136de3dcd564113fdbbee17c42ced11309474ffb`.
  Missing FundsIn events reject in consensus validation; wrong recipient and
  wrong amount reject against the expected proof metadata. Its source/lock
  identity is separate from the native and issuer helpers. Evidence:
  `node-final-admission-burn-proof-validation.json` and
  `node-final-admission-burn-proof-controls.json`. No EVM payout or mobile burn
  pass is inferred.
- Node address-policy checks pass seven steps. Bare's bounded 128MiB HFS
  disk-full case passes nine steps: verified ENOSPC, observed native mutation
  outcome, capacity restoration/cold restart, an independently verified new
  send and clean detach. Evidence:
  `bare-disk-full-20261014T114627Z.summary.json`. This closes that bounded host
  scenario, not arbitrary disk-full/crash boundaries or mobile recovery.
- The local index retains all 40 October 14 runs, including historical wrappers,
  precondition failures and corrected test expectations. Latest exact Node
  results replace their scope only; they do not erase failed Bare timings.
- Complete artifact gates do not qualify app/device behavior, resolve the
  observed native failures or approve production. Earlier passes below do not
  qualify beta.4.

### October 12 Qualification (Historical)

The following results qualify beta.3 and its recorded graph, not beta.4.

Implementation pins: WDK `c941925ab8a9b2d75356d223d5eed74c3dd74647`, Bare
`cc62bf3a1765d89cb8b0b990ea16a47936f799de`, Node
`c30cf547fb2960f737b1463f3410445f43932b1b`. rgb-lib beta.47-bfa resolves to
`74a096a5bfbba7744af16c36c3595a24464c134c`. Documentation-only branch updates
do not replace these implementation pins.

| Item | Latest result and boundary |
| --- | --- |
| Exact-source native artifacts | All seven Bare hosted jobs and all five Node runtime jobs pass. Complete local artifact gates, source/adapter provenance, symbols and applicable Android ELF checks pass. This supersedes earlier build-matrix status, not historical runtime failures. |
| Funded BFA / burn proof | Exact WDK/Bare Darwin ARM64 host receives 1,000,000, sends 250,000, burns 100,000 and preserves 650,000/250,000 across fresh processes. Independent beta47 consensus validates the exported proof; missing FundsIn events, wrong amount and wrong recipient reject. Node-funded, EVM-payout and mobile flows are not qualified by this run. |
| Fresh BFA contract bootstrap and first receipt | Separate native host evidence proves genuine contract-only import at zero balance, wrong-ID rejection, idempotence and an exact BFA-bound `Any` invoice without an amount. The first mint to that invoice now settles 1,000,000 units; settled/spendable/token balances remain 1,000,000 after a separate-process reopen. Invoice recipient and settled transfer match. This closes the host first-receive check, not mobile receipt or same-process recovery. The earlier funded sequence used an unbound invoice and remains separately scoped. |
| Iris integration | Normal peer-checked install with final implementation pins passes after literal npm override correction. Latest frozen app/fixture coverage passes 235 suites / 2,727 tests, including the BFA send-schema correction, bridge allocation-readiness gate and local fixture nonce-preservation checks; typecheck and uncached lint pass. These tests do not qualify a fresh mobile bridge blind mint. Optional transitive peer warnings, native/app security and runtime gates remain separate. |
| Android BFA first receipt | Actual 16-KiB Iris runtime passes fresh contract bootstrap, asset-bound Witness invoice creation and receipt of exactly 1,000,000 units. The settled UI shows 1.00 USDT without a pending label. Before settlement, refresh changed 1.00 pending to 2.00 pending for that sole receipt: **P04 fails on the current beta47 graph**. Correct settlement does not close pending accounting. |
| Android BFA Witness send | After explicit RGB output setup, one PIN-authorized 250,000-unit send to a bound host Witness invoice settles at three confirmations. Android shows 0.75 USDT without pending; the exact-source host receiver reports 250,000 settled/future/spendable units and token balance. This qualifies that regtest emulator round trip, not mobile burn, WalletConnect, recovery, physical hardware or production. Normal Iris sends remain Witness-only. |
| Android same-process resume | **Failed on actual 16-KiB runtime.** After system-share-sheet backgrounding, signer recreation panics with `Database already open. Cannot acquire lock.` Iris fails closed with restart guidance, without reset. This keeps P01 and Q01 open and blocks claiming WalletConnect external-browser return is qualified. |

Native target details, CI links, exact proof hashes and app evidence paths are
in the [October 12 follow-up](./RELEASE-0.15-TRACKER.md#october-12-native-and-app-qualification-follow-up).
No publication, production, physical-device or same-process recovery approval
is inferred. P02/P03/P04/P06 and security/distribution gates remain open pending
their own exact-source evidence.

### Historical #192 Baseline

The baseline and engineering results in this subsection describe the earlier
#192 graph. They are retained as history, not silently transferred to October 12.

- WDK runtime baseline: `0d44024e4949f399cbd24fd55c4d5c9b48dfda02`.
  This follow-up adds qualification documentation and the pending-balance
  acceptance test, without changing runtime behavior.
- Node runtime/wrapper baseline: `9617e4d3273be1b9f70e5aaa6693026e5bbae25f`;
  GNU CI compatibility correction: `66d55fc14195ca2ecff623704a4e2c410001a036`.
- Bare runtime/wrapper baseline: `d1bb37c6a220451c04d9db7f8d4c1f07f650a65e`;
  stricter post-link verification: `73f79e1b2bda310dfca6e5fa1a01c3ec651edadc`.
  October 10 adds public byte-preserving Android staging without changing
  native source, adapter, wrapper or build recipe.
- Native source: RLN `a17b685615750536f0320db1cd3f3ba68a8f1c57`, including
  external-signer Ethereum RPC support merged in RLN #192. This is newer than
  the `v0.15.0-beta.3` tag; the tag alone is not an equivalent build.
- Native adapter: `93d62bb91c0ab90a7ccc4a1382a9da84498e38506170ce74d3863292f0c9f2f4`.

## Historical Engineering Work (#192)

| Item | Status | Evidence / next check |
| --- | --- | --- |
| Private native source access in CI | Closed | `ORG_READ_TOKEN` initialization already exists. Node contract run 37629617616, Node runtime run 37629617639 and Bare contract run 37629619939 passed on attempt 2. |
| Node optimized builds and assembled package | Passed for the tested matrix | All five inputs are CI-built. The rejected ARM64 Ubuntu 24.04 artifact is excluded; both GNU replacements require glibc 2.34 and load on Ubuntu 22.04. One assembled archive passes five fresh offline installs, all-target provenance and native canaries. macOS/GNU consumers use Node 22.23.0; Alpine/musl uses 24.18.1. |
| Bare optimized seven-target build | Prior run: five passed; two packaging failures | Candidate-only run 37925315347 still records raw-link failures on both 64-bit Android targets. The new workflow verifies public byte-preserving staging for all three Android ABIs; its hosted results must be checked separately. |
| Android RELRO/DYNAMIC packaging (P05) | Closed for the documented staging integration | The public Bare hook verifies original prebuilds and preserves their bytes. All three Android ABIs pass static checks; one APK passes real ARM64 4-KiB and 16-KiB worklets with RELRO/DYNAMIC read-only in memory. Raw bare-link output remains unsupported. See the supported boundary below. |
| WDK with CI-built native packages | Passed on host | 862 WDK tests, 21 Node tests and 45 Bare tests; declarations, lint, package allowlist and clean packed Node/Bare consumer smoke tests pass. No native source revision changed for the build fixes. |
| Funded regtest checks | Happy paths pass; acceptance failures retained | Both optimized CI host addons pass four schemas, BFA receive/send/balance/history/export, cold restart and invalid-mint rejection. Both pass 12 external-unlock cases. BFA event-order acceptance fails; unlocked reopen and pending witness balance failures reproduce. |
| Android remaining runtime flows | Pending | Existing evidence covers debug BTC send/receive and settled RGB receive on a 16-KiB emulator. RGB send and interactive release-artifact qualification remain open. |

## Native Behavior Gates

P01/P02/P03/P04/P06 have fresh October 14 beta.4 host observations above.
Dated mobile failures below retain their recorded earlier graph. Host passes
do not qualify those mobile paths, public deployment or arbitrary crash
boundaries. Approval alone does not fix them.
Closure requires a verified upstream correction or a narrower supported
configuration that removes the affected behavior. P01 and P04 also retain
October 12 Android reproductions on the beta.47 graph.

| ID | Gate and origin | Network / feature | Required closure |
| --- | --- | --- | --- |
| P01 | Persistent signer database lock after unlock, shutdown and same-process recreation. Native RLN/VLS lifetime, not a Jest or app-only failure. | Historical Signet/mainnet on both wrappers; October 12 beta.47 Android 16-KiB Iris regtest; fresh October 14 beta.50 host regtest on both wrappers | Correct ownership/teardown upstream, or qualify real process isolation with secure lock/unlock and crash recovery. Do not keep an unlocked signer alive after app lock or reset its database. The October 14 beta.4 Bare and final `3647ddc8` Node addons reproduce this without funding. The October 12 beta.47 system-share-sheet/background return reproduced the lock error; cold restart and build success are not closure. |
| P02 | Process death during BTC send can leave an orphaned input reservation. RLN external-signer begin/sign/end integration with rgb-lib. | Historical BTC sends on both networks; fresh October 14 Bare regtest timing-dependent failure | Expose and qualify reconciliation/abort recovery. Prove no unintended replay and retained spendability after interrupted submission. The missing custom prepared-send UX is separate from this underlying recovery requirement. |
| P03 | RGB settlement remains stale after a receipt is disconnected by a reorg. Pinned rgb-lib behavior. | Historical RGB on both networks; fresh October 14 Bare and final `3647ddc8` Node regtest retain 10,000 settled units after disconnection | Prove rollback, cold restart and reconfirmation against an approved upstream graph. Additional confirmations reduce exposure but are not evidence that rollback works. |
| P04 | Incoming witness `future` balance double-counts one receipt before settlement. October 14 beta.4 Bare and final `3647ddc8` Node native/WDK responses double-count one 100,000-unit incoming witness as future 200,000 before settling correctly; raw native and WDK values match. October 12 beta47 Android also reproduced the UI symptom: one 1,000,000-unit receipt becomes 2.00 pending, then settles to the correct 1.00 USDT. | Historical RGB pending balances on both networks; October 12 beta.47 Android 16-KiB regtest; fresh October 14 beta.50 host regtest on both wrappers | Fix native accounting, or explicitly omit unqualified pending projections while retaining truthful settled/spendable balances. Do not cap or divide pending amounts. Correct settled balance is not closure. Run `tests/regtest/pending-balance.mjs` on both runtimes and requalify the mobile pending sequence. |
| P06 | The BFA validator selects an earlier wrong-amount lock instead of a later valid lock for the same mint. Pinned consensus/rgb-lib behavior. | BFA receipt on either network; fresh October 14 beta.50 Bare and final `3647ddc8` Node regtest fail valid-after-wrong-lock acceptance | Qualify the funded valid-after-wrong-lock event-order acceptance test and independently verify the applicable upstream correction (tracked as rgb-lib #103). Beta.50 still returns Failed rather than Settled for this sequence. The October 9 issue-status observation is historical. Ordinary BFA receipt/send and burn-proof passes are not sufficient. |

Existing recovery evidence and reproduction commands are in
[the release tracker](./RELEASE-0.15-TRACKER.md),
[the regtest report](./tests/regtest/QUALIFICATION.md) and
[the BFA report](./BFA-QUALIFICATION.md). The current source is pinned; an issue
recorded here is not a claim that every newer upstream revision has the same bug.

### P05: Supported Android Packaging

Closed for consumers applying the public
[Bare Android staging hook](https://github.com/UTEXO-Protocol/rgb-lightning-node-bare/blob/release/rln-0.15.0-beta.3/android/README.md),
with BareKit 0.15.5, NDK 27.1.12297006 and one JS-loaded RLN version. No incoming
native RLN dependency is supported. Installation alone does not apply the hook;
existing app-specific staging must be replaced, not combined with it.

The helper verifies original release provenance, runtime hashes, imports,
ELF protection and exact copied bytes, then supplies an owned JNI tree to Gradle.
The generic 3.3.2/0.2.10 linker still reproduces the defect. No protection check
was weakened and no source pin or native recipe changed. Consumers using raw linker output still
have P05; approval does not make that configuration safe.

The October 10 fixture verifies actual packaged optimized RLN code through the
public JS wrapper in three successive worklets on each ARM64 page-size emulator.
It is an unfunded signer/loading test, not a complete React Native application
build, unlocked-wallet reopen test or physical-device qualification. ARMv7 and
x86-64 have ELF/import/package evidence, not runtime execution evidence. Q01
and final artifact approval remain open.

## Scope Decisions

| ID | Decision | Current boundary |
| --- | --- | --- |
| S01 | On-chain-only release, or non-mainnet Lightning as well? | Mainnet Lightning already fails with `LIGHTNING_DISABLED_ON_MAINNET`. Signet Lightning APIs remain available, but strict outbound settlement, mature BTC force-close sweep, RGB commitment acceptance and channel recovery are not qualified. On-chain-only scope removes those channel gates, not P01-P06. |
| S02 | Keep the #192 native source or adopt newer merged upstream work? | The October 14 exact pin adopts v0.17.0-beta.3 with rgb-lib beta.50-bfa and rust-lightning `79b9eb5`. The dependency graph changed, not only a capability flag. Native builds, security review and funded/recovery/device qualification remain separate from WDK API tests. |
| S03 | Include burn in this release? | Generic WDK `burnAsset` and native capability gating are implemented. Full accounts report support; read-only accounts do not. Exact-source Bare-host funded burn/proof passes as scoped above; Node-funded, mobile, payout and uncertain-outcome recovery remain gates. Durable bridge operation recovery, sessions, approval and transport are Iris/application responsibilities and are not added to WDK. |
| S04 | Which asset schemas and deployments are supported? | Mainnet IFA is rejected by the current upstream library. Local six-decimal IFA/NIA fixtures are not production USDT. Mainnet BFA needs an approved bridge/token/contract identity and Ethereum RPC configuration, plus P06 closure. |
| S05 | Is VSS part of this release? | Deferred by request. No device-loss or VSS recovery claim. The source contains VSS APIs but that does not qualify the service or recovery policy. |
| S06 | Retain the breaking 0.2 API boundary? | Thirteen legacy custom on-chain operations and related unreleased semantics remain explicit unsupported capabilities. No broad behavior fork is added. WDK base-contract upgrades are a separate change from this native release. |

RLN #180 also merged to `dev`, but it authenticates the separate TCP signer
daemon. The WDK native path uses `NativeExternalSigner` in process. Its title
alone is not evidence of an unauthenticated TCP endpoint in this integration.

## Security And Distribution

| ID | Gate | Evidence / required decision |
| --- | --- | --- |
| D01 | Native dependency security review | Current October 14 lock audits report ten vulnerabilities each; all-target normal/build trees show Quinn/rkyv/rsa are unselected. `rustls-webpki 0.101.7` is selected through minreq 2.14.1/esplora-client 0.12.3. The inspected minreq server-certificate path supplies no CRLs, so the CRL parsing advisory is not shown reachable there. URI/wildcard name-constraint advisories still require documented security disposition or an approved correction; no compatible patched version for this older API is available. Historical October 9 audit at `7eebec69c352c7191b1f13eb95dd510eeca5d1de` reported five vulnerabilities in each earlier lock, three unmaintained-crate warnings and two yanked lock entries; selected `chacha20 0.10.1` needs disposition. A clean npm audit does not close native findings. No advisory is suppressed. |
| D02 | Redistribution and notices | Private-source read access is resolved. It is not redistribution approval. Review licenses/notices for the exact selected native graph and approve distribution of the bundled binaries. Dependency metadata is retained locally for this review. |
| D03 | Final artifacts and publication | Review exact final tarballs, hashes, provenance and supported runtime floors, then approve registry versions/dist-tags and publication order: Node/Bare peers before WDK. No registry publication, tag or merge is authorized by a successful test. |

## Remaining Qualification

| ID | Gate | Completion criteria |
| --- | --- | --- |
| Q01 | Mobile release-runtime acceptance | Actual release worklets on supported iOS simulators and Android 4-KiB/16-KiB emulators: native loading, runtime identity, TLS, BTC/RGB send/receive, pending/settled/history, background authentication and teardown. October 10 loading checks retain their original scope. October 12 native matrices pass, but actual Android 16-KiB same-process background return fails P01. No full mobile/WalletConnect return pass is claimed; force-stop recovery does not close it. Funded flows, TLS, remaining architectures and release interaction need their own evidence. |
| Q02 | Public Signet / mainnet deployment | Approve exact asset IDs, indexers, proxy, Ethereum RPC/bridge, confirmation policy and operational recovery. Local regtest proves neither public endpoint compatibility nor long-history validation performance. Mainnet startup must be checked independently of API-level Lightning rejection. |
| Q03 | Supported Node/runtime range | Record tested Node versions, OS floors, libc/OpenSSL and architectures. Five platform builds are not a claim that every version allowed by a broad engine range was exercised. |
| Q04 | Release signing and operations | Android artifacts use local test signing. Approve distribution/signing, privacy-safe diagnostics, service configuration and incident/recovery ownership. Existing-wallet migration is excluded because there are no live wallets. Physical devices remain excluded by request, not counted as a pass. |

Wallets, source checkouts, existing chain volumes and prior evidence are retained.
Only disposable local fixtures are used for this qualification.

## Evidence Index

Current October 14 local command logs: `../release-evidence/wdk/` (outside the package checkout).
Historical command logs: `/tmp/wdk-release-ci-20261009/` (not restored after the system reset).
No wallet directories or seeds are committed.

Android follow-up: `/tmp/rln-android-link-20261010/`. `public-staging.json` and
`packed-staging.json` cover three-ABI staging; `gradle-contract-final.log` covers
task ordering. `apk-final/package-evidence.json` records signed APK SHA-256
`91a9f9281712f13bf124ff6a6091e1d6f66fde2f35888a2d440672026ab1131a` and exact
staged payload hashes. `runtime-final-4k.log` and `runtime-final-16k.log` each
contain three successful public-wrapper runs, actual read-only mapping checks
and `INSTRUMENTATION_CODE: -1`. The final fixture uses BareKit's published 0.15.5
runtime, not a private app hook. Native source identity remains #192.

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
