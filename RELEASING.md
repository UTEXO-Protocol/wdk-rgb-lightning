# Releasing `@utexo/wdk-rgb-lightning`

Releases are built from a reviewed commit on `main`, staged through npm trusted
publishing, approved by a maintainer with 2FA, and finalized as an immutable
GitHub release.

## 0.2.0-beta.5 release preparation — 20 October 2026

The release target is WDK **0.2.0-beta.5**, with exact Bare and Node
**0.2.0-beta.5** peers. Bare's iOS, Android ARMv7/ARM64 and Android x64 data
companions must also be **0.2.0-beta.5**. Existing native beta.4 packages are
immutable older code and cannot satisfy the BIP-322/enabled-VSS contract.

The native release PRs are [Bare #28](https://github.com/UTEXO-Protocol/rgb-lightning-node-bare/pull/28)
and [Node #27](https://github.com/UTEXO-Protocol/rgb-lightning-node-nodejs/pull/27).
They retain the qualified RLN/rgb-lib/LDK, adapter,
wrapper and build-recipe inputs and previously admitted binary bytes. They change
package identities and release documentation; compilation provenance retains
its original labels. Bare's new iOS archive is admitted separately from the
frozen published beta.4 archive, with an exact reviewed checksum and no increase
to the previous iOS size ceiling.

Release order:

1. Cancel the obsolete WDK beta.4 npm stage. Do not approve/finalize it. Retain
   its existing tag and historical source/artifact identity.
2. Review and merge the Bare and Node beta.5 release PRs. Refresh WDK's
   `native-peer-sources.json` to the resulting exact main commits; require its
   normal merged-main source check to pass before merging WDK.
3. Publish and independently verify the three Bare beta.5 data packages, then
   the Bare wrapper; publish/admit Node beta.5 as well. Use the reviewed native
   publication procedure and preserve exact package-source, artifact and builder
   provenance. Native candidate build workflows do not publish packages.
4. Require `npm run check:peer-releases` and both real packed-consumer checks
   against the published beta.5 graph. HTTP 404, stale source or mismatched
   native identities remain blocking results.
5. Merge the reviewed WDK PR and create the fresh `v0.2.0-beta.5` tag on the
   exact current main commit. Follow the staging/2FA/finalization procedure below.

The complete curated WDK notes are the single dated beta.5 entry in
`CHANGELOG.md`. The release workflow reads that entry directly; no separate
release-notes file is needed. Preparation does not merge, tag, stage or publish
any package and does not add funded mobile or device-loss recovery acceptance.

## Historical 0.2.0-beta.4 source and publication gates

Bare lifecycle #22, distributions #24/#25 and Node #24 are merged.
The final Bare wrapper/Android package source is
`8b692da2e896e8acfef2bf15b1e501103100c070`; Node remains
`04b641dce121ac690d5d0866eeba4fa76aebe7a5`. The manifest and independent release
fixture record these exact main sources. Both Bare #25 contract CI jobs pass in
[run 38768896810](https://github.com/UTEXO-Protocol/rgb-lightning-node-bare/actions/runs/38768896810).
The two optional WDK peers remain exact npm `0.2.0-beta.4`; floating branches or
older native packages cannot substitute for the reviewed runtime.

Bare's wrapper contains Darwin only and requires three exact-version data
companions: `@utexo/rgb-lightning-node-bare-ios`,
`@utexo/rgb-lightning-node-bare-android-arm` (ARMv7 and ARM64), and
`@utexo/rgb-lightning-node-bare-android-x64`. They are required Bare dependencies,
not additional WDK peers, and have no hooks, executable entry points, transitive
dependencies or host filters. Complete validation precedes copying all six mobile
files; assembly restores and verifies all seven canonical prebuild paths.
All seven original native bytes and 13 compiled/build inputs remain unchanged.
New wrapper/Android archives are bounded to 128 MiB by a conservative distribution
policy. The existing iOS archive is immutable at 146,197,231 bytes and its full
SRI below; do not republish it. Package source, real publication builder and
original native build provenance are separate identities.

The final assembly publisher is `7a306a12d7063260b55673cc201b7d007e47098f` on
`ci/publish-native-beta4-payloads-20261015`; its reviewed workflow SHA256 is
`45a9d6e9ad1463ceaeee78aa0fdd9142f47e466d961ed4792d9746bee7b2e900`. Verify-only
[run 38771729970](https://github.com/UTEXO-Protocol/rgb-lightning-node-bare/actions/runs/38771729970)
succeeds and independent inspection admits the actual four archives. This proves
assembly, not registry publication. Android data publication in
[run 38773164227](https://github.com/UTEXO-Protocol/rgb-lightning-node-bare/actions/runs/38773164227)
has independently verified public metadata, exact bytes, source, PURL/digest,
publication workflow and npm signature/SLSA checks. The run's bounded registry
visibility wait timed out after both uploads succeeded; subsequent public
verification passed without republishing. All three required data packages pass
the fresh cryptographic audit. Wrapper-only
[run 38775712257](https://github.com/UTEXO-Protocol/rgb-lightning-node-bare/actions/runs/38775712257)
succeeds. Its public source, exact 49,385,350-byte archive, PURL/digest and audited
publisher mapping are independently verified, with integrity
`sha512-0+qm8qbFPfd3t3bDJDm4hXSCqa+4EwZ04wCN2QqeA1nEQZcGjvWWN311HD3aab9iMe0iid2Bs8oDwanm35Ygtg==`.
All seven original Bare target hashes are assigned exactly once across the four
public packages. All five native/data packages expose beta `0.2.0-beta.4`;
the existing wrapper latest tags are preserved (Bare `0.1.0-beta.20`, Node
`0.1.0-beta.16`). Fresh fully public Bare consumers pass normal installation,
`--omit=optional`, and ignored-scripts plus manual `--platform all` recovery with
an empty PATH. Node 24.18.0/npm 12.0.1/Bare 1.33.0 verifies all seven original
hashes, real host signer reopen/lifetime/cleanup and signatures/SLSA for all four
Bare packages (36 attestation entries across each complete consumer graph).
These host package checks do not claim new iOS or Android execution.

Native publication facts and final WDK qualification protocol:

| Artifact or gate | Status |
|---|---|
| Node `0.2.0-beta.4` | Published from main `04b641d...`, run [38752777916](https://github.com/UTEXO-Protocol/rgb-lightning-node-nodejs/actions/runs/38752777916). Exact registry bytes/source/publication provenance verified. Frozen WDK `6758e4d` registry consumers pass Node 22.23.1 and 24.18.0 with npm 12.0.1: 93 registry signatures and 68 attestations verified in each. |
| Bare iOS data companion `0.2.0-beta.4` | Published and independently verified from source `15b0ff68d1b59fa88131cfb9be6fe48c30287e6b`, [run 38762929465](https://github.com/UTEXO-Protocol/rgb-lightning-node-bare/actions/runs/38762929465). Exact bytes/source/PURL/digest/publisher mapping and cryptographic audit pass. Integrity: `sha512-BOfizU4fqvGyl4L2Q0YAikLEYGyOBDYQikYPPR7IgxnmKrddm3T1/Lv0YnQeYt1EsBOf2SGyLNJKOLaWOglrkg==`. |
| Bare Android ARM and x64 data companions `0.2.0-beta.4` | Published from source `8b692da2e896e8acfef2bf15b1e501103100c070` in [run 38773164227](https://github.com/UTEXO-Protocol/rgb-lightning-node-bare/actions/runs/38773164227), attempt 1. Public exact bytes/source/PURL/digest/publisher mapping and npm cryptographic checks pass for both. Archive sizes: ARM 108,045,074 bytes; x64 58,903,340 bytes. |
| Bare wrapper `0.2.0-beta.4` | Public from `8b692da2e896e8acfef2bf15b1e501103100c070`, successful [run 38775712257](https://github.com/UTEXO-Protocol/rgb-lightning-node-bare/actions/runs/38775712257), attempt 1. Independent byte/source/PURL/digest/publisher checks and fresh fully public Bare consumer/cryptographic checks pass. |
| Final WDK archive and registry-native consumers | Freeze the reviewed WDK commit first, then record that exact HEAD/archive integrity, repeated-pack determinism and same-archive Node/Bare registry-consumer receipts on [PR #45](https://github.com/UTEXO-Protocol/wdk-rgb-lightning/pull/45) and in external release evidence. Earlier `6758e4d` results retain their identity. |

WDK publication follows the separate reviewed release process below. Native
publication does not establish production approval; the native issues listed
below remain open.

Source/package merge readiness requires the PR build and merged-main source
checks, lint/types/full unit coverage, production dependency audit, package
allowlist, and clean real Node/Bare packed-consumer checks. The source check is
nonpublishing and needs no private native build credentials. It rejects native
main drift so a new source change requires explicit pin review and qualification.

Publication additionally requires **both native npm peers and all three required
Bare data companions to exist first**, each with its approved package source
`gitHead` (the existing iOS source remains `15b0ff68...`), matching
RLN/LDK/overlay/lock metadata, complete admitted native artifacts and separate
release provenance/signature verification. Run
`npm run check:peer-releases`; HTTP 404 or wrong source/native-graph metadata is
a blocking result.
A merged GitHub PR and a candidate tarball do not satisfy that registry gate.
Native artifact build workflows do not publish. A separately reviewed assembly
publisher can publish the already admitted artifacts with their original build
identity preserved.

This command validates native registry identity and graph metadata, not tarball
signatures or SLSA attestations. Those native artifact/release checks remain
separate prerequisites; WDK's final Node install does not exercise the Bare peer
or its data companions. Preserve successful `npm audit signatures` results from
fresh registry consumers for Node and Bare, including all three required data
packages. `check:peer-releases` validates the two WDK native peers; it does not
replace independent companion metadata, archive and provenance checks.

For prepublication qualification, the Node and Bare package canaries accept
`RLN_NODE_PACKAGE_TARBALL` and `RLN_BARE_PACKAGE_TARBALL`, respectively. These
exercise fresh consumer installations with real native code; they do not prove
npm registry provenance. Preserve original native artifact provenance when the
main merge changes only documentation or byte-preserving distribution assembly.
The package's registry `gitHead` identifies its merged main package source;
SLSA provenance identifies the real publication workflow commit/ref/run. These
can differ and must each be verified against the reviewed expectation. Do not
relabel an earlier CI binary as a new main build. A cache-assisted build is not
a bit-for-bit hermetic rebuild.
The canaries authorize the exact native registry version or local tarball source
under npm 12, require its postinstall admission, reject script-policy bypasses,
and fail if any dependency install script remains unreviewed.

With the final local WDK tarball in `WDK_TGZ`, repeat the nonpublishing registry
checks after removing inherited `RLN_*` source/artifact/JS-only overrides:

```sh
npm run check:peer-releases
npm run smoke:package:node -- "$WDK_TGZ" --verify-signatures
npm run smoke:package:bare -- "$WDK_TGZ"
```

The Bare canary has no signature-verification flag; audit signatures separately
in a fresh registry Bare consumer that includes all three required data packages. Verify
native registry tarball integrities and exact source/publication provenance as
separate checks. These commands do not stage or publish WDK.

The unresolved native financial/security cases in
[PRODUCTION-GATES.md](./PRODUCTION-GATES.md), including P02/P03/P04/P06 and D01,
remain production blockers. They are distinct from app signing/mobile/public-
endpoint deployment gates and must not be reclassified as Iris-only limitations.
No wallet migration is required for the unshipped Iris app, and that exclusion
is not evidence of general production-wallet migration support.

Preparing this PR does not authorize a merge, tag, npm stage/publish, promotion,
or GitHub release. The existing OIDC/staged/2FA release path below remains in
force; no registry, provenance or native artifact gate is bypassed.

Package rollback below concerns npm distribution only. Never restore stale
wallet or channel state after activity; protocol state requires a separately
qualified operator recovery procedure.

## One-time configuration

### npm

Configure the package's trusted publisher with:

- Provider: GitHub Actions
- Organization: `UTEXO-Protocol`
- Repository: `wdk-rgb-lightning`
- Workflow: `release.yml`
- Environment: `npm`
- Allowed action: staged publish only

After the staged flow has been validated, set package publishing access to
require 2FA and disallow tokens. Remove the repository's legacy `NPM_TOKEN`
secret.

### GitHub

Create an `npm` environment with required reviewers and prevent self-review.
Protect release tags matching `v*` so only release maintainers can create them.
Enable immutable releases for the repository.

The immutability-settings API requires repository **Administration: read**,
which the workflow's `GITHUB_TOKEN` cannot grant. Store a short-lived,
fine-grained GitHub token scoped to this repository with only that permission
in the protected `npm` environment as `RELEASE_IMMUTABILITY_READ_TOKEN`. An
appropriately scoped GitHub App installation token is also supported; ensure it
is valid when finalization runs. Do not paste the credential into issues or
release logs. See the [endpoint permissions](https://docs.github.com/en/rest/repos/repos?apiVersion=2026-03-10#check-if-immutable-releases-are-enabled-for-a-repository).

Finalization uses that credential only to read and assert the current policy.
Release creation still uses `GITHUB_TOKEN` with `contents: write`; npm staging
still uses OIDC and maintainer 2FA. Missing or unauthorized policy credentials
stop finalization. Keep immutability enabled throughout finalization.

## Release preparation

1. Freeze unrelated merges, including native or wallet changes not included in
   the release candidate.
2. Confirm compatible native packages, including all three required exact-version
   Bare data companions, are already published and cryptographically verified. Native package
   versions are independent from the RGB Lightning SDK version.
3. Run both clean real Node/Bare packed-consumer canaries against the recorded
   main native packages. Qualify supported mobile/runtime/network scopes
   separately; host loading does not establish device or financial behavior.
4. Review the version, lockfile, changelog, exact native source pins and complete
   release diff. After feature adoption, later version-only release PRs should
   change only the version/lock/changelog.
5. Require the normal `build` and `Verify merged native main sources` checks and
   an approving review before merge.

Do not release a version from a working branch, an unreviewed commit, or a
commit that is not the current `main` head.

## Stage the npm package

Create an annotated tag on the exact release commit and push it:

```bash
git fetch origin main
git tag -a v0.2.0-beta.5 origin/main -m "Release v0.2.0-beta.5"
git push origin v0.2.0-beta.5
```

The tag-triggered `Release` workflow:

1. Requires the tag to match `package.json` and point to the current `main`.
2. Runs lint, type checking, WebRGB compatibility, coverage, production dependency
   audit, exact native registry admission, package-content validation and a
   clean Node/native-binding smoke test.
3. Rebuilds the npm tarball deterministically and records its integrity.
4. Stages that tarball through npm OIDC with the `latest` dist-tag.

The staging command is the final workflow write. No GitHub release is created
until the staged npm package is approved and publicly verifiable.

Both release jobs pack with `--require-git-head`: a clean tagged Git checkout is
required, and its commit is written only into the staged package manifest.
The tracked source is unchanged. This preserves the immutable tarball's source
identity when npm stages a tarball instead of preparing a source directory.
Release packaging and its tests require npm 12 or newer (CI pins `12.0.1`). The
helper rejects older npm before packing because older pacote versions can run
`prepare` despite `--ignore-scripts`.

## Approve and finalize

Review the staged package on npm, including its files, version, tag, and
integrity. Approve it with 2FA.

After the package is public, run the `Release` workflow manually with the
existing tag. The finalization job verifies:

- exact native peer publication/source metadata again
- npm integrity against a fresh local pack
- npm `gitHead` against the tagged commit
- SLSA provenance and the attestation endpoint
- the `latest` dist-tag
- a clean registry install, native Node load, and npm signatures
- repository-level immutable releases

Before creating the GitHub release, finalization requires exactly one dated
`## [<package version>]` entry in `CHANGELOG.md`, with nonempty release notes.
It uses that complete entry as the curated release summary, preceded by the npm
package/version, exact install command, native peer versions and integrity.
GitHub's generated changes are appended to that summary. No separate release-notes
file needs to be maintained; missing, duplicate, undated or empty version entries
stop creation rather than publishing metadata-only notes.

The job then creates an immutable GitHub release, attaches the exact npm tarball,
and verifies the downloaded release asset byte-for-byte. An existing release
keeps its original notes and goes through the existing immutable-artifact checks.

## Rollback

npm versions and immutable GitHub releases are never overwritten.

For a defective release:

1. Move `latest` back to the previous known-good version using a maintainer
   session with 2FA.
2. Deprecate the defective version with a precise warning.
3. Fix forward in the next prerelease version.
4. Record the incident and recovery in the next changelog entry.
