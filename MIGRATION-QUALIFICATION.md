# rgb-lib-bfa migration candidate

This branch is unpublished `0.2.0-bfa.1`, based on the released beta.5 WDK.
It requires exact matching native artifacts. Installing beta.5 peers or using
a workspace link does not qualify this candidate. Do not merge or publish it
until the pending acceptance checks below have real evidence.

## Exact native sources

| Component | Commit |
| --- | --- |
| Focused RLN | `89ebe9fdb1be94cbba0b2bd722cea9af297399f1` |
| UTEXO-Protocol/rgb-lib-bfa | `abd41d3afff6d8fb11461e26e843301650e22df3` |
| LDK | `17f2fb56f8d96d0ec512c715d2ebc65f829eb2c2` |
| Bare candidate | `8a3d1719544c113952cfb91d9b3694baa63e8cb9` |
| Node candidate | `b516a830f579360c88920719527d0a5511da0225` |

The shared C-FFI lock SHA-256 is
`741bd3d0f81b28c1f40e426b44f5c9ae152d777269934d7c0dc919d74f908da9`.
The maintained adapter SHA-256 is
`4a730e3036e1197b2d9cd2d2584de722745f35e74dd1707dfe9b08e251b8b12b`.
`native-peer-sources.json` and `src/native-runtime-contract.js` enforce these
identities. RLN's base version string remains `0.17.0-beta.3`; the exact
commit identifies this focused migration. It is not an official new RLN tag.

