# Released-Runtime Qualification: 2026-09-24

Candidate: all three packages `0.2.0-beta.1`, targeting RLN
`af03c7f1a65135a429f05a5820600338215954dc` / `v0.13.0-beta.3`.
See [stack and commands](./README.md). This is a fresh-wallet, VSS-disabled,
standard-channel regtest profile, not Signet/mainnet approval. Existing-wallet
migration is explicitly out of scope because the owner confirmed no live wallets.
No upstream behavior changes, wallet reset, stale-state rollback or permissive
production-policy workaround was introduced.

## Package Fixes

| Finding | Fix and evidence |
| --- | --- |
| Normal `nodeInfo` contains `channel_asset_max_amount=u64::MAX`, breaking both previous safe-number parsers | Pinned lossless-json 4.3.1 parses numeric tokens before rounding. Unsafe response integers become exact decimal strings. Unsafe numeric requests still fail before submission. Unit regressions and all real unlocks below assert the exact maximum |
| WDK accepted a filterless transfer-list request that the release rejects | Mutable/read-only WDK validation and declaration overloads now require asset ID or transaction ID; native combined/txid-only forwarding retained |
| Android NDK r27 build did not request 16 KiB ELF alignment | Explicit max/common page-size flags and flexible-page setting for arm64/x64; installer checks structured LLVM output for LOAD/RELRO alignment, including imported artifacts. All seven target artifacts reverified |
| Documentation implied issuance/inflation worked in WDK external-signer mode | Actual runtime rejection tested for all issuance APIs and inflation; documentation now states the released restriction |

