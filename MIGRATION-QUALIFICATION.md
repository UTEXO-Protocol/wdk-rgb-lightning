# rgb-lib-bfa migration candidate

This branch is unpublished `0.2.0-bfa.0`, based on the released beta.5 WDK.
It requires exact matching native artifacts. Installing beta.5 peers or using
a workspace link does not qualify this candidate. Do not merge or publish it
until the pending acceptance checks below have real evidence.

## Exact native sources

| Component | Commit |
| --- | --- |
| Focused RLN | `c29d1b2dfe43ba95c25ced8984f09e42c789d6af` |
| UTEXO-Protocol/rgb-lib-bfa | `962730a211f0f7569d7ad8ae777052f433d87655` |
| LDK | `510189d5700a6d1406229ce7523e181c3838715e` |
| Bare candidate | `72d07995abf5b916ece7fe05374d506e4a320cec` |
| Node candidate | `82c628300329fdd48ca4f84af0215b032b946cf1` |

The shared C-FFI lock SHA-256 is
`460728009d9c1db3abf9a2f2ad4d76f777589b55eff96ff7be1f3c4d301dab30`.
The maintained adapter SHA-256 is
`cf92a4618b765e7889001c9e630e6e64861ef9bdd295d57551461d3bc3281d4c`.
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
wallets. The supplied Signet public contract is **Bridged USDT / BUSDT / 6**,
asset `rgb:OG9No4hZ-UrxoWmR-09ohtOk-ppxBN7h-g~KkQro-ncKc9A4`, SHA-256
`dfb49261fed5ad3dd237dd3a03913793b76fe70e486372bbeb0769b82158a895`.
It must not be relabelled as a funded regtest asset; the local fixture has its
own issued identity. Native import proves registration and metadata, not a
spendable balance or hosted-bridge acceptance.

## Qualification status

The latest focused repair maps wrong-ID/network contract validation failures to
the existing invalid-contract category and resolves the UniFFI input path at
build-script runtime. Focused/maintained/focused shared-cache switches each pass
the four targeted tests and generate the correct checkout's scaffolding without
touching inputs or cleaning the cache. The recorded Darwin Debug/BTC evidence
below used the prior `cd3be114` focused implementation. Those original binaries
and receipts are retained; rebuilt `c29d1b2d` native acceptance is pending until
its separately recorded rerun completes.

WDK now passes 38 suites / 1,373 tests, types, lint, the optional WebRGB
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

Still required: new target artifacts and actual packed consumers; funded
blind/witness receive and send; local bridge mint, burn, proof and exactly-one
payout; BFA persistence and failure recovery;
and a user-coordinated iOS 27 rebuild and runtime test. No hosted dev bridge
has been operated and no migration package has been published.

RLN's upstream submodule ancestry check also waits for companion LDK #59:
the exact migration commit is intentionally not yet reachable from LDK `dev`.
This is separate from the private-source CI permission failure. Neither check
is weakened, and no dependency PR has been merged during qualification.

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
