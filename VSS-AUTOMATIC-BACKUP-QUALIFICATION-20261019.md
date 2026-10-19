# VSS automatic backup qualification — 2026-10-19

This source-pin follow-up preserves the runtime implementation qualified at WDK
`b7ec58e50540ac6d7a1a48461027a47591812376`. It selects the complete native source
commits, including generated platform runtime contracts and qualification records.

| Native peer | Complete source commit |
| --- | --- |
| Bare | `62fde5d753f9454599633044d75304981b63ad29` |
| Node | `f1156a623d0e6c39af20a398a191e3608f15da82` |

The shared adapter remains `dd26955a9a8fdb466a83043dd72f2ace3c0fdededf6bdd1e437e8ffd82840556`.
The Bare wrapper remains `5dca0ca23c28cb8e9171646db0f1ef9f1d76744a764653a960076426126fea6d`
and its build recipe remains `9b8620de9ef63c9f4750a0b5766aac9ffaf9f005077f9a0a5d2a2824584e4bf5`.
The Node Darwin ARM64 Release addon remains
`f135c1b7d2f4e98d570b4f4bcc08adb57f454757c8de965f30873761f6200ff0`.

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
