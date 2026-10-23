# Historical Local Released-Runtime Qualification

This fixture is the released beta.5 / legacy rgb-lib / proxy-0.3 scope. It is
**not rgb-lib-bfa/proxy-1.0 migration qualification**. The migration branch
refuses setup, native-wallet construction and chain/daemon calls before any
legacy stack operation. Reproduce this historical fixture from its exact beta.5
source graph; do not update these dependencies or reuse these ports/volumes as
the migration stack. See [migration qualification](../../MIGRATION-QUALIFICATION.md)
for the separate candidate graph and pending acceptance work.

Disposable regtest only. No mainnet/Signet funds, existing wallets, VSS, virtual
channels, or unmerged upstream behavior patches are used. These tests exercise
the real WDK and native packages, not the Jest mocks. Run scenarios serially:
they share a chain, service volumes and fixed loopback ports.

These services are isolated qualification tooling for funded, reorg and fault
scenarios. Other projects should use the separately provisioned shared Utexo
stand and its consumer documentation. Never run chain-rewind, state-reset or
adverse-recovery scenarios against that shared stand.

## Pinned Stack

Base services selected on 2026-09-24; RLN source updated on 2026-10-14.
This is a reproducible local stack, not a claim
that a remotely deployed LSP runs the same commit.

| Service | Source/version | Local endpoint |
| --- | --- | --- |
| Bitcoin Core | 31.1, official archive checksums in Dockerfile | RPC 127.0.0.1:29443 |
| RGB Electrum | romanz/electrs 0.12.0, 37501cc4b94aea99e50670a6524fa3ad4ac9aabb | TCP 127.0.0.1:29401 |
| Esplora | mempool/electrs 3.3.0, image digest pinned | HTTP 127.0.0.1:29302 |
| RGB proxy | 0.3.0, image digest pinned | HTTP 127.0.0.1:29300 |
| RLN | v0.17.0-beta.3, ecc69f20308231400561f6f060fea88acfa40cc4 | HTTP 127.0.0.1:29301 |
| LSP | main b865c8868e202ba90055d4924382eada62c52cd6; no release tag | HTTP 127.0.0.1:29380 |
| Explorer | btc-rpc-explorer 3.5.1, 8ed77ab225f5507c521b570d5240624de597ad44 | HTTP 127.0.0.1:29303 |

Mempool's Electrum interface does not provide the verbose transaction RPC that
RGB-lib checks at unlock. Use the separate Electrs endpoint for RGB, or explicitly
select Esplora with `RGB_INDEXER_URL=http://127.0.0.1:29302`.

The latest explorer release has upstream dependency advisories, including critical
ones. It is a loopback-only disposable test tool, not production infrastructure.
All credentials in Compose are public test fixtures. Never expose these ports,
reuse these credentials, or deploy this Compose file on a public host. The dedicated `wdk-rln-017-qualification` project uses new versioned indexer
volumes; it does not reuse, migrate or remove earlier qualification volumes.
The RLN HTTP daemon intentionally has authentication disabled only in this local fixture.
Its internal LSP/APay requests use an explicit test-only bearer token.

## Setup

Requirements: Docker Compose, Git, Node 22+, and the exact built native candidate
for each runtime. Install the unpublished peer tarballs from the corresponding
draft branches with their normal install scripts enabled. Native packages build
from pinned source and require their documented Rust/platform prerequisites.
Do not share Node and Bare Cargo target caches.

```sh
npm ci
npm install --no-save --package-lock=false /absolute/path/to/native-candidate.tgz
npm run regtest:up
npm run test:regtest
BARE_BIN=/absolute/path/to/bare npm run test:regtest -- --bare
npm run test:regtest:lsp
BARE_BIN=/absolute/path/to/bare npm run test:regtest:lsp -- --bare
npm run test:regtest:assets
BARE_BIN=/absolute/path/to/bare npm run test:regtest:assets -- --bare
npm run test:regtest:reopen
```

Use Bare >=1.33.0 for the WDK dependency graph. Setup requires `ORG_READ_TOKEN`
with read access to the three private upstream BFA repos, passed only via a
BuildKit secret. The helper script is also a BuildKit secret mount, so
upstream Docker ignore rules cannot omit it and it is not copied into image layers. Setup builds the exact pinned daemon from a clean checkout. Without
`--onchain-only`, it also builds the pinned LSP. Rust Docker builds default to
two jobs (`CARGO_BUILD_JOBS` may select a positive integer); service image builds
run serially to keep memory use bounded on a development VM. For an on-chain-only
run, use `npm run regtest:up -- --onchain-only` and omit the LSP scenarios.
It does not patch their runtime behavior. The LSP scenario issues its own fixture
asset, updates only this Compose project's LSP asset allowlist, and leaves the
service running. Each wallet gets a new random seed and owner-only test directory.

The standard profile always uses the strict signer. A separately labelled
diagnostic can exercise downstream package paths while investigating an upstream
strict-signer blocker:

```sh
npm run test:regtest -- --diagnostic-permissive
npm run test:regtest:lsp -- --diagnostic-permissive
npm run test:regtest:lsp -- --ifa --diagnostic-permissive
```

This flag only affects newly created regtest fixtures. It is never a production
workaround, does not change package defaults, and is not mainnet qualification.

## Evidence and Failures

Each run prints its private evidence directory and writes `results.json`, including
runtime, policy, each completed step and the first failure. Subsequent scenario
steps are **not executed**, not passed. A failure makes the process exit nonzero;
shutdown is attempted for every wallet. Native logs and wallet state remain for
investigation. Never commit seeds, signer databases or raw wallet directories.

