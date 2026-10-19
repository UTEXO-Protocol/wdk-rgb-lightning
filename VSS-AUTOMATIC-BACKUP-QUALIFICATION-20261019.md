# VSS automatic backup qualification — 2026-10-19

Automatic snapshot policy was introduced at WDK
`b7ec58e50540ac6d7a1a48461027a47591812376`. This follow-up admits the native
clock-correction repair and complete qualified source commits, including generated
platform runtime contracts and qualification records.

| Native peer | Complete source commit |
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
