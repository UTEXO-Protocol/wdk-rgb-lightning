# Releasing `@utexo/wdk-rgb-lightning`

Releases are built from a reviewed commit on `main`, staged through npm trusted
publishing, approved by a maintainer with 2FA, and finalized as an immutable
GitHub release.

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
3. Run the real Node native-binding smoke test and the Bare/iOS integration
   regression against the exact release candidate.
4. Open a release PR that changes only:
   - `package.json` and `package-lock.json` version fields
   - the matching `CHANGELOG.md` release section
5. Require the normal `build` check and an approving review before squash merge.

Do not release a version from a working branch, an unreviewed commit, or a
commit that is not the current `main` head.

## Stage the npm package

Create an annotated tag on the exact release commit and push it:

```bash
git fetch origin main
git tag -a v0.1.0-beta.15 origin/main -m "Release v0.1.0-beta.15"
git push origin v0.1.0-beta.15
```

The tag-triggered `Release` workflow:

1. Requires the tag to match `package.json` and point to the current `main`.
2. Runs lint, type checking, coverage, audit, package-content validation, and a
   clean Node/native-binding smoke test.
3. Rebuilds the npm tarball deterministically and records its integrity.
4. Stages that tarball through npm OIDC with the `latest` dist-tag.

The staging command is the final workflow write. No GitHub release is created
until the staged npm package is approved and publicly verifiable.

## Approve and finalize

Review the staged package on npm, including its files, version, tag, and
integrity. Approve it with 2FA.

After the package is public, run the `Release` workflow manually with the
existing tag. The finalization job verifies:

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