The direct scenario covers BTC, message signing, RGB blind/witness transfers,
per-batch failures, released issuance/inflation rejection, BTC/RGB channels,
invoices, keysend, HODL claim/cancel, process death/recovery, cooperative close,
force-close broadcast and same-process reopen. Force-close CSV sweep maturity,
revoked-state justice, full reorg/recovery matrices and device lifecycle testing
are separate qualifications, not implied by this scenario.

The LSP scenario covers real discovery/provisioning, inbound liquidity, native
address attestation, local invoice/proof verification, APay settlement/claim and
both bridge directions. RGB settlement is checked independently of a Lightning
payment result. Its default asset is NIA; `--ifa` selects IFA, matching the schema
in the integrator report. The strict asset scenario covers NIA/IFA/CFA/UDA receipt
and witness transfers. The minimal reopen scenario needs no funds or channels.
See `QUALIFICATION.md` for the actual results, evidence and remaining blockers.

Stop services without erasing evidence:

```sh
docker compose -f tests/regtest/compose.yaml --profile lsp stop
```

Do not prune volumes or reset wallet state to get a passing run. Cache cleanup
must leave source, evidence and the running stack intact.

## Adverse Recovery

Run serially on the same isolated stack. Add `--bare` and set `BARE_BIN` for each
Bare run. All tests default to strict signing; diagnostic policy is explicit.

```sh
node tests/regtest/recovery.mjs --scenario=interrupted
node tests/regtest/recovery.mjs --scenario=reorg
node tests/regtest/recovery.mjs --scenario=reorg --block-sync
node tests/regtest/recovery.mjs --scenario=rgb-reorg
node tests/regtest/recovery.mjs --scenario=cold-copy
node tests/regtest/storage-fault.mjs
node tests/regtest/recovery.mjs --scenario=hodl-crash --diagnostic-permissive
node tests/regtest/recovery.mjs --scenario=force-close
node tests/regtest/recovery.mjs --scenario=force-close --diagnostic-permissive
node tests/regtest/recovery.mjs --scenario=force-close --rgb
```

`storage-fault.mjs` needs macOS/hdiutil and mount permission. It fills only a
bounded 128-MiB private HFS+ image, independently checks ENOSPC, captures the
mutation outcome, restores capacity and cold-restarts without wallet reset.
It never fills the host disk and retains the detached evidence image.

`interrupted` kills the entire native process group at three dispatch-relative
times and reconciles chain/balance state without automatically retrying a send.
It polls the dispatch marker at 1 ms, records whether the response was persisted
before killing, and fails if every send finished before the kill. Ordinary
500-ms RPC polling cannot establish an actual interruption.
These are not instrumented database-commit boundaries. `reorg` pauses only this
Compose project's indexers to construct a longer competing fork excluding a
confirmed payment, then checks unconfirmation, cold restart and reconfirmation.
`cold-copy` preserves permissions while relocating the latest complete local
wallet plus signer after all writers stop; it is not VSS, migration, stale-backup
or seed-only channel recovery. `hodl-crash` recovers a claimable HTLC after both
processes die and verifies one terminal payment record.

`rgb-reorg` separately disconnects a settled one-confirmation NIA receipt, proves
the original transaction is now in Core's mempool, and checks native balance and
transfer status after sync/refresh/cold restart. The released runtime fails this
acceptance check: it retains settled/spendable units. This is not a BTC reorg
test pass, nor evidence of permanent loss or a conflicting-spend scenario.

`force-close` identifies the exact funding spend and delayed principal output,
restarts while timelocked, matures CSV, verifies its sweep and confirms a new send
that consumes that sweep. `--rgb` additionally requires all channel units to
recover and settle at a second wallet; those later steps are unexecuted if the
released commitment fails to broadcast. See the report: strict BTC sweeps and
RGB commitment signatures currently block acceptance. Do not call a diagnostic
BTC pass complete production recovery. Mobile commands are in
[the simulator/emulator fixture](../mobile/README.md).

## Approved Import Extension

`RGB_IMPORT_FIXTURE=/absolute/path/public-regtest-ifa.json npm run test:regtest:imports`
qualifies fresh-wallet metadata import, zero balances, malformed payload rejection,
named invoices, strict on-chain receipt/send, two-sided settlement and reimport.
Use `-- --bare` with `BARE_BIN` pointing to Bare >=1.33.0 for the Bare runtime.
The public fixture contains `network: "regtest"`, `schema: "Ifa"`, `precision: 6`,
`asset_id` and `contract_base64` exported with RGB-lib's contract serializer.
The existing local daemon must own at least 250000 units per run. The test checks
the chain before funding; it does not reset volumes or qualify real USDT networks.

## Pending RGB Balance

Run `REGTEST_HOST_ISSUER=1 node tests/regtest/pending-balance.mjs` against a
host issuer, or omit the variable for the Compose issuer. Add `--bare` and
`BARE_BIN` for Bare. Run serially with other chain tests. This compares WDK and
native balances for one unconfirmed witness receipt, retains the confirmed
comparison, and fails if the incoming amount is counted more than once.
It is an acceptance test, not an expected-failure pass. The six-decimal NIA
asset is a disposable fixture, not a public USDT deployment.

## BFA

See [BFA.md](./BFA.md) for the separate local Ethereum fixture, both native
external-unlock entrypoints, funded BFA transfers and the upstream event-order
regression. These tests do not require the RLN HTTP issuer or LSP container.
