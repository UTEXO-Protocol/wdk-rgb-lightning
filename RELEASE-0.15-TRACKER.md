# RLN release tracker (existing 0.15 branch)

Target: `release/rln-0.15.0-beta.3`, branched from `release/rln-0.13.0-beta.3` in WDK, Node.js and Bare. Current package candidate: `0.2.0-beta.4`; current SDK target: `v0.17.0-beta.3`. No npm publication is part of this change.

Current release decisions and the latest verification are maintained
in [PRODUCTION-GATES.md](./PRODUCTION-GATES.md). Dated historical results below
retain their original source and scope.

## October 14 RLN 0.17 Upgrade

The existing release branch and PR are retained. The new graph is RLN
`ecc69f20308231400561f6f060fea88acfa40cc4` (`v0.17.0-beta.3`), rust-lightning
`79b9eb5166546c62692d3a672986f385c7fe047d`, and rgb-lib
`v0.3.0-beta.50-bfa` / `1b951af0c8233308c919975552487be19ad2a930`.
WDK and exact native peers advance to the unpublished `0.2.0-beta.4` candidate.
The runtime version now matches the actual SDK tag. No merge or publication is
included. No new BFA Lightning API or Iris Lightning feature is enabled.

WDK's fail-closed constructor guard, packed smoke tests, regtest worker and mobile
qualification fixture all require the new graph. The isolated peer daemon and
BFA issuer helper are pinned to the same RLN/rgb-lib versions. Qualification
services use their own ports and volumes; they must not reset or mutate a shared
consumer stand to make an adverse-recovery test pass.

Exact adapter identity and fresh verification results are recorded in
[PRODUCTION-GATES.md](./PRODUCTION-GATES.md). October 12 and earlier results
below are historical, scoped to their recorded graph. Existing failures and
open gates require independent exact-source requalification; none is erased
by upgrading sources or rebuilding artifacts.

## October 12 Core Burn Upgrade (Historical)

October 12 source: RLN `8777d71d7781b408fcce89c9c965ae29e8ad2300`, including
external-signer burn and rgb-lib beta.47-bfa. The native candidate still reports
`rln_version: 0.15.0-beta.3`; exact commit/adapter identity, not that version
label alone, selects this build. Node/Bare/WDK package versions stay
`0.2.0-beta.3`. Source updates stay on the existing release branch; no merge or
publication is part of this follow-up.

- rust-lightning: `fc5c4c64db36a9b6aa8cd878ca1225a977e67106`.
- rgb-lib beta.47-bfa: `74a096a5bfbba7744af16c36c3595a24464c134c`.
- Shared native adapter: `f6d2959e1ceff0400cbd372759c4957cd5a52964f4ec646a79ee15c21b2291c0`.
- WDK requires `external-signer-burn-v1` before creating native handles.

The coordinated API is `account.burnAsset(request)` -> `SdkNode.burn(request)`
on both runtimes. The snake_case fields are `asset_id`, `amount`, optional
`burn_recipient`, `fee_rate`, and `min_confirmations`; the result is `txid` plus
`batch_transfer_idx`. Safe numbers and canonical decimal u64 strings preserve
amounts exactly. Full accounts report burn support; read-only accounts do not
expose burn and report it unavailable. No WebRGB/provider, WalletConnect,
session, approval, journal or bridge-transport behavior is added or extended.

### Admission And API Audit

Reviewed merged `bindings/c-ffi/src/json_types.rs` (burn and send DTOs),
`src/uniffi_api/mod.rs::SdkNode::burn`, `src/sdk/mod.rs::burn`, and
`src/rgb.rs::UnlockedAppState::rgb_burn`, plus both JS native wrappers.
The C-FFI DTO file is unchanged from the reviewed external-burn source.
Neither `JsonBurnRequest`, `JsonSendBtcRequest` nor `JsonSendRgbRequest` gains
a public `sweep` parameter. RGB-lib's added internal `burn_begin` argument is
supplied by RLN (`false`); no WDK request remapping is needed. RGB send's legacy
`skip_sync` remains accepted but ignored by C-FFI, as before.

WDK validates and snapshots the request before native access; unlock-in-flight
and shutdown admissions reject without queueing a later burn. Existing
`_node`/binding closed checks apply. Production Node/Bare `burn` is synchronous,
so JS cannot interleave another account operation during native execution.
RLN holds its RGB wallet mutex throughout begin/sign/end against competing
wallet operations and checks unlocked state. No WDK-wide scheduler refactor
is needed for this synchronous contract. An asynchronous native binding would
require a fresh lifecycle/serialization review, not silently reuse this claim.