Android validation follows [Android's native library guidance](https://developer.android.com/guide/practices/page-sizes).
ELF checks do not prove APK packaging, JNI/TLS initialization or device behavior.

## Executed Results

Raw `results.json`, private wallet state and native logs remain in each run's
owner-only temporary evidence directory. IDs below are directory basenames.
Do not upload raw wallets, seeds or signer databases. Failed scenarios return
nonzero; later steps in that scenario are unexecuted, not passed.

| Runtime/profile | Evidence ID | Result |
| --- | --- | --- |
| Node, strict, NIA/IFA/CFA/UDA on-chain | `wdk-rln-assets-ISLvfh` | Pass: real funding, metadata, witness nonce/assignment preservation, both-side settlement and balance reconciliation for all four schemas |
| Bare 1.32.0, strict, same asset matrix | `wdk-rln-assets-JAyCNk` | Pass |
| Node, strict, direct channels | `wdk-rln-regtest-xEva0m` | Zero-push BTC channel confirms; first 3,000,000-msat outbound invoice payment stalls awaiting signer. Later Lightning tests blocked |
| Bare, strict, nonzero initial BTC push | `wdk-rln-regtest-HxXLnz` | Funding-created remains deferred awaiting signer; no funding broadcast observed |
| Node, permissive diagnostic, direct NIA/BTC | `wdk-rln-regtest-UvhaWS` | BTC send/receipt, blind/witness RGB, channels, invoices/keysend/HODL, process death/recovery, post-restart RGB payment and cooperative BTC/RGB close pass; same-process reopen fails. This earlier run predates the force-close step |
| Node, final permissive diagnostic, rebuilt stack | `wdk-rln-regtest-LDBE22` | All direct steps including unpaid RGB cancellation and confirmed BTC force-close pass before the same-process reopen failure |
| Bare, permissive diagnostic, direct NIA/BTC | `wdk-rln-regtest-b3xZni` | All above plus expired unpaid RGB cancellation and confirmed BTC force-close funding spend pass; same-process reopen fails |
| Node, permissive diagnostic, NIA LSP | `wdk-rln-lsp-EIgvse` | Pass: discovery, automatic standard RGB provisioning, inbound funding, signed APay registration/proof, payment/claim and both bridge directions |
| Node, permissive diagnostic, IFA LSP | `wdk-rln-lsp-ydqvNG` | Pass, including independently observed on-chain RGB settlement |
| Node, final IFA LSP on rebuilt pinned-base image | `wdk-rln-lsp-kubJvu` | Pass: provisioning, APay registration/proof/payment/claim and both independently checked bridge directions |
| Bare, permissive diagnostic, IFA LSP | `wdk-rln-lsp-XHNEBQ` | Pass, including independently observed on-chain RGB settlement |
| Node, strict, NIA LSP | `wdk-rln-lsp-zDXt7b` | Provisioning, inbound RGB and APay registration/quote proof succeed; outbound APay does not settle. This run originally grouped quote and payment in one step |
| Bare, strict, IFA LSP | `wdk-rln-lsp-Zsjj5X` | Provisioning, inbound RGB and separate registration/proof steps pass; outbound APay times out. Bridge steps not executed |
| Node, strict, unfunded unlock/shutdown/reopen | `wdk-rln-reopen-2vVw8C` | Reproduces persistent signer database lock without funding or channels |

Both direct runtimes used TransactionSync/Esplora for one wallet and
BlockSync/Bitcoin RPC for the other, with a separate RGB Electrs indexer.
No public Signet or mainnet transaction was submitted.

## Unresolved Runtime Blockers

1. **Strict outgoing signing.** Native logs show signer-pending commitment updates
   and monitor-update-in-progress behavior. The same downstream paths complete
   with the separately labelled permissive regtest diagnostic. This localizes the
   observed failure to the released strict signing path but is not a complete
   root-cause proof. The package default remains strict; mainnet rejects permissive
   policy in the released signer. A package version bump alone does not fix this.
2. **Same-process reopen after unlock.** Both wrappers call native shutdown/free
   and destroy the signer, but recreating persistent signer storage raises the
   caught FFI panic `Database already open. Cannot acquire lock`. A fresh unfunded
   Node wallet reproduces it. Released `src/ldk.rs` starts an unbounded announcement
   task retaining channel/peer managers without checking shutdown; this is a
   concrete upstream lifetime defect and leading ownership explanation, not proof
   that it is the only retained reference. Whole-process recovery passes separately.
3. **Strict BTC mature-output sweep.** Strict Node and Bare runs recognize the exact
   delayed output with `to_self_delay=144`, advances LDK's observed tip well past
   maturity (another 96 blocks), but logs `Error spending outputs: ()` and never
   spends it. The permissive BTC counterpart passes on Node and Bare, including a
   confirmed subsequent spend consuming the sweep. This implicates the released
   strict/native output-spending path; it does not identify the specific rejected
   policy check. `ExternalSigner` maps several backend/PSBT failures to `()` in
   [the released implementation](https://github.com/UTEXO-Protocol/rgb-lightning-node/blob/af03c7f1a65135a429f05a5820600338215954dc/src/signer/external.rs#L778-L820).
   The observed output is unspent, not demonstrated lost.
4. **RGB force-close commitment rejection.** A fresh confirmed zero-push standard
   RGB channel reports usable at both peers. Force-close reaches the native
   broadcaster, but Core returns code -26, `mempool-script-verify-flag-failed
   (Signature must be zero for failed CHECK(MULTI)SIG operation)`. Reproduced on
   Node strict and Node/Bare permissive diagnostics. This occurs before CSV
   maturity; RGB sweep/re-spend steps are unexecuted, not passing. WDK forwards
   channel ID, peer and force flag; it does not construct this commitment. The
   shared RLN/LDK/external-signer transaction path needs investigation; the precise
   signature/RGB integration defect is not yet proven. No upstream fix is included.
5. **Android 16-KiB post-link crash.** Original arm64 and x64 `.bare` artifacts pass
   LOAD/RELRO checks. bare-link 3.3.0 with bare-lief 0.2.5 shifts the arm64 RELRO
   end from `0x7028000` to `0x7029000`; 16-KiB page rounding then protects writable
   data. The 16-KiB arm64 emulator faults in Rust `LazyKey::lazy_init` during
   `rln_binding_build_info`, at relative address `0x702ba50`. The same APK passes
   on a 4-KiB emulator. Published bare-lief 0.2.8 still produces a misaligned
   RELRO end on arm64 and x64. This localizes the failure to upstream packaging,
   not a WDK payment call; no physical-device claim is made. Our missing post-link
   validation is fixed with a CLI, regression cases and a fail-closed candidate
   artifact workflow. `zipalign -P 16` passes this APK and is not sufficient.
6. **RGB settlement is not reorg-safe.** With `min_confirmations=1`, a received
   10,000-unit NIA transfer settles. A longer competing fork removes its block;
   Core independently reports the original transaction in the mempool with zero
   confirmations. After sync, refresh and whole-process restart, both bindings
   still report 10,000 settled/spendable units and a `Settled` transfer. The exact
   released [RGB-lib refresh implementation](https://github.com/UTEXO-Protocol/rgb-lib/blob/62a8c3a045901147b3b06aed9f1e61f345695dce/src/wallet/online.rs#L2265-L2291)
   filters to waiting transfers, excluding settled records; RLN forwards to it.
   This is an upstream finality/recovery limitation, not evidence of permanent
   loss, a conflicting replacement spend or every reorg depth. WDK now explicitly
   documents that these fields do not guarantee current chain confirmation.
   The reorg-safety acceptance check fails; no database rollback/reset was added.
7. **External-signer issuance/inflation.** Released RLN explicitly rejects these
   operations. They are documented restrictions, not implemented WDK capabilities.

Supporting exact released source:
[announcement task](https://github.com/UTEXO-Protocol/rgb-lightning-node/blob/af03c7f1a65135a429f05a5820600338215954dc/src/ldk.rs#L6384-L6414),
[SDK shutdown](https://github.com/UTEXO-Protocol/rgb-lightning-node/blob/af03c7f1a65135a429f05a5820600338215954dc/src/uniffi_api/mod.rs#L402-L408),
[node shutdown](https://github.com/UTEXO-Protocol/rgb-lightning-node/blob/af03c7f1a65135a429f05a5820600338215954dc/src/node.rs#L80-L83).

## Build And Distribution Evidence

- WDK: 694 unit tests across 20 suites, types, lint and 33-file package check pass.
  Unit tests mock native modules; the scenarios above do not.
- Node: 12 JS/installer tests, declarations, optimized macOS arm64 native canary,
  source-installed packed Node/WDK consumer pass (93 packages, nine-minute install).
- Bare: 33 JS/installer tests including pre/post-link ELF negatives; declarations and real
  optimized macOS canary pass. Packed WDK/Bare consumer passes on 1.32.0 using
  current provenance-verified artifacts; earlier normal source install also passed.
- Bare optimized builds and header/symbol/hash checks pass for darwin-arm64,
  ios-arm64, ios-arm64-simulator, ios-x64-simulator, android-arm64, android-arm and
  android-x64. The two Android 64-bit artifacts pass LOAD and RELRO 16 KiB checks.
- iOS linker reports deprecated dynamic lookup; NDK's CMake scripts emit minimum
  version deprecation warnings. Neither was silently treated as a device pass.
- Source/dependency caches assisted builds. Node/Bare Cargo caches are isolated.
  Native packages remain source-build distributions, not no-Rust/prebuilt promises.
- npm production dependency audits report zero findings in all three packages.
  This is not a Rust/security audit or an audit of the local explorer.

## Non-Device Recovery Follow-Up

All following runs retain private results and wallet/log evidence. The complete
state copy includes the signer, stops every writer and preserves 0700 directory
permissions. It is not a seed-only, VSS, stale-state or migration test.

| Scenario | Node evidence | Bare evidence | Result / boundary |
| --- | --- | --- | --- |
| BTC force-close through CSV, exact sweep and independently confirmed re-spend | `wdk-rln-force-close-5JGUdx` | `wdk-rln-force-close-zYyEYY` | Both pass, permissive diagnostic only |
| Strict BTC force-close maturity | `wdk-rln-force-close-j7gvY4` | `wdk-rln-force-close-S93Z25` | Both fail: commitment confirms; delayed output recognized; sweep fails as described above |
| RGB force-close | `wdk-rln-force-close-FS5eWb` | `wdk-rln-force-close-nnzwyO` | Both permissive diagnostics fail Core signature verification before broadcast |
| Strict RGB force-close | `wdk-rln-force-close-HPUcv1` | Not separately run in this follow-up | Same native Core signature rejection, not caused only by permissive policy |
| ENOSPC and new send after recovery | `wdk-rln-storage-TQJny7` | `wdk-rln-storage-8XPw0F` | Strict pass; bounded 128-MiB HFS+ volume, independently observed write failure, rejected mutation, no broadcast, retained balance and successful new send |
| Dispatched-send process death at 0/20/100 ms target delay | `wdk-rln-interrupted-cavpn4` | `wdk-rln-interrupted-0ESuJj` | Strict pass with actual pre-response interruptions: early kill prevents broadcast, middle kill leaves a broadcast but unacknowledged transaction, late kill follows an acknowledged send; all reconcile without retry |
| Longer competing-fork reorg, unconfirmed restart, exactly-once reconfirmation | `wdk-rln-reorg-9EcWkG` | `wdk-rln-reorg-Y8fIK7` | Strict pass; Node TransactionSync and Bare BlockSync; not every reorg depth or RGB-finality scenario |
| Previously settled RGB receipt disconnected by longer fork | `wdk-rln-rgb-reorg-h5f8NG` | `wdk-rln-rgb-reorg-dyLjQ3` | Strict fail: 0 confirmations in Core, but settled/spendable stays 10,000 after refresh and cold restart |
| Both peers die with claimable HODL, reconnect and claim once | `wdk-rln-hodl-crash-yvR3uE` | `wdk-rln-hodl-crash-WH3CeG` | Both pass under permissive diagnostics |
| Relocate latest complete local state, cold-start and confirmed spend | `wdk-rln-cold-copy-jmQVbG` | `wdk-rln-cold-copy-4UIb9n` | Strict pass; same identity/address/balance, permission-preserving copy |

The first RGB fixture had undersized funding UTXOs and failed before opening a
channel (`wdk-rln-force-close-YZoeA0`); correcting fixture funding exposed the
separate commitment failure. No native workaround was added. Bare's first
disk-full run double-killed an already killed process group; idempotent harness
cleanup fixes that false failure. Node `fs.cpSync` widened signer directory
permissions to 0755 in the first cold-copy fixture; the native permission guard
correctly rejected it, and `cp -pR` corrected the fixture.

Three focused process-group ownership/idempotence tests also pass and run in WDK
CI. Dispatch markers now use atomic rename, match the exact request ID and are
cleared on cold restart; they never contain request arguments or seeds.
Final review found that normal 500-ms mailbox polling missed the interruption
window: all sends in the older `b87IA1`, `vHwYXY`, `HqBEWm` and `RaN1td` runs
were acknowledged before kill. Those results establish post-send recovery only,
despite their earlier step names. The final fixture polls the dispatch marker at
1 ms, records observed delay/response persistence and fails unless an actual
unacknowledged interruption occurred. Node observed 3/23/103 ms; Bare observed
4/21/105 ms. In both, the first kill has no broadcast, the middle kill has a
10,000-sat broadcast without a returned response, and the last follows success.
All recover correct balances and exactly one payment without replay. These are
still not instrumented database-commit boundaries or proof of all crash timings.

Shortening Core's tip before constructing a competing branch caused mempool
Electrs 3.3.0 to panic in `src/new_index/schema.rs:330`; the RGB Electrum backend
also reported a missing old-height header. Those failed diagnostics are retained
as `wdk-rln-reorg-gMwASt` and `wdk-rln-reorg-IhrCAW`. The ordinary longer-fork tests
above pass. The crashed indexer was restarted without deleting its database.
The first RGB-specific attempt (`wdk-rln-rgb-reorg-O7wPyK`) incorrectly expected
an explicit zero `confirmations` field from Core for a mempool transaction; Core
omits it. The corrected fixture independently requires mempool membership and
normalizes that missing field to zero before testing native settlement state.

## Mobile Runtime Follow-Up

The isolated Expo 56.0.21 / RN 0.85.3 / Bare Kit 0.14.5 Release app uses verified
candidate artifacts, not the user's real application or an older registry addon.
The embedded engine reports Bare 1.29.4 / uv 1.52.1 / V8 14.8.178.31. This bundled
profile is distinct from standalone Bare >=1.32.0; the host floor stays unchanged.

- iOS 26.5 arm64 simulator: `wdk-ios-qualification-IClIoq` passes actual native
  identity/unlock, funded signed BTC send independently confirmed by Core, valid
  HTTPS and self-signed certificate rejection, background/foreground events,
  process termination/cold restart with the same identity/balance/address, native
  shutdown and worklet teardown returning to React Native.
- Android API 36 arm64, **4096-byte pages**: `wdk-android-qualification-xinNWJ`
  passes the same checks. The **16384-byte-page** profile fails at native import,
  as described above; it is not covered by the 4-KiB pass.
- Final reruns with simulator/emulator identity recorded also pass:
  `wdk-ios-qualification-625zc5` and `wdk-android-qualification-naD3Na`.
- TLS tests exercise Bare HTTPS, not native Rust HTTPS. Five seconds in the
  background does not prove long suspension, memory-pressure or battery behavior.
  Successful teardown is not proof of same-process persistent signer reopening.
- Initial TLS fixture incorrectly used nonexistent `https.get`; corrected to
  request/end. Android minSdk was corrected from Expo's default 24 to Bare Kit's
  required 29. A host-ENOSPC build failed, then succeeded after deleting only
  completed build caches/duplicate archives. These are fixture/environment issues.
- The fixture's initial npm install reported 14 dependency advisories (10 moderate,
  four high). Further audit submission was blocked pending permission to send its
  dependency metadata to npm. No clean mobile-toolchain security audit is claimed.

Commands and scope are in [the mobile fixture](../mobile/README.md). Physical
devices were deliberately excluded, as requested. Original build outputs, private
generated lockfile, crash log and ELF metadata remain under
`/tmp/wdk-mobile-qualification`; wallet/controller evidence remains private.
The private lockfile was subsequently changed for the 0.2.8 linker diagnostic,
not retained as an immutable as-built APK lock. The exact tested APK, extracted
native library and worklet hashes are in [build evidence](../mobile/BUILD-EVIDENCE.json).
The library extracted from the tested APK independently fails the new ELF check.

## Node Target Execution

[Runtime matrix run 35995537629](https://github.com/UTEXO-Protocol/rgb-lightning-node-nodejs/actions/runs/35995537629)
checks candidate head `e13fc9b576c2f92f800158d7678e524d7c873102`, checked out as PR
merge ref `a6a40d65806d1153be6e4860079cec3373025d46`. These are native-architecture
executions, not cross-build-only results. Each job builds optimized native code,
runs JS/type and native offline canaries plus the Rust C-FFI adapter tests, packs
the source distribution and emits compiled identity/provenance. Downloaded
identity reports match the expected RLN, LDK, adapter and wrapper hashes.

| Target | Runtime | Status |
| --- | --- | --- |
| macOS arm64 | Node 22.23.2 | Passed |
| Linux x64 GNU | Node 22.23.2 | Passed |
| Linux arm64 GNU | Node 22.23.2 | Passed |
| Linux x64 musl, Alpine 3.23 | Node 24.18.1 | Passed |
| macOS x64 | Node 22.23.2 | Passed |

These checks cover load/identity, offline init/persistence/lifecycle, invalid
handles/errors and adapter boundaries. They do not replicate the complete
funded network/adverse suite on every OS/architecture, nor prove every Node
version allowed by the package engine range. macOS host Node/Bare regtest and
mobile worklet results are separately recorded above.

## Harness And Infrastructure Corrections

- The complete documented setup script passed from clean exact-source checkouts,
  using Docker build caches for unchanged layers; the final pinned-base LSP image
  was rebuilt. An earlier invocation omitted Docker's credential helper from PATH;
  restoring the normal PATH resolved that environment failure.
- Mempool Electrs' Electrum endpoint lacks verbose transaction RPC needed by RGB.
  A standalone Electrs 0.12.0 supplies RGB while mempool Electrs supplies Esplora.
- Witness fixtures must preserve `rid_nonce` in decoded transport endpoints.
  WDK already preserved it; a regression test now protects that behavior.
- A Bare launcher spawns a child. The first crash test killed only the launcher,
  causing a misleading lock failure. Process-group cleanup fixes this; Bare
  process recovery then passed. This is not evidence of upstream crash-recovery loss.
- Unknown UDA receive invoices must use `Any`; requesting `NonFungible` without a
  known UDA schema was a fixture error. Corrected strict transfers pass.
- APay requires matching internal LSP/RLN bearer tokens. Missing fixture tokens
  were corrected; this was not an upstream APay failure.
- The explorer's latest stable release reports 41 upstream npm advisories,
  including four critical. It stays loopback-only and disposable, not a production
  infrastructure recommendation. All fixture passwords are public test credentials.

## Not Qualified By This Run

VSS is disabled and upstream VSS defects are not patched here. Legacy migration
is excluded by owner decision, not a remaining release gate. Still unqualified:
physical-device behavior and unexecuted mobile architectures; Android 16-KiB
runtime (failed); other Node targets beyond recorded CI/host results; native Rust
TLS, prolonged suspension/low-memory behavior; full reorg/justice/database-commit
fault matrices; RGB reorg-safe settlement (failed); stale/seed-only channel recovery; strict BTC mature-output sweep
and RGB force-close recovery (failed); multi-hop/swap/linked-asset
and media matrices; exact deployed Signet/mainnet LSP behavior; independent review
and registry publication/provenance. These are not silently counted as passing.

The integrator's zero-channel incident remains unproven without its actual client
and server artifacts/logs. Local provisioning success does not establish that
incident's root cause. Both Signet rollout and mainnet production remain gated by
the strict-signer, force-close and reopen failures plus applicable deployment
checks. Mobile Android rollout also requires the packaging defect to be fixed
and the final APK requalified, not just its input prebuild.
