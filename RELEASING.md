# Releasing `@utexo/wdk-rgb-lightning`

Releases are built from a reviewed commit on `main`, staged through npm trusted
publishing, approved by a maintainer with 2FA, and finalized as an immutable
GitHub release.

## 0.2.0-beta.4 source and publication gates

Bare #22 and Node #24 are merged. This WDK candidate adopts their exact main
commits in [native-peer-sources.json](./native-peer-sources.json); the published
optional peers remain exact npm versions `0.2.0-beta.4`. Do not substitute a
floating Git branch or an older npm peer for the reviewed runtime.

Source/package merge readiness requires the PR build and merged-main source
checks, lint/types/full unit coverage, production dependency audit, package
allowlist, and clean real Node/Bare packed-consumer checks. The source check is
nonpublishing and needs no private native build credentials. It rejects native
main drift so a new source change requires explicit pin review and qualification.

Publication additionally requires **both native npm versions to exist first**,
with the recorded main `gitHead`, RLN/LDK/overlay/lock metadata, complete admitted
native artifacts, and their release provenance/signatures. Run
`npm run check:peer-releases`; HTTP 404 or wrong provenance is a blocking result.
A merged GitHub PR and a candidate tarball do not satisfy that registry gate.
Native artifact workflows themselves do not publish packages.

This command validates native registry identity and graph metadata, not tarball
signatures or SLSA attestations. Those native artifact/release checks remain
separate prerequisites; WDK's final Node install does not exercise the Bare peer.

For prepublication qualification, the Node and Bare package canaries accept
`RLN_NODE_PACKAGE_TARBALL` and `RLN_BARE_PACKAGE_TARBALL`, respectively. These
exercise fresh consumer installations with real native code; they do not prove
npm registry provenance. Preserve original native artifact provenance when the
main merge changes only documentation. Do not relabel an earlier CI binary as a
new main build. A cache-assisted build is not a bit-for-bit hermetic rebuild.

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

## Release preparation

1. Freeze unrelated merges, including native or wallet changes not included in
   the release candidate.
2. Confirm compatible native packages are already published. Native package
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
git tag -a v0.2.0-beta.4 origin/main -m "Release v0.2.0-beta.4"
git push origin v0.2.0-beta.4
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

It then creates an immutable GitHub release, attaches the exact npm tarball,
and verifies the downloaded release asset byte-for-byte.

## Rollback

npm versions and immutable GitHub releases are never overwritten.

For a defective release:

1. Move `latest` back to the previous known-good version using a maintainer
   session with 2FA.
2. Deprecate the defective version with a precise warning.
3. Fix forward in the next prerelease version.
4. Record the incident and recovery in the next changelog entry.
