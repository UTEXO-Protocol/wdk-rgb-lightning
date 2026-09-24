# Local Released-Runtime Qualification

Disposable regtest only. No mainnet/Signet funds, existing wallets, VSS, virtual
channels, or unreleased upstream behavior patches are used. These tests exercise
the real WDK and native packages, not the Jest mocks. Run scenarios serially:
they share a chain, service volumes and fixed loopback ports.

## Pinned Stack

Versions selected on 2026-09-24. This is a reproducible local stack, not a claim
that a remotely deployed LSP runs the same commit.

| Service | Source/version | Local endpoint |
| --- | --- | --- |
| Bitcoin Core | 31.1, official archive checksums in Dockerfile | RPC 127.0.0.1:29443 |
| RGB Electrum | romanz/electrs 0.12.0, 37501cc4b94aea99e50670a6524fa3ad4ac9aabb | TCP 127.0.0.1:29401 |
| Esplora | mempool/electrs 3.3.0, image digest pinned | HTTP 127.0.0.1:29302 |
| RGB proxy | 0.3.0, image digest pinned | HTTP 127.0.0.1:29300 |
| RLN | 0.13.0-beta.3, af03c7f1a65135a429f05a5820600338215954dc | HTTP 127.0.0.1:29301 |
| LSP | main b865c8868e202ba90055d4924382eada62c52cd6; no release tag | HTTP 127.0.0.1:29380 |
| Explorer | btc-rpc-explorer 3.5.1, 8ed77ab225f5507c521b570d5240624de597ad44 | HTTP 127.0.0.1:29303 |

Mempool's Electrum interface does not provide the verbose transaction RPC that
RGB-lib checks at unlock. Use the separate Electrs endpoint for RGB, or explicitly
select Esplora with `RGB_INDEXER_URL=http://127.0.0.1:29302`.

The latest explorer release has upstream dependency advisories, including critical
ones. It is a loopback-only disposable test tool, not production infrastructure.
All credentials in Compose are public test fixtures. Never expose these ports,
reuse these credentials, or deploy this Compose file on a public host. The RLN
HTTP daemon intentionally has authentication disabled only in this local fixture.
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

Use Bare >=1.32.0 for the WDK dependency graph. Setup builds the released daemon
and pinned LSP from clean checkouts when public container images are unavailable.
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

`force-close` identifies the exact funding spend and delayed principal output,
restarts while timelocked, matures CSV, verifies its sweep and confirms a new send
that consumes that sweep. `--rgb` additionally requires all channel units to
recover and settle at a second wallet; those later steps are unexecuted if the
released commitment fails to broadcast. See the report: strict BTC sweeps and
RGB commitment signatures currently block acceptance. Do not call a diagnostic
BTC pass complete production recovery. Mobile commands are in
[the simulator/emulator fixture](../mobile/README.md).
