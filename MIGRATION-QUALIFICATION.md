# rgb-lib-bfa migration candidate

This branch is unpublished `0.2.0-bfa.0`, based on the released beta.5 WDK.
It requires exact matching native artifacts. Installing beta.5 peers or using
a workspace link does not qualify this candidate. Do not merge or publish it
until the pending acceptance checks below have real evidence.

## Exact native sources

| Component | Commit |
| --- | --- |
| Focused RLN | `cd3be114a6d0e41af8ce3f29719d210e105234dc` |
| UTEXO-Protocol/rgb-lib-bfa | `962730a211f0f7569d7ad8ae777052f433d87655` |
| LDK | `510189d5700a6d1406229ce7523e181c3838715e` |
| Bare candidate | `388e6ca05402ca95834de439e196afc08adf4f0a` |
| Node candidate | `0000868bc7376e1738ba298d1352136c5f960790` |

The shared C-FFI lock SHA-256 is
`460728009d9c1db3abf9a2f2ad4d76f777589b55eff96ff7be1f3c4d301dab30`.
The maintained adapter SHA-256 is
`3662f1e7d97f5bb540b1e6cb0bce98a2e0b243868417e481bcd0c27e15819702`.
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

Source checks have passed for the validated contract/snapshot APIs, focused
VSS fault cases, retained signer lifecycle and BIP-322, C-FFI boundaries,
strict source preparation, and Bare/Node JavaScript boundaries. WDK and Iris
source tests cover invoice precision, V1 commitments, consent, journals and
candidate admission. Source tests do not establish runtime acceptance of a
newly installed binary.

Actual Darwin Debug Bare and Node consumers also pass signer shutdown/reopen,
worker teardown, official and independent BIP-322 proofs, and encrypted local
VSS backup/policy/receipt/restore tests. The local VSS fixture uses format-only
authentication; this is not hosted cloud authorization qualification.

Still required: new target artifacts and actual packed consumers; funded
blind/witness receive and send; local bridge mint, burn, proof and exactly-one
payout; persistence and failure recovery; funded recovery qualification;
and a user-coordinated iOS 27 rebuild and runtime test. No hosted dev bridge
has been operated and no migration package has been published.

The existing external-signer VSS bootstrap credential limitation remains.
Generic new-library gaps in custom channel funding locktime, deferred sweep
consumption and IFA linking are guarded explicitly; no global Lightning
disablement or mnemonic fallback was added. Iris remains on-chain only.