Errors preserve native reconciliation information and are never replayed.
Malformed responses also fail without retry. Applications must reconcile
uncertain outcomes before another request; WDK provides no durable idempotency
or bridge recovery. The mutex is not an application operation journal.

### WDK Verification

- Focused Jest and full Jest run with `--watchman=false --runInBand`: focused
  **287 tests / 5 suites**, full **970 tests / 26 suites passed**.
- TypeScript declarations and lint pass. Lint uses an in-checkout cache because
  the sandbox cannot write the default home-directory Standard cache.
- The focused burn suite has **103 tests** and **100% statement, branch,
  function and line coverage** for `src/burn-contract.js`. Package allowlist
  verification passes with 44 packed files; `git diff --check` passes.
- Tests cover full/read-only capabilities, mainnet on-chain admission, missing
  capability/stale identity, exact u64 strings and unsafe numbers, request and
  response validation, no replay, unlock/shutdown admission, and unchanged
  optional WebRGB method/type surface.
- Native compilation, packed native loading, funded burn, failure recovery and
  device qualification for this graph are separate native/app-agent work.
  WDK Jest mocks are not evidence of native settlement or production readiness.

### Optional WebRGB Peer Compatibility

The optional peer is widened from exact `0.1.0` to `^0.1.0`; the development
baseline remains `0.1.0`. `0.1.2` adds provider methods outside WDK's declared
`Pick<RgbProvider, WebRgbMethod | 'enabled'>` subset; its selected signatures
and runtime helpers are unchanged. Both versions pass strict declarations and
read-subset runtime compatibility with `npm run check:webrgb-peer -- <peer-dir>`.
The `0.1.2` input was the installed package in
`/tmp/iris-bridge-implementation-20261012/node_modules/@utexo/webrgb`.
No WebRGB/provider source or declaration is extended, and no WalletConnect
dependency is added. A normal WDK install with `--legacy-peer-deps=false`
passes (`--offline --ignore-scripts --no-audit --no-fund`). At the initial review,
Iris's normal install had **not passed**: its old Bare Git pin identified a beta.2
package instead of the required beta.3, and npm could not resolve the app's root
override reference `$brace-expansion` during Git dependency installation.
The subsequent normal install passed with the final WDK/Bare implementation
pins below and literal override versions. Evidence:
`/tmp/iris-bridge-audit-20261012/iris-install-final-pins.log`.
The optional WalletConnect keyvaluestorage/AsyncStorage peer warning remains;
this install result is not a clean dependency-audit or mobile-runtime claim.
`legacy-peer-deps` is not a compatibility fix.

Native packages remain exact optional peers at `0.2.0-beta.3` in WDK's manifest
and lockfile; WDK has no native Git dependency pin to update. Its runtime gate
requires the new exact source/adapter/capability even while the package version
is unchanged. Iris owns its native/WDK Git commit references and must update
them after the final package commits. These source edits do not qualify older
installed native artifacts merely because their package version matches.

### October 12 Native And App Qualification Follow-up

Implementation pins remain WDK `c941925ab8a9b2d75356d223d5eed74c3dd74647`,
Bare `cc62bf3a1765d89cb8b0b990ea16a47936f799de` and Node
`c30cf547fb2960f737b1463f3410445f43932b1b`. Later documentation-only commits do
not replace those pins or change artifact identities. Exact RLN/LDK/rgb-lib
and adapter identities are the October 12 inputs above.

