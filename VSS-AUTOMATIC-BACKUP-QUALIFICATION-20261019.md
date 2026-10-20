# VSS automatic backup qualification — 2026-10-19

Automatic snapshot policy was introduced at WDK
`b7ec58e50540ac6d7a1a48461027a47591812376`. This follow-up admits the native
clock-correction repair and complete qualified source commits, including generated
platform runtime contracts and qualification records.

| Native peer | Qualified feature source commit (before merge) |
| --- | --- |
| Bare | `78831157b86aea63ef50bbe69f6eeb8c4c0df6fd` |
| Node | `a1fb8291d946685e2e668156ac520f0581302b96` |

The shared adapter is `6d46717b80ffba8ed8af2de023a536af242aadcacbbb799fb9bb89f8933e4ca5`.
The Bare wrapper remains `5dca0ca23c28cb8e9171646db0f1ef9f1d76744a764653a960076426126fea6d`
and its build recipe remains `9b8620de9ef63c9f4750a0b5766aac9ffaf9f005077f9a0a5d2a2824584e4bf5`.
The Node wrapper is `6e071236fea1cbb19afaeb205f794d68b830a635a0658246d8970e7063712d27`.
The qualified Node Darwin ARM64 Release addon is
`f7a1aed05d20459e82c1750411b3bfc5c4e37dbbd61161da3ae417ef0fcae45d`.

WDK checks cover default-on policy, saved-off startup, admitted-work draining,
catch-up, manual backup while off, indeterminate policy outcomes, strict receipt
scope and completion times, and 720 concurrent operation orderings. Native peer
qualification records distinguish artifact admission from funded runtime tests.
A successful backup uses the canonical manifest version, even when the SDK upload
returns a different per-object counter. Status reads never manufacture backup times.

Exact final package identities and the packed Node consumer result are retained
separately in `release-evidence/2026-10-19/vss-automatic-backup` in the shared
workspace. Earlier receipts retain their original source and archive identities.
Nothing in this pin refresh authorizes a merge or publication.

## Merged-main source admission — 20 October 2026

Bare #27 and Node #26 are merged. WDK now admits `main` with immutable commit
checks for Bare `c5425a3185677bcddfd5a46e278783eed431e2ab` and Node
`5ffe8f22b9b242a5be4b21765395b206136f5a06`.

Their complete trees equal the qualified feature heads in the table above:
Bare `81c78fd45c7d7530457b9442caedf86f49322c29` and Node
`6833c954772fa596da8b37563546b5c2cd1e8ec9`. The native source graph, compiled
input identities and payload bytes are unchanged; no native rebuild is claimed.
Fresh isolated merged-main checkouts are used for WDK's source-admission check.
It passes with **33 suites / 1,267 tests**, lint, types, WebRGB compatibility,
three fault-harness ownership cases and a zero-vulnerability production npm
audit. Local Jest uses `--watchman=false` because the host Watchman socket is
unavailable; test selection and assertions are unchanged. Release package checks
use the existing required npm 12.0.1 toolchain.
The pin refresh and package verification do not repeat or expand the earlier
funded, restore, mobile or platform runtime scopes.

Existing npm beta.4 peers are older immutable builds and still fail current
registry admission. Native versioning/publication and final WDK release gates
remain separate work; no merge or publication is part of this update.

## Node formatting follow-up

CI found a Rust formatting failure in the Node wrapper. The follow-up changes only
`src/lib.rs` formatting and qualification documentation; the shared native adapter,
Bare sources and all Bare artifacts are unchanged. Because wrapper source identity
is embedded in the native contract, Node Darwin was rebuilt normally and its new
provenance and compiled wrapper identity admitted. The fresh Node qualification
records default/off/manual/reopen/catch-up behavior, real receipt times, a funded
BTC receive/send/confirmation, unchanged syncing reads and failed-upload rollback.

WDK runtime JavaScript and declarations remain unchanged. The earlier exact package
receipts at WDK `558fdaec64420619aca505aa0c152677df5e3970` and Node
`f1156a623d0e6c39af20a398a191e3608f15da82`, including the prior Node binary and BFA
qualification, retain their original identities. The formatting follow-up has its
own source-gate, package and packed-consumer evidence; prior receipts are not
rewritten or treated as tests of the new compiled Node artifact.

## Clock-correction follow-up

A valid native completion receipt must remain readable when the device clock later
moves backward or forward. Native validation now uses a positive JavaScript Date
range bound and exact wallet/network/endpoint scope, independently of the present
wall clock. Newly recorded timestamps use the same bound. The actual completion
time is preserved; it is not replaced by the time of a metadata read.

WDK's strict receipt decoder already used that clock-independent bound. New tests
exercise Bare/Node binding and full/read-only account reads, saved On/Off policies,
post-rollback send checkpoint behavior and timestamp endpoints. Future-dated
receipts stay valid; presentation can omit their date without disabling controls or
invalidating the separate remote observation. Existing source/archive receipts
remain frozen at their original identities; the rebuilt native graph requires its
own source, artifact and packed-consumer qualification.
