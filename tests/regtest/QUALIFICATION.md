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
3. **External-signer issuance/inflation.** Released RLN explicitly rejects these
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
- Bare: 31 JS/installer tests including ELF negatives; declarations and real
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
mobile device/emulator/React Native lifecycle and TLS; other advertised Node
targets beyond recorded CI/host results; full reorg/justice/disk-failure and
fresh-device recovery; force-close CSV sweep maturity; multi-hop/swap/linked-asset
and media matrices; exact deployed Signet/mainnet LSP behavior; independent review
and registry publication/provenance. These are not silently counted as passing.

The integrator's zero-channel incident remains unproven without its actual client
and server artifacts/logs. Local provisioning success does not establish that
incident's root cause. Both Signet rollout and mainnet production remain gated by
the strict-signer and reopen failures plus their applicable deployment checks.