- All seven [Bare hosted build jobs](https://github.com/UTEXO-Protocol/rgb-lightning-node-bare/actions/runs/38213919881)
  passed, including Android production staging. All five
  [Node runtime matrix jobs](https://github.com/UTEXO-Protocol/rgb-lightning-node-nodejs/actions/runs/38213891152)
  passed. Complete local seven-target Bare and five-target Node artifact gates,
  provenance, symbol checks and applicable Android ELF checks pass. The canceled
  duplicate Node run is not evidence. Exact target/runtime results and hashes:
  [final native report](https://github.com/UTEXO-Protocol/rgb-lightning-node-bare/blob/1a55402a557a42455c8132345c05e99167c34607/NATIVE-UPGRADE-20261012.md).
- The exact Bare Darwin ARM64 addon with WDK `c941925` and fixture-only Bare
  1.34.1 received 1,000,000 BFA, sent 250,000, burned 100,000, and reopened in
  fresh processes with balances 650,000/250,000. The 8,881-byte exported proof
  has SHA-256 `edf380a96e3cbd265451ae798f413564b30c8efb7560cc5f0b1091408dfaded9`.
  Independent beta47 consensus validation used live Bitcoin resolution,
  `IssuedAmountCheckExt` and Anvil FundsIn; missing events, wrong burn amount
  and wrong recipient were rejected. This is Bare-host evidence, not Node-funded,
  EVM-payout, mobile, same-process-reopen or production qualification.
- That funded host sequence initially used an unbound invoice. A separate fresh
  wallet now proves exact BFA public-contract import, zero balance, wrong-ID
  rejection, idempotence and bound invoices, including an amount-omitted `Any`
  invoice matching the PR83 receive request shape. The genesis artifact SHA-256
  is `5adf806811bad26748b9c124c179ec583c77ae7b40b0c79d45dec679fd44ddcf`.
  The subsequent first mint to that bound `Any` invoice now settles 1,000,000
  BFA units and retains exactly 1,000,000 settled/spendable units and token
  balance after a separate-process reopen. Both snapshots match the invoice's
  recipient, `requested_assignment: Any` and settled txid
  `5aaeb75099d30e6d60378ac7ae118beae36153cf2c5d7e91fa7eec97458984ff`.
  This qualifies the host fresh-contract first-receive path, not same-process
  recovery, mobile BFA receipt or mobile WalletConnect. No unbound fallback or
  IFA relabeling is introduced.
- Earlier BFA-bootstrap app regression coverage passed **233 suites / 2,602 tests** with
  `--watchman=false`; configured thresholds are unchanged. The BFA-focused
  app checks pass **8 suites / 187 tests**. They exercise app bootstrap ordering
  and exact asset-bound receive, not native settlement or mobile recovery.
  Final BFA-source typecheck, uncached lint and production iOS/Android export
  credential-canary scans also pass; export scans are not mobile execution.
- **P01 / Q01 remain failing/open:** actual Android 16-KiB Iris reproduced
  same-process signer reopen failure after backgrounding for the system share
  sheet. Native returned `FFI panic in rln_native_external_signer_new_with_storage`
  with `Database already open. Cannot acquire lock.` Iris fails closed with
  restart guidance; no reset was performed. External-browser return required
  by WalletConnect is not qualified. Force-stop recovery, successful native
  compilation and cold startup do not close this lifecycle failure.

### October 12 Android BFA Round-Trip Addendum

Actual Android 16-KiB Iris now passes fresh BFA contract bootstrap, exact
asset-bound Witness invoice creation and its first 1,000,000-unit receipt.
The only funded RGB receipt in this run is txid
`c943361dc98ed402cf312cbe88b4ded1a267337aaa0f774cd573a3514aaa5a96`.
The app initially displayed 1.00 USDT pending, then 2.00 pending after refresh.
After settlement it displays the correct 1.00 USDT without `Includes pending`;
the funded BTC balance is also correct at 2,000,000 sats. **P04 remains failed
on the current beta47 runtime**, not merely a historical gate. No UI cap or
native accounting change was applied. This Android pending evidence is UI-level,
not a new raw-native pending-balance capture.

After the BFA decoder correction and explicit RGB output setup, Android made
one PIN-authorized send of 250,000 units to a bound host Witness invoice:
`deaddec68fd4f7672e7f52f31a7f418caf4ca1b6fd63514d6e09ce7c7e067985`.
The reported native network fee is 5,100 sats. Refreshed Android displays 0.75
USDT without pending. The exact-source host receiver independently reaches
`ReceiveWitness` / `Settled` at three confirmations, with 250,000 units in
settled, future, spendable and token balances. Invoice recipient, proxy recipient,
asset and transaction match. Normal Iris sends remain Witness-only; no Blind-send
policy expansion was made. This qualifies the observed regtest emulator round
trip, not mobile burn, WalletConnect, physical hardware or production. P01
same-process recovery and P04 pending accounting remain failed.

After the app's exact `Bfa` send-decoder correction and final fixture/script
freeze, including the bridge allocation-readiness gate and local fixture
nonce-preservation checks, combined coverage passes **235 suites / 2,727 tests**
with `--watchman=false` and unchanged thresholds.
Typecheck, uncached lint and diff
checks pass; 820 app/script/ops/config files have identical pre/post-run hashes.
The readiness gate reuses explicit Settings setup, never auto-spends Bitcoin,
and does not qualify a fresh Android bridge blind mint. These regression results
do not close the observed native runtime failures.
WDK implementation pin `c941925` and both native implementation pins are unchanged.

Host evidence: `/tmp/iris-bridge-implementation-20261012/docs/engineering/bfa-wdk-qualification-20261012.md`
and `.devstack/bfa-beta47/wdk-qualification/` in that checkout. Fresh bootstrap
evidence: `.devstack/bfa-beta47/wdk-bootstrap/bootstrap-con-export.json`,
`invoice-any.json`, `snapshot-settled.json` and `snapshot-reopened.json`.
Independent exact-identity/invoice/transfer/balance assertions pass in
`/tmp/iris-bridge-audit-20261012/wdk-first-any-independent-verification.log`.
App coverage:
`/tmp/iris-bridge-audit-20261012/iris-fixture-nonce-final-coverage.log`.
Production export scan: `iris-export-final-readiness.log` in that audit directory;
the later fixture-only nonce correction does not change production app source.
Android failure: `android-same-process-reopen-failure.xml` and
`metro-8093-restart.log` in the same audit directory. Wallet/seed files in the
private fixture trees must not be committed or published wholesale.
Current Android pending/settled captures: `android-bfa-witness-double-count.xml`
and `android-bfa-receive-settled.xml` in that audit directory. Send captures:
`android-bfa-send-review.xml`, `android-bfa-send-submitted.xml` and
`android-bfa-send-settled-balance.xml`. Host receiver evidence in the bootstrap
directory: `android-return-witness-250k.json`, `android-return-confirmations.json`
and `snapshot-android-return-settled.json`. Independent assertions pass in
`wdk-android-return-independent-verification.log` in the audit directory.
Latest frozen app checks: `iris-bridge-readiness-combined-coverage.log`,
`iris-bridge-readiness-final-typecheck.log` and `iris-bridge-readiness-final-lint.log`.

All dated earlier results below, including the historical body of
[BFA-QUALIFICATION.md](./BFA-QUALIFICATION.md), retain their original source and
scope. P02/P03/P04/P06, native security, recovery, public deployment and
distribution gates remain open until separately requalified; the new source,
artifact matrix and host happy path do not close them.

## October 10 Public Android Packaging

The Bare release branch now supplies a public byte-preserving staging CLI and
Gradle hook; another wallet no longer needs Iris's private implementation.
All three Android ABIs pass provenance, ELF and import checks. One test-signed
APK passes public-wrapper signer/worklet and live RELRO/DYNAMIC protection
checks on ARM64 4-KiB and 16-KiB emulators. The Gradle ordering regression also
passes hosted CI after pinning Java 17. The fresh native candidate matrix is
separate and still requires its own artifact results.

Consumers must explicitly adopt the
[documented BareKit 0.15.5 integration](https://github.com/UTEXO-Protocol/rgb-lightning-node-bare/blob/release/rln-0.15.0-beta.3/android/README.md).
Raw bare-link/bare-lief output is still unsafe. See P05 in
[PRODUCTION-GATES.md](./PRODUCTION-GATES.md) for the supported boundary and
evidence. No RLN source, native wrapper, recipe or WDK runtime change was needed.
Full wallet behavior and the other production gates are not closed by this test.

## October 9 Packaging Follow-up

The exact PR #192 source remains unchanged. All seven Bare release artifacts
pass the local complete-artifact gate. Iris's three-ABI Release APK/AAB and
generated splits pass provenance, signature, native import/layout and ZIP
alignment checks, including 16-KiB checks for the final 64-bit payloads. Iris's
byte-preserving staging avoids the generic ELF rewrite; it does not fix it.
The seven-target Bare CI run still fails post-link checks for Android arm64/x64.
These are locally test-signed, Signet-configured
artifacts, not store uploads or Release-runtime qualification.

Android Debug BTC send/receive and settled RGB receipt passed within the
recorded regtest scope. RGB send remains unexecuted; the funded same-process
signer lock and transient incoming RGB double-count remain reproducible.
See the Bare release tracker for artifact scope and local evidence paths.
All five Node artifacts now pass their local release gate, native offline
canaries and fresh offline installation from one complete archive. Node 22.23.0
was used for both macOS/GNU targets and Node 24.18.1 for Alpine/musl; x64 runs
used local emulation, not physical x64 hardware. Details and exact evidence are
in the Node release tracker.
The maintainers subsequently provisioned `ORG_READ_TOKEN`; both native contract
CI reruns and the original five-target Node runtime matrix passed. Inspecting
the CI binaries found a Linux ARM64 glibc-floor regression. Both GNU jobs were
fixed to build/test on Ubuntu 22.04 and now pass with a 2.34 symbol floor.
Security, redistribution and the remaining runtime gates are separate.

## Implementation

| Work | Status | Evidence / disposition |
| --- | --- | --- |
| Freeze released RLN and dependency graph | Done | RLN `e2b39d5ae8da74525eafb58bc39b9a614c756a73`; LDK `6d6d061f840264296e7de2b1c64dac6c0dd7eb26`; rgb-lib beta.42-bfa `aaf5b52f63ff2ee966707f099aacadd5f2e6037f`. |
| Replace import backport with binding-only adapter | Done | Eight C-FFI files only. Upstream #128 supplies imports; persistent signer, APay address, JSON parity and provenance retained. |
| Resolve and verify Node/C-FFI Cargo locks | Done | Four exact BFA overrides; source allowlists and locked builds pass. Compatible h2/rustls security updates included. |
| Expose local consignment export in all three packages | Done | WDK returns exact Uint8Array; Node/Bare return native hex/path. Four-schema funded byte comparisons pass in both runtimes. |
| Preserve published WDK public API and lossless amounts | Done | 850 WDK tests, types and existing surfaces pass after the WebRGB/policy follow-up; BFA response shape preserved without claiming external BFA support. |
| Verify mainnet Lightning rejection | Done | Actual Node/Bare native canaries reject Lightning and retain on-chain initialization requirements. No mainnet funds or endpoint qualification. |
| Public package installation and artifact provenance | CI-built Node matrix and local Bare artifact gate passed on October 9 | All five Node packed consumers pass offline installation, provenance and native canaries from one complete CI-built archive. Bare's seven original artifacts verify locally; its hosted matrix passes five targets and fails two Android packaging checks. Remaining Bare target-runtime qualification and redistribution review remain open. |
| Build and exercise host Node and Bare | Done for macOS arm64 | Fresh debug and optimized 0.15 artifacts pass native canaries. Both optimized runtimes pass the four-schema funded/export matrix. |
| Cross-target and Android post-link qualification | Original artifacts pass; generic Android packaging fails | Iris's final three-ABI APK/AAB/splits pass with app-owned staging. Bare CI fails both 64-bit generic post-link checks. Release-app interaction remains open. |
| Local-stack funded/adverse recovery regressions | Executed within recorded scope; release blocked | Both runtimes pass four-schema and six-decimal IFA import flows; adverse tests identify the failures below. Unexecuted scenarios are listed explicitly. |
| Dependency security review | Reviewed; unresolved gate | Five RustSec lockfile findings; two optional crates not in selected normal/build graph, three in active legacy TLS. No advisory suppression. |
| Draft PRs and final diff review | Done | WDK #45, Node #24, Bare #22, all draft against main. Source/patch identity, public method preservation, declarations, package contents and diff checks verified. No merge or publication. |

## WebRGB and mainnet policy follow-up

Reference: merged [rgb-sdk-rn #59](https://github.com/UTEXO-Protocol/rgb-sdk-rn/pull/59),
head `69c3f92c28602a5bf6b7f89aa69a0fd8e5ac202c`. The receiving/read subset is
adapted to this package's C-FFI DTOs, not copied from the RN camelCase model.
Node/Bare native sources and their exact artifacts are unchanged by this follow-up.

| Work | Status | Evidence / disposition |
| --- | --- | --- |
| Mainnet-only WDK Lightning guard | Implemented, tests pass | Stable `LIGHTNING_DISABLED_ON_MAINNET` across full/read-only accounts, generic transfer/quote routing and account-taking LSP helpers. Checks precede native calls and HTTP effects. Signet/testnet/regtest retain APIs. |
| Mainnet on-chain receipt fallback | Fixed, regression test passes | Unknown on-chain hashes do not fall through to disabled Lightning payment history. |
| Optional WebRGB adapter | Done; Node/Bare funded reruns pass | Nine receiving/read methods, per-session approval/revocation, safe amounts, immutable approved inputs, sanitized errors and txid lookup without an asset ID. No browser engine or WalletConnect dependency. |
| Signer-aware capabilities | Implemented, tests pass | BFA listing/consignment export available; external-signer BFA validation and burn reported unavailable. No synthetic Ethereum RPC option. |
| Burn and persistent burn journal | Excluded from this work | No method or proof extension advertised by WebRGB. Existing direct WDK consignment export remains. |
| Exact TypeScript and package exports | Done; final reruns pass | Optional `@utexo/webrgb@0.1.0` type peer; fresh packed Node and Bare imports pass without Rust on PATH, including real offline mainnet accounts and WebRGB sessions. |
| Upstream/cross-target release gates | Unchanged | The gates below are not resolved by this JavaScript follow-up. |

Review fixes include native `NotFound`/`InvalidRequest` error mapping, unknown
on-chain receipt routing, direct txid status lookup, amount overflow rejection,
revocation while requests are pending, and rejection of async authorization
assertions. `listTransfers()` without an asset enumerates known assets: released
RLN cannot enumerate unassigned pending blind receives. This is documented in
[WEBRGB.md](./WEBRGB.md); absence from that list is not proof of non-creation.

Final follow-up verification (2026-10-05): 850 tests across 25 WDK suites,
including 140 new cases; strict declarations, lint, package contents and npm
production audit pass. The new policy/provider files have 100% line/function
coverage (97.31% combined branch coverage). Native wrapper suites were rerun:
18 Node and 41 Bare tests pass. No core rebuild or new platform qualification
is claimed because the native source/artifact inputs are unchanged.

Real optimized-runtime evidence: `wdk-rln-assets-aqrFpf` (Node) and
`wdk-rln-assets-V760nq` (Bare 1.33.0). Both pass NIA/IFA/CFA/UDA receive through
WebRGB, WDK witness sends, two-sided settlement, balances, histories, status by
txid with/without an asset ID, tagged invoice decoding, native error mapping
and byte-exact consignment export. Earlier iterations `irN3X1` / `IKI5gx` also
passed but precede the final native-error/status cases. BFA funding and public
Signet/mainnet settlement are not part of these disposable regtest runs.

## Release gates

Fresh 0.15 reproductions are identified below. Historical or unexecuted scenarios
remain open, not implicitly fixed by upstream merges or package unit tests.

| Gate | Owner / scope | Status |
| --- | --- | --- |
| Same-process persistent signer database lock | RLN/native lifecycle; all networks | Reproduced on Node and Bare after unlock/shutdown/free/recreate. Offline never-unlocked canaries pass; they test a different lifecycle. |
| Orphaned BTC send reservation after process death | Released RLN external-signer begin/sign/end integration with rgb-lib; all networks | Reproduced twice. Settled/future remain 2,000,000 sats, spendable becomes zero, recipient gets zero, Bitcoin confirms original UTXO remains unspent. Database retains reserved_txo/wallet_transaction. Released RLN neither reconciles nor exposes rgb-lib list_pending_vanilla_txs/abort_pending_vanilla_tx. No state deletion or automatic replay attempted. |
| Settled RGB balances after a reorg | rgb-lib; RGB on-chain | Fresh Node reproduction: 10,000 units remain settled after their one-confirmation witness is disconnected, even after sync, refresh and cold restart. |
| Strict outbound Lightning payments | Native signer/LDK/RLN; non-mainnet Lightning | Reproduced on Node: both sides remain pending past 90 seconds with a confirmed usable BTC channel. |
| Mature BTC force-close sweep; RGB commitment acceptance and sweep | Native signer/LDK/RLN; Lightning recovery | Fresh Node reproductions: BTC no sweep after CSV maturity plus 96 blocks; RGB commitment rejected by Bitcoin with failed CHECK(MULTI)SIG, before confirmation/sweeping. |
| Crash-safe RGB channel funding and explicit recovery | rgb-lib #80, LDK #32, RLN #139/#140 | Unmerged; not silently bundled |
| Android final linked 16-KiB layout | Bare toolchain/package | Closed for the public staging integration verified October 10; consumers must adopt it explicitly. Generic bare-link output still damages RELRO/DYNAMIC. See P05 in PRODUCTION-GATES.md. |
| Private BFA build dependencies | Source access and package delivery | ORG_READ_TOKEN is configured and scoped initialization works. Source access is resolved; license/notices and publication approval remain separate. |
| BFA Ethereum RPC with external signer | RLN #192 | Resolved in current source candidate; see BFA report. |
| External burn | Source selection and package API | Core WDK API and exact native gate added October 12; funded/native/app-recovery qualification remains separate. No WDK bridge journal or provider extension. |
| BFA receive lock-event selection | rgb-lib #103 | Unmerged; BFA funding not qualified |
| Stock Lightning, virtual channels, APay restart durability, HODL concurrency | Applicable upstream behavior | Not qualified by matching-RLN happy-path tests |
| VSS fencing, device-loss and channel recovery | RLN/VSS and release qualification | #172 fixes partial-store refill, not every recovery scenario |
| Thirteen custom native on-chain operations and related custom aliases | Unreleased core extensions | Keep explicit unsupported behavior; no broad fork |

The WDK base stays pinned to `@tetherto/wdk-wallet@1.0.0-beta.14`. Upgrading its transaction contract is separate from this native release. Iris, existing-wallet migration, physical-device runs and npm publication are excluded. Mainnet Lightning remains unsupported by RLN; mainnet IFA is rejected by rgb-lib. BFA, no-LDK mainnet runtime, SPV performance and unmerged recovery changes are not implied by this upgrade.

## Compatibility with published packages

Baseline: WDK `0.1.0-beta.15`, Node `0.1.0-beta.16`, Bare `0.1.0-beta.20`,
using RLN 0.11 with the old behavior overlay. This remains a breaking 0.2 line.
No standard WDK account/manager/LSP method is intentionally removed. The native
13 custom on-chain operations remain unsupported: nine prepare/commit/cancel
methods, two pending lists, walletSnapshot and address receipts. Custom FullSync,
native operation handles, VSS deletion, routing-fee caps, persisted payment fee/
failure fields, stable VSS writer identity, virtual-channel behavior and prepared
UTXO isolation are not restored by this upgrade. Do not equate method aliases
with those old semantics. The fresh BTC crash result makes pending-transaction
recovery necessary even for direct send; optional staged-send UX is a separate issue.

Merged import #128 and VSS refill #172 are inherited. Still not bundled:
rgb-lib #80 -> rust-lightning #32 -> RLN #139/#140 (RGB funding recovery),
rust-lightning #33 (keysend retry), RLN #190 (no-LDK runtime), rgb-lib #103 (BFA
lock validation), rgb-lib #79 (SPV). Existing RLN issues #153, #135/#136/#137,
#31/#39 and #52 remain applicable to their respective optional modes.

## Security disposition

RustSec database `ef6173cbc5c50ec8166f9a5b28f07834144373ee`, checked 2026-10-05
with cargo-audit 0.22.2. Both final locks report the same five vulnerabilities:

- `rkyv` 0.7.46 / RUSTSEC-2026-0235 and `rsa` 0.9.10 / RUSTSEC-2023-0071:
  present in lockfiles, absent from `cargo tree --target all --edges normal,build`
  for the selected native graph. This is feature-specific, not a general waiver.
- `rustls-webpki` 0.101.7 / RUSTSEC-2026-0104, -0098, -0099: active through
  `minreq` -> `esplora-client` -> BDK/RGB/LDK. The CRL and certificate-constraint
  advisories require separate applicability/remediation review. Upgrading the
  newer rustls instance does not repair this legacy instance.
- Unmaintained and yanked-package warnings remain separate review items, not
  additional proven exploits. No blanket ignores were added.

Production npm dependency audits pass for all three locked packages. This does
not replace the native review. An aggregate advisory count is not a count of
demonstrated exploit paths.

## Test environment

The existing `wdk-rln-013-qualification` Compose project was reused with Bitcoin
31.1, electrs 0.12, mempool indexer 3.3, proxy 0.3 and explorer 3.5.1. Old indexer
volumes were retained; separate `indexer015`/`electrs015` caches rebuilt against
the existing regtest chain. Only disposable regtest wallets were funded.

The issuer was a freshly compiled RLN 0.15 host daemon from the locked native
graph, with `REGTEST_HOST_ISSUER=1`; the old 0.13 daemon container was stopped.
This is not a 0.15 container-image pass. The updated container recipe uses a
BuildKit secret for private dependencies; its full image build is unqualified.
Standalone WDK Bare tests used 1.33.0. Older locked dependencies can run on 1.32,
but fresh resolution includes bare-thread requiring 1.33; the declared floor
and packed smoke runtime now match that requirement.

## Fresh funded evidence

Each directory name below identifies retained private local results/logs. Wallet
seeds, signer databases and wallet state are not committed. These are host debug
regtest runs unless marked optimized, not mainnet, Signet-LSP or mobile release
approval.

| Scenario | Result | Evidence directory |
| --- | --- | --- |
| Node NIA/IFA/CFA/UDA send, receive, balances and exact consignment bytes | Pass | wdk-rln-assets-gaKMrI |
| Bare 1.33 same four-schema matrix | Pass | wdk-rln-assets-DX8NGK |
| Node six-decimal IFA contract import, idempotence, malformed input and settlement | Pass | wdk-rln-imports-1G3Snd |
| Bare same IFA import and settlement | Pass | wdk-rln-imports-CBnwEa |
| Node / Bare native unlocked same-process reopen | Fail: persistent signer database lock | wdk-rln-reopen-vSXNYJ / wdk-rln-reopen-yEiTQU |
| Node strict BTC/RGB on-chain and confirmed BTC channel | Pass up to outbound Lightning; payment then stalls | wdk-rln-regtest-5TxKh7 |
| Node interrupted direct BTC send | Fail twice; one ordinary timing run passed | wdk-rln-interrupted-oQBlnm, wdk-rln-interrupted-DNk6cA; passing run hB6ISI |
| Node complete state relocation and re-spend | Pass | wdk-rln-cold-copy-GoNQ6O |
| Bare complete state relocation and re-spend | Pass | wdk-rln-cold-copy-M66a24 |
| Node / Bare bounded disk-full recovery and independent re-spend | Pass | wdk-rln-storage-eH2z3m / wdk-rln-storage-oWjLzH |
| Node BTC reorg, restart and exactly-once reconfirmation | Pass | wdk-rln-reorg-kLoFY2 |
| Node RGB reorg after settlement | Fail: stale settled balance after restart | wdk-rln-rgb-reorg-U2SPR9 |
| Node strict BTC force-close through maturity | Fail: no sweep | wdk-rln-force-close-ZMz9Td |
| Node strict RGB force-close | Fail: invalid commitment signature | wdk-rln-force-close-jKfXp9 |
| Optimized Node four-schema transfers, balances and exact exports | Pass | wdk-rln-assets-VUZzfX |
| Optimized Bare four-schema transfers, balances and exact exports | Pass | wdk-rln-assets-d6XlZn |
| Optimized Node six-decimal IFA contract import/settlement | Pass | wdk-rln-imports-njHk5S |

Run chain scenarios serially. An earlier RGB force-close attempt with concurrent
mining hit the fixture's exact-height indexer wait; it is not counted as a native
defect. The serial rerun above establishes the commitment failure. Initial Bare
launcher/dependency-engine and stale-indexer setup errors were corrected before
the passing funded runs; they are not hidden or counted as wallet bugs.

Accepted off-chain transfer-consignment metadata import is retained and covered
at the binding/error boundary, but a fresh positive Lightning-acceptance E2E is
not established by the on-chain contract-import tests. VSS, keysend retries,
APay/HODL concurrency, stock-peer interoperability, BFA fixtures and complete
channel fault matrices remain unqualified. The first strict payment failure
prevents later steps in the combined Lightning suite from qualifying anything.

## Review and promotion

- [WDK draft #45](https://github.com/UTEXO-Protocol/wdk-rgb-lightning/pull/45)
- [Node draft #24](https://github.com/UTEXO-Protocol/rgb-lightning-node-nodejs/pull/24)
- [Bare draft #22](https://github.com/UTEXO-Protocol/rgb-lightning-node-bare/pull/22)

All three branches descend from their respective 0.13 release branches; the old
drafts remain unchanged. Candidate versions are exactly 0.2.0-beta.2. Adapter
bytes match between native repos. AST checks preserve public methods in the five
principal WDK classes. Local verification: 850 WDK tests, 18 Node tests, 41 Bare
tests, seven C-FFI tests, three harness-ownership tests, declarations, lint and
package checks pass. npm production audits report no findings in these locks.

The initial [WDK CI run](https://github.com/UTEXO-Protocol/wdk-rgb-lightning/actions/runs/37287376692)
passed. [Node CI](https://github.com/UTEXO-Protocol/rgb-lightning-node-nodejs/actions/runs/37287360560),
[Node runtime matrix](https://github.com/UTEXO-Protocol/rgb-lightning-node-nodejs/actions/runs/37287360534)
and [Bare CI](https://github.com/UTEXO-Protocol/rgb-lightning-node-bare/actions/runs/37287366210)
stopped at the missing ORG_READ_TOKEN guard in that initial run. Source access
has since been provisioned; current results are in PRODUCTION-GATES.md.

Resolve the relevant upstream/package gates,
then run the complete optimized target/runtime matrix and anonymous target
installs. Requalify changed native sources before deliberate native-first
publication and WDK promotion. Mainnet Lightning/IFA exclusions, BFA restrictions
and optional feature gates must remain explicit; a reduced feature claim does
not resolve the BTC crash, RGB reorg or lifecycle failures.
