# BFA Source Candidate

Branch: `release/rln-0.15.0-beta.3` in WDK, Node.js and Bare.
Candidate package version: `0.2.0-beta.3`. Not published or approved for production.

## Inputs

- RLN: merged PR #192, commit `a17b685615750536f0320db1cd3f3ba68a8f1c57`.
  Its diff from `v0.15.0-beta.3` contains only that external-signer unlock change.
- rust-lightning remains `6d6d061f840264296e7de2b1c64dac6c0dd7eb26`.
- rgb-lib remains `aaf5b52f63ff2ee966707f099aacadd5f2e6037f`.
- RN comparison: `rgb-sdk-rn` dev at
  `3bb39df43f281fe0c4723d588c496ddc01e5176e`; both native platforms still pin
  the published RLN `0.15.0-beta.3` binaries.

## Work

| Item | Status | Evidence |
| --- | --- | --- |
| Verify merged source and RN baseline | Done | Exact merge diff, submodule and native dependency pins inspected. |
| Regenerate binding-only adapter and provenance | Done | Both patches SHA-256 `93d62bb91c0ab90a7ccc4a1382a9da84498e38506170ce74d3863292f0c9f2f4`; optimized macOS arm64 Node/Bare builds pass. Exact-commit Bare clone and adapter verification pass. |
| Expose Ethereum RPC on WDK unlock | Done | Omitted/null compatibility, request equality, forwarding and credential-safe input errors covered. Different endpoints cannot share an in-flight unlock. |
| Native and WDK regression tests | Done on host | 862 WDK tests, 19 Node tests, 44 Bare tests, declarations, lint, native canaries and fresh packed-consumer smoke tests pass. Both native entrypoints pass 12 integration cases per runtime. |
| Funded BFA receive/send/balance/export | Done on host | Strict Node and Bare wallets pass real Anvil-backed BFA receipt, witness send, balances, history, byte-exact export and cold restart. Invalid mints reject without credit. |
| RN parity review and release gates | Done; blockers remain | RN dev source/native wiring reviewed; its 21 WebRGB/burn tests pass. These are not RN funded/device tests. External burn and the shared event-selection defect remain. |
| Final review | Done | Source pins, identical adapters, types, full WDK suite, lint and package contents checked again. |
| Existing draft branch updates | Done | WDK #45, Node #24 and Bare #22 remain draft-only. No release approval inferred from interface support. |

## React Native Comparison

RN baseline is package `1.0.0-beta.34` on the pinned dev commit above. Its
password-signer flow is the relevant BFA comparison. API presence and adapter
unit tests are not a claim of end-to-end mobile qualification.

| Area | React Native dev | WDK candidate after this update |
| --- | --- | --- |
| Native source | Published RLN `0.15.0-beta.3` binaries, without #192. | Exact merged #192 source; no floating branch or unmerged core patch. |
| Ethereum RPC / BFA validation | `ethRpcUrl` reaches password unlock on iOS/Android. | `eth_rpc_url` reaches both native external-unlock entrypoints; 24 actual native cases pass across Node/Bare. |
| Receive and send BFA | Generic RGB blind/witness receive and send APIs; BFA mapped in the wallet layer. | Funded blind receipt and witness send pass on Node/Bare using a real ERC-20 lock, bridge OpId and strict signer. |
| BFA list, metadata and balance | Explicit BFA list mapping plus generic metadata/balance calls. | Same supported surfaces; settled balances and cold-restart spendability checked on both runtimes. |
| Transfer history | Generic RGB history/status mapping. | Both sides reach `Settled`; WebRGB BFA reads and txid history work. Unassigned receives remain subject to RLN's asset/txid query requirement. |
| Saved consignment | Wallet returns standard Base64; native/local path also exposed. | WDK returns `Uint8Array`; native packages expose hex bytes and local path. Tests compare WDK, native and disk bytes. Formats differ, not the underlying data. |
| Numeric precision | BFA list mapping rejects amounts outside the safe JS integer range. | Native response integers remain exact strings above that range; WebRGB rejects values its numeric contract cannot represent. Requests remain safe-integer limited. |
| Capability reporting | Native BFA/consignment flags; burn additionally gated by signer. | `bfa: true`, `consignment: true`, `burn: false`; compiled source/capability identity is checked. Flags describe build support, not endpoint health or release approval. |
| Burn | Password signer exposes native burn. | Still unavailable: RLN explicitly rejects burn in external-signer mode. #192 does not change that. |
| Persistent burn journal | Optional `BurnOperations`: durable pending state, no automatic reburn after ambiguous completion, persistence retry and independently verified reconciliation. | Not added while native burn is unsupported. Required application/package follow-up if burn is enabled later. |
| WebRGB burn/proof extension | Optional burn controller, EVM recipient encoding, payout-chain allowlist, approved proof export with length and Keccak digest. | Receiving/read adapter remains available. No burn/proof extension or browser runtime added. Ordinary account consignment export is available. |
| BFA issuance / bridge mint orchestration | No public BFA issue/bridge-begin/bridge-end wallet methods in this branch. | Not a WDK wallet feature either. The local test issuer uses pinned rgb-lib directly. |
| Wrong-first-event validation | Same RLN/rgb-lib/consensus source pin; affected by the shared validator defect. No RN device reproduction in this work. | Reproduced with real funded Node wallets: an earlier wrong-amount lock causes a later correctly backed mint to be marked `Failed`. |

