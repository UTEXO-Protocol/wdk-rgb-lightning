# rgb-lib-bfa migration candidate

This branch is unpublished `0.2.0-bfa.1`, based on the released beta.5 WDK.
It requires exact matching native artifacts. Installing beta.5 peers or using
a workspace link does not qualify this candidate. Do not merge or publish it
until the pending acceptance checks below have real evidence.

## Exact native sources

| Component | Commit |
| --- | --- |
| Focused RLN | `d10d679f0dd73246f6b475a44bdf13edd5f9b2a4` |
| UTEXO-Protocol/rgb-lib-bfa | `89c37086a68ef792da75c62bce59b58b1d7952a0` |
| LDK | `bbe68189872c26088e351d034b05c58769cb996a` |
| Bare candidate | `81cfe1fa8ce64ff82d671a24c23e35834fc8b490` |
| Node candidate | `5f9b0e9a59e59d265f900a8e5f79a2644058a1ca` |

The shared C-FFI lock SHA-256 is
`3039a36910386f9d6f350ed33791cd6461174cd340247998b80726a6581c3763`.
The maintained adapter SHA-256 is
`db4511e71a1c770def1aeeb5f1ab5e72e07fdd228627d6d744dce56b4b3bdcfe`.
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

### Current bfa.1 source qualification

The exact graph above passes 128 RLN Rust tests, 18 C-FFI tests and 40 WDK
suites / 1,484 tests. WDK also passes TypeScript, lint, the WebRGB peer contract,
exact native-source verification and clean-HEAD package allowlist admission.
These source/package checks do not qualify a newly installed native binary.

This graph contains the native EVM JSON-RPC empty-parameter repair, preserving
explicit configured endpoints. WDK's additive `estimateFeeResult()` represents
only the exact native no-estimate condition as an unavailable result; unexpected
transport, lock and malformed-response failures remain errors. The original
`estimateFee()` contract is unchanged.

New seven-target Bare and five-target Node builds, original CI receipts, native
artifact admission and actual packed Node/Bare consumers remain pending. The
previous candidate's binaries, package hashes and financial/VSS passes are
historical evidence and must not be reused as bfa.1 acceptance. The new candidate
keeps separate archive identities rather than overwriting the frozen bfa.0 set.

The next runtime checks include fresh disposable public Signet VSS default-on,
manual backup, Off/On policy, truthful completion receipts, graceful reopen and
fresh-directory restore; the installed WDK fee-result boundary; and repeated
funded isolated BTC/BFA send/receive, restore and stable polling on this exact
graph. Native V1 burn, saved proof, independent bridge redemption, exactly-one
EVM payout and replay rejection remain separate financial acceptance scopes.
No hosted dev bridge has been operated and no migration package is published.

APK creation is explicitly on hold at the user's request. No APK or installed
mobile acceptance is claimed for bfa.1; the running Android app is preserved.
Mobile Release and user-run hosted bridge acceptance remain separate checks.

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