Related draft PRs: [RGB #4](https://github.com/UTEXO-Protocol/rgb-lib-bfa/pull/4),
[LDK #59](https://github.com/UTEXO-Protocol/rust-lightning/pull/59),
[RLN #212](https://github.com/UTEXO-Protocol/rgb-lightning-node/pull/212),
[Bare #30](https://github.com/UTEXO-Protocol/rgb-lightning-node-bare/pull/30)
and [Node #29](https://github.com/UTEXO-Protocol/rgb-lightning-node-nodejs/pull/29).
RLN #211 remains unchanged.

## Integration

The invoice-first send path preserves recipient keys, encryption and expiry
from the complete invoice, validates integer amounts without precision loss,
and delegates signing and proxy ACK ordering to the native wallet. Existing
legacy send calls cannot supply missing proxy-1.0 recipient keys; callers must
retain the complete invoice instead of fabricating or dropping those fields.

Address reuse is another explicit library compatibility change. Native
`reuse_addresses: true` is unsupported. This candidate defaults WDK to false
and rejects explicit true before constructing a node. `getAddress()` retains
the session's current address; `getNewAddress()` allocates and persists a fresh
one. Iris already explicitly uses false. No legacy-wallet conversion is
claimed or needed for the disposable migration fixtures.

The V1 bridge destination helpers bind the destination chain, endpoint ID and
recipient to the burn commitment. They do not qualify a route or perform an
EVM payout. Applications must persist consent and burn intent before native
burning, retain returned proofs, and avoid reburning an ambiguous operation.
Iris can replay a durably completed burn result; a cold pending burn still blocks
new burns because no authoritative intent-to-native-operation correlation is
persisted before the native call. The isolated one-shot qualification journal
does not establish production cold-pending recovery.

Build the native peers from the exact commits above with their normal source
and artifact gates. Assemble all seven Bare targets and all three payload
archives before packing the wrapper. Independently inspect the CI artifact
receipts, freeze the candidate iOS archive identity, and use the normal archive
verifier. Pack this WDK from a clean, committed tree. Install the resulting
archives into a fresh consumer under the documented npm 12 install-script
approval policy; file dependencies require their exact file-source grants.
Keep the registry peer-release gate for publication. These unpublished
versions cannot pass a registry availability check yet.

The migration uses a separate local chain, proxy 1.0, bridge and disposable
wallets. The initial historical Signet import fixture was **Bridged USDT / BUSDT / 6**,
asset `rgb:OG9No4hZ-UrxoWmR-09ohtOk-ppxBN7h-g~KkQro-ncKc9A4`, SHA-256
`dfb49261fed5ad3dd237dd3a03913793b76fe70e486372bbeb0769b82158a895`.
It must not be relabelled as a funded regtest asset; the local fixture has its
own issued identity. This historical contract is not the current Iris staging
asset configuration. Native import proves registration and metadata, not a
spendable balance or hosted-bridge acceptance.

## Qualification status

### Current final89 maintained source qualification

The final maintained overlay passes 453 library tests, 19 C-FFI tests and
three explicitly selected funded fixtures on its own local chain. Four library
entries remain ignored in the broad run: the three funded fixtures were run
separately, and one entry is a subprocess helper. These counts overlap focused
runs and must not be added together. Bare's 112 JavaScript tests and Node's
47 JavaScript tests and both declaration checks pass. WDK passes 41 suites /
1,574 tests, types, lint and exact native peer source admission.

Mutation admission explicitly covers both funding branches and all protected
sweep phases. The output operation retains its outer snapshot writer and raw
inner guards. Tests distinguish paused/enabled automatic backup, durable
pending intent, failed upload, actual protobuf-client commit acknowledgement,
catch-up when enabling, canceled callers, signer shutdown/reopening, BIP-322
and bounded VSS restore. The external-signer VSS credential limitation is
unchanged; local fixture commits do not establish public-cloud authorization.

The exact graph is being compiled for Android ARM64 first, with a separately
scoped Darwin Node consumer for packed native acceptance. Other mobile/native
targets, complete distribution assembly and publication gates are separate.
No previous APK or historical native binary qualifies these sources. Android
APK creation, import, protected Settings, outputs, actual session resumption
and funded acceptance require their own final-artifact receipts.

V1 construction now supports explicit configured EVM and native Tron routes,
including checksum validation and independent Go ABI vectors. This constructs
and verifies destination commitments; it does not prove payout liquidity or
settlement on public Ethereum, Arbitrum, Polygon, Plasma or Tron. Iris retains
consent, durable intent, exact proof/result matching and no automatic reburn.

The inherited LDK legacy test-harness compilation limitation remains separately
documented. LDK #59 was merged by the team as the canonical commit in the table;
its reviewed pre-merge branch identity is not used as the dependency pin.

### Historical 7cced3 bfa.1 source qualification

The following results belong to the earlier 7cced3 / b70bb7 graph. They do not
qualify the final89 graph or its newly rebuilt artifacts.

That earlier graph passes 21 native durable-output Rust cases, including two real
funded isolated regtest fixtures, 13 wallet-source/snapshot-barrier cases and
53 VSS cases. The funded scope verifies actual watch-only PSBT fee/count,
independent funding with a retained legacy reservation, exact same-transaction
retry after a real broadcast followed by an injected database failure, and
confirmation recovery. It does not qualify a packaged mobile signer.

Bare passes 112 host installer/contract tests and Node passes 47 host contract
tests, with TypeScript checks for both. The maintained C-FFI graph (including
VLS/VSS) and Node NAPI adapter pass locked Rust typechecking. WDK passes
41 suites / 1,567 tests, TypeScript, lint and the WebRGB peer contract.
Exact native-source verification and clean-HEAD package allowlist admission
bind this WDK to the committed peers above. Source and package admission are
separate from installed native binary and device acceptance.

The candidate preserves the EVM JSON-RPC empty-parameter repair and explicit
configured endpoints. WDK's additive `estimateFeeResult()` represents only the
exact native no-estimate condition as unavailable; unexpected transport, lock
and malformed-response failures remain errors. `estimateFee()` is unchanged.
The recoverable output setup API below adds explicit operation identity,
transaction-bound review and evidence-based cancellation. Snapshot capture
shares a barrier with the complete output-operation journal/database transition;
automatic backup cannot capture a reserved input without its prepared record.
Existing VSS policy ownership and completion semantics are retained.

At that historical checkpoint only an Android ARM64 candidate was requested.
Rebuilding the other six Bare targets, all Node platform binaries, full native
distribution assembly and their corresponding runtime acceptance are deferred.
The all-target publication gates are unchanged. Previous binaries, archived
qualification counts and package hashes must not be reused to qualify this
new source graph. No new packaged-native or Android installation pass is
claimed in this source qualification record.

Android device checks still need the exact new compiled runtime and wrapper
identities, wallet creation/reopen, output prepare/review/cancel/submit/recovery,
usable pending/confirmed outputs, and bridge admission. Funded BTC/BFA
transfers, VSS remote behavior and bridge mint/burn retain their separate
financial acceptance scopes. No hosted dev bridge has been operated and no
migration package has been merged or published.

Prior bfa.1 source checks (128 RLN tests, 18 C-FFI tests and 40 WDK suites /
1,484 tests) applied to the earlier `d10d679f` / `db4511e7` graph. They are
historical evidence, not additional acceptance counts for the graph above.

### Historical bfa.0 and earlier Debug qualification

The following results and their then-pending repairs describe earlier source
graphs. Their exact pins, counts and receipts are retained for comparison; none
is an acceptance result for the current bfa.1 graph above.

The focused `c29d1b2d` repair maps wrong-ID/network contract validation failures
to the existing invalid-contract category and resolves the UniFFI input path at
build-script runtime. Focused/maintained/focused shared-cache switches each pass
the four targeted tests and generate the correct checkout's scaffolding without
touching inputs or cleaning the cache. Earlier `cd3be114` Debug/BTC evidence and
later `c29d1b2d` / `cf92a461` Debug financial evidence are retained separately.
Neither qualified the then-new `26834a8a` adapter or its pinned peers.

That WDK source passed 39 suites / 1,429 tests, types, lint, the optional WebRGB
contract, exact native-source checks and package allowlist verification. Its
packed Bare canary requires all three candidate payload archives alongside the
wrapper and retains exact install-script grants and runtime admission. The old
beta.5 regtest/mobile harnesses refuse to operate this new graph before effects;
they remain historical evidence.

Source checks have passed for the validated contract/snapshot APIs, focused
VSS fault cases, retained signer lifecycle and BIP-322, C-FFI boundaries,
strict source preparation, and Bare/Node JavaScript boundaries. WDK and Iris
source tests cover invoice precision, V1 commitments, consent, journals and
candidate admission. Source tests do not establish runtime acceptance of a
newly installed binary.

Actual WDK source consumers on Node and Bare 1.33 pass construct/unlock,
on-chain reads, stable cached/fresh address allocation, BIP-322 and signer
shutdown/reopen. They decode a real new-proxy witness invoice, retaining
required encryption, recipient key and nullable legacy proxy ID. These tests
use explicit isolated Debug native resolution; they are not packed acceptance.

Actual Darwin Debug Bare and Node consumers also pass signer shutdown/reopen,
worker teardown, official and independent BIP-322 proofs, and encrypted local
VSS backup/policy/receipt/restore tests. The local VSS fixture uses format-only
authentication; this is not hosted cloud authorization qualification.

Funded isolated-regtest WDK source consumers on those Debug natives pass
Node-to-Bare 50,000 sats, Bare-to-Node 20,000 sats, confirmed backup checkpoints,
reopen, and explicit crash-writer recovery after verifying the old process group
is gone. A fresh-directory Node restore preserves settled balances, history and
canonical signing identity; its subsequent 10,000-sat payment to Bare confirms.
This restores the RGB wallet alongside an independently provisioned signer store
from the same disposable fixture seed. It does not prove full signer-store or
Lightning recovery. The checksum-bound host receipt is retained as
`DARWIN-DEBUG-HOST-QUALIFICATION.json` in the isolated qualification workspace.

Actual isolated `c29d1b2d` / `cf92a461` Darwin Debug source consumers then pass
public-CON import and negative identity/network/corruption controls, a genuine
100-BUSDT local bridge mint, and four ordinary non-donation proxy-1.0 transfers:
2 BUSDT and 1 BUSDT to witness invoices, and 0.5 BUSDT and 0.25 BUSDT to blind
invoices. Each ordinary send has independently verified public ACK signatures
bound to its native exported consignment and mined Bitcoin transaction. The
initial bridge mint does not use that ordinary-send ACK flow. Fresh-directory
Node and Bare restores preserve exact synchronized balances, outputs,
allocations, history and signing identity. A blinded invoice created before its
Node snapshot remains usable after restore; both restored wallets subsequently
spend BTC and BFA and reopen. The partial-run receipt is
`qualification-consumers/funded-Vr0bvY/qualification.json`, SHA-256
`5c5cda9e54d87c139d2470c3eccc822e7b323fcaf7d02c94c17960e6856fd186`.
This run stopped before burning: stable funded polling advanced VSS 78 to 80
while all public financial state remained equal at the same Bitcoin tip.

A separate funded stepwise reproduction proves duplicate automatic-backup
ownership: unchanged direct native refresh adds one upload, WDK refresh adds
two, and full BTC/history/output sync adds none. All fourteen public frames keep
the same acknowledged full-content digest and allowed BDK metadata; no digest
coverage was relaxed. Its receipt is
`qualification-consumers/funded-ZzQEJp/qualification.json`, SHA-256
`3551f180585cdc11dc7e4ebd4f9cc1e606199118d51fb70aa1bc75bcbabc5011`.
That repair's adapter uses its complete acknowledged-content check for
refresh while retaining fresh, pending, failed and private-state changes. WDK's
serialized automatic fallback skips an extra upload only with validated clean
native status and a current identity/network/endpoint-bound completion receipt.
Missing or uncertain evidence retains fallback; manual Backup Now is explicit.
The repair passes 113 compiled Rust lib tests with `uniffi,vls,vss,test-utils`
and all 1,429 WDK tests. Its native source receipt SHA-256 is
`7e42bee7f1b95fb7ba8b92e8aad23b109c96b76fff70e041647cc1c2ff0b8824`.
New binaries and actual post-fix financial/stable-poll acceptance remain pending.

The earlier run's remaining scopes were: new target artifacts and actual packed consumers; repeat the
funded BTC/BFA, restore and stable-poll scopes on the exact current peers; local
native V1 burn, saved proof, independent bridge redemption, exactly-one EVM
payout and replay rejection; and a user-coordinated iOS 27 rebuild and runtime
test. Neither the partial financial run nor its standalone journals qualify
Iris cold-pending burn recovery, hosted cloud VSS secrecy, mobile Release or
public-network operation. No hosted dev bridge has been operated and no
migration package has been published.

### Remaining upstream and release limitations

RLN's upstream submodule ancestry check also waits for companion LDK #59:
the exact migration commit is intentionally not yet reachable from LDK `dev`.
This requirement is separate from wrapper target builds and artifact admission.
No check is weakened, and no dependency PR has been merged during qualification.

The existing external-signer VSS security limitation remains: its authentication
and encryption material is derived from public wallet bootstrap data. A party
with that data cannot be assumed excluded from the backups. Snapshots include
private proxy operation keys, so local AEAD/CAS/restore passes do not establish
credential secrecy or production cloud confidentiality. Private signer-derived
VSS material requires separate external-signer API support; this migration
preserves existing functional behavior without claiming that prerequisite.
The new library lacks explicit final-zero-locktime channel funding construction,
deferred channel-sweep consumption and old IFA linking. This candidate cannot
open ordinary locally funded BTC or RGB Lightning channels: colored open
preflight/funding requests `Some(0)`, and vanilla funding calls a dedicated
guarded builder. Colored virtual funding is also blocked. These are real
funding failures, not just unsupported user-selected locktimes. Incoming
peer-funded channels, existing-channel behavior and uncolored synthetic virtual
channels are separate, unqualified paths. No global Lightning disablement or
mnemonic fallback was added. Iris remains on-chain only.

Restoring funding requires a library-owned API that constructs final-zero-locktime
transactions before persisting txid-bound reservations/consignments, with matching
dry-run, end and abort semantics. Dropping the guard or rewriting the returned
PSBT can invalidate that persisted identity. Ordinary on-chain BTC and complete
RGB invoice sends use separate supported builders; their acceptance is recorded
independently.

The packed Bare consumer exposed a distribution-specific failure in the new
WebRGB burn helpers: importing the WebRGB subpath selected the hash library's
`node:crypto` import without the main entry's Bare builtin mappings. The subpath
now has its own Bare entry with the same mappings. The normal packed consumer
also checks an independent bridge burn-commitment vector through that public
subpath. This changes JS packaging only; the reviewed native graph and binaries
remain unchanged. Source tests alone do not qualify this path: the actual packed
consumer and installed mobile build remain separate acceptance checks.


## Recoverable RGB output setup

The candidate adds `rgb-output-operations-v1`. Check the compiled capability and the complete API surface before using it; method names alone do not establish native support.

Persist a random `operation_id` containing 32–64 lowercase hexadecimal characters before calling `prepareCreateUtxos({ operation_id, up_to, num, size, fee_rate, skip_sync })`. Preparation reserves native inputs and returns the exact transaction ID, input outpoints, actual RGB output count and Bitcoin fee for review. The library may prepare fewer outputs than requested when funds do not cover the requested count and fee; always review the returned count and fee. No transaction is signed or broadcast during preparation.

`commitPreparedCreateUtxos({ operation_id })` commits only the persisted transaction. Retrying the same ID retains the same transaction and input ownership. `getCreateUtxosOperation({ operation_id })` and `listCreateUtxosOperations()` recover operation evidence after process loss; `listPendingVanillaTransactions()` reports native reservations. Never infer an operation's identity by comparing transaction histories.

| Status | Meaning and allowed action |
| --- | --- |
| `preparing` | Preparation was interrupted before a complete review record. Native recovery releases only an unambiguously owned, provably unbroadcast reservation. |
| `prepared` | Exact transaction ready for review. `can_commit` permits the reviewed transaction; only `can_cancel: true` proves safe cancellation. A restored snapshot may predate a broadcast, so restored preparations cannot be discarded merely because the snapshot says `prepared`. |
| `submitting` | The exact signed transaction is persisted and broadcast may have occurred. Retry commits only that same transaction; cancellation is refused. |
| `broadcast` | Native broadcast bookkeeping completed. Observe the exact transaction for confirmation. |
| `confirmed` | The exact transaction was observed confirmed. Reconcile again after a chain reorganization. |
| `cancelled` / `failed` | A terminal, provably unbroadcast operation. Its ID cannot be reused for different intent; prepare a fresh operation if needed. |

`cancelCreateUtxosPlan({ operation_id })` is permitted only when native `can_cancel` evidence proves it safe. Never derive this permission from `status` alone. A timeout, missing mempool transaction or elapsed time never authorizes clearing uncertain inputs. Existing usable RGB outputs and independently spendable native inputs do not require a blanket ban on new output setup. Native reservation and allocation checks remain authoritative.

The legacy one-shot `createUtxos()` remains available for compatibility. Applications needing review, interruption recovery and exact idempotent retries should use the prepared operation API. Host JavaScript tests are distinct from funded native and Android application qualification; retain the exact source and artifact receipts for each tested build.