Source anchors: RN [password unlock](https://github.com/UTEXO-Protocol/rgb-sdk-rn/blob/3bb39df43f281fe0c4723d588c496ddc01e5176e/src/binding/RLNBinding.ts#L162),
[BFA mapping](https://github.com/UTEXO-Protocol/rgb-sdk-rn/blob/3bb39df43f281fe0c4723d588c496ddc01e5176e/src/wallet/utexo-wallet.ts#L335),
[burn and export](https://github.com/UTEXO-Protocol/rgb-sdk-rn/blob/3bb39df43f281fe0c4723d588c496ddc01e5176e/src/wallet/utexo-wallet.ts#L552),
[journal](https://github.com/UTEXO-Protocol/rgb-sdk-rn/blob/3bb39df43f281fe0c4723d588c496ddc01e5176e/src/wallet/operations/burn.ts),
[WebRGB burn extension](https://github.com/UTEXO-Protocol/rgb-sdk-rn/blob/3bb39df43f281fe0c4723d588c496ddc01e5176e/src/integrations/webrgb/burn.ts),
and RLN [external burn rejection](https://github.com/UTEXO-Protocol/rgb-lightning-node/blob/a17b685615750536f0320db1cd3f3ba68a8f1c57/src/sdk/mod.rs#L4388).

## Host Evidence

Run date: 2026-10-07. Node 22.23.0, Bare 1.33.0 for WDK integration, Rust 1.94.0.
Native builds are optimized macOS arm64 artifacts with verified source, adapter,
wrapper and lock provenance. No permissive signer policy was used.

- Node protocol cases: `wdk-external-eth-unlock-qo3QG6`, 12/12 pass.
- Bare protocol cases: `wdk-external-eth-unlock-5m3YHb`, 12/12 pass.
- Node funded happy path: `wdk-bfa-cyV2pm`, all eight recorded steps pass.
- Final Node acceptance run: `wdk-bfa-RMh5AG`, all ten steps pass, including
  missing-lock/wrong-amount rejection and cleanup.
- Node adverse run: `wdk-bfa-yVun8h`; happy path, cold restart, missing-lock and
  wrong-amount-only rejection pass. The final valid-after-wrong-lock acceptance
  check fails (`Failed`, expected `Settled`). Cleanup passes.
- Bare funded run: `wdk-bfa-eZ5h9c`, all ten recorded steps pass, including both
  invalid-mint checks and cleanup.
- Both clean packed consumers install matching artifacts and pass native identity,
  strict signer, mainnet policy and optional WebRGB smoke tests.
- RN's `test:webrgb` builds its JS/declarations and passes 21 adapter/journal tests.
  No new RN native binary or mobile-device run is implied.

The existing local Bitcoin/Electrs/Esplora/proxy stack was reused. Anvil image
digest `sha256:0c00cb0bda1ab1b91c9a6bf60f4c76c09c1a8870824b6d4718afbabacf6f9a17`,
chain 31337, served loopback port 29545. Contracts come from the pinned rgb-lib
source with OpenZeppelin v5.0.2. The token has six decimals; the tests verify raw
integer units. This is not a public-network USDT deployment qualification.

Reproduction commands and the intentionally failing event-selection acceptance
case are in [tests/regtest/BFA.md](./tests/regtest/BFA.md). Private wallet state
and mnemonics are not committed.

## Remaining BFA Work

1. **Hard BFA validation blocker:** [rgb-lib #103](https://github.com/UTEXO-Protocol/rgb-lib/pull/103)
   remains open. It advances rgb-consensus from `2faf6118` to `c250a9e3` and adds
   regression tests for selecting any matching event. The current graph still
   pins `2faf6118`. Merge/release and propagate the approved graph through RLN
   and both bindings, then rerun the funded acceptance test. No unmerged fix is
   included here.
2. **Burn feature blocker:** RLN needs an external-signer burn path with signed
   PSBT validation and recovery tests. Only after that is available should WDK
   add the burn API, durable journal and optional WebRGB burn/proof extension.
3. **Release qualification:** only macOS arm64 artifacts were rebuilt for this
   source. Complete Node/Bare artifact matrices, mobile/runtime tests and
   anonymous all-target installs remain unqualified. Publication guards reject
   the incomplete matrices; no old artifact is accepted as a substitute.
4. **Build distribution:** neither native repository has an `ORG_READ_TOKEN`
   repository secret when checked on 2026-10-07. Hosted CI still needs approved
   private-source access, and redistribution/license review remains open.

## Existing Gates

This change does not fix the recorded persistent signer lock, RGB reorg
settlement, interrupted BTC reservations, Lightning recovery, VSS recovery,
native security findings or complete target/runtime qualification. See
`RELEASE-0.15-TRACKER.md`. No browser runtime or Iris dependency update is included.
