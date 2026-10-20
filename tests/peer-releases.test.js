import { verifyNativePeerReleases } from '../scripts/verify-peer-releases.mjs'

const bare = '@utexo/rgb-lightning-node-bare'
const node = '@utexo/rgb-lightning-node-nodejs'

// Release graph recorded after Bare lifecycle #22, distributions #24/#25 and
// Node #24; the four-package split preserves native graph and fingerprints.
// Deliberately independent of the verifier's expected-runtime object, so a
// changed admission requirement must also update this release fixture.
const nativeManifest = {
  repository: 'https://github.com/UTEXO-Protocol/rgb-lightning-node.git',
  ref: 'ecc69f20308231400561f6f060fea88acfa40cc4',
  commit: 'ecc69f20308231400561f6f060fea88acfa40cc4',
  rlnVersion: '0.17.0-beta.3',
  lightningCommit: '79b9eb5166546c62692d3a672986f385c7fe047d',
  patch: 'patches/release-adapter-v0.17.0-beta.3.patch',
  patchSha256: '7f89dc518f8fe69dc6baf62c4ee96e9d5a25d6b6ae70ab529c7b4bcc65979c90',
  cffiLockSha256: '5fcdc9ad9179d3230e48973cdfa514a863d13a837752027febf8ea04713bbeb5'
}
const mainCommits = {
  [bare]: '8b692da2e896e8acfef2bf15b1e501103100c070',
  [node]: '04b641dce121ac690d5d0866eeba4fa76aebe7a5'
}

// Keep the published beta.4 fixture historical when an unreleased feature
// candidate changes its own source pins. This exercises the same verifier with
// the release's actual expected inputs, without relabelling registry evidence.
const releasedSources = {
  schemaVersion: 1,
  sharedCffiLockSha256: nativeManifest.cffiLockSha256,
  peers: Object.fromEntries([bare, node].map(name => [name, {
    repository: `https://github.com/UTEXO-Protocol/${name.slice('@utexo/'.length)}.git`,
    ref: 'main',
    commit: mainCommits[name],
    version: '0.2.0-beta.5'
  }]))
}
const releasedRuntime = {
  abi_version: 1,
  rln_version: nativeManifest.rlnVersion,
  rln_commit: nativeManifest.commit,
  lightning_commit: nativeManifest.lightningCommit,
  adapter_sha256: nativeManifest.patchSha256
}
const verifyReleasedPeers = options => verifyNativePeerReleases({
  sources: releasedSources, expectedRuntime: releasedRuntime, ...options
})

function packageFixture () {
  return {
    peerDependencies: {
      '@utexo/webrgb': '^0.1.0',
      [bare]: '0.2.0-beta.5',
      [node]: '0.2.0-beta.5'
    },
    peerDependenciesMeta: {
      '@utexo/webrgb': { optional: true },
      [bare]: { optional: true },
      [node]: { optional: true }
    }
  }
}

function registryFixture (mutate = value => value) {
  const requested = []
  const fetchImpl = async url => {
    requested.push(url)
    const [name, version] = new URL(url).pathname.slice(1).split('/').map(decodeURIComponent)
    return {
      ok: true,
      json: async () => mutate({ name, version, gitHead: mainCommits[name], utexoNativeOverlay: { ...nativeManifest } })
    }
  }
  return { requested, fetchImpl }
}

describe('published native peer release admission', () => {
  it('accepts the merged immutable graph and checks both optional runtime peers', async () => {
    const registry = registryFixture()
    const packageJson = packageFixture()
    packageJson.peerDependencies['unrelated-peer'] = '*'
    packageJson.peerDependenciesMeta['unrelated-peer'] = { optional: true }

    const result = await verifyReleasedPeers({ packageJson, fetchImpl: registry.fetchImpl })

    expect(result).toEqual([
      { name: bare, range: '0.2.0-beta.5', minimum: '0.2.0-beta.5' },
      { name: node, range: '0.2.0-beta.5', minimum: '0.2.0-beta.5' }
    ])
    expect(registry.requested).toEqual([
      'https://registry.npmjs.org/%40utexo%2Frgb-lightning-node-bare/0.2.0-beta.5',
      'https://registry.npmjs.org/%40utexo%2Frgb-lightning-node-nodejs/0.2.0-beta.5'
    ])
  })

  it.each([bare, node])('does not waive unpublished optional native peer %s', async packageName => {
    const registry = registryFixture()
    const missingUrl = `/${encodeURIComponent(packageName)}/`
    const fetchImpl = url => url.includes(missingUrl)
      ? Promise.resolve({ ok: false, status: 404, statusText: 'Not Found' })
      : registry.fetchImpl(url)

    await expect(verifyReleasedPeers({ packageJson: packageFixture(), fetchImpl }))
      .rejects.toThrow(`${packageName}@0.2.0-beta.5 is unavailable (404 Not Found)`)
  })

  it('reports registry service failures without accepting an incomplete release', async () => {
    await expect(verifyReleasedPeers({
      packageJson: packageFixture(),
      fetchImpl: async () => ({ ok: false, status: 503, statusText: 'Service Unavailable' })
    })).rejects.toThrow('503 Service Unavailable')
  })

  it.each([
    ['missing', undefined],
    ['floating branch', 'github:UTEXO-Protocol/rgb-lightning-node-nodejs#main'],
    ['range', '^0.2.0-beta.5'],
    ['floor', '>=0.2.0-beta.5 <0.3.0']
  ])('rejects a %s native peer declaration before making registry requests', async (_, version) => {
    const packageJson = packageFixture()
    packageJson.peerDependencies[node] = version
    const registry = registryFixture()

    await expect(verifyReleasedPeers({ packageJson, fetchImpl: registry.fetchImpl }))
      .rejects.toThrow(`Native peer ${node} must declare one exact version`)
    expect(registry.requested).toEqual([])
  })

  it.each([
    ['name', '@utexo/unrelated-package'],
    ['version', '0.2.0-beta.3']
  ])('rejects registry identity mismatch in %s', async (field, value) => {
    const registry = registryFixture(metadata => ({ ...metadata, [field]: value }))
    await expect(verifyReleasedPeers({ packageJson: packageFixture(), fetchImpl: registry.fetchImpl }))
      .rejects.toThrow('Registry returned the wrong identity')
  })

  it.each([
    ['repository', 'https://github.com/unrelated/rgb-lightning-node.git'],
    ['ref', 'v0.17.0-beta.3'],
    ['ref', 'main'],
    ['commit', '0'.repeat(40)],
    ['rlnVersion', '0.16.0-beta.1'],
    ['lightningCommit', '0'.repeat(40)],
    ['patch', '../untrusted.patch'],
    ['patchSha256', '0'.repeat(64)],
    ['cffiLockSha256', '0'.repeat(64)]
  ])('rejects a mismatched native %s even at the right npm version', async (field, value) => {
    const registry = registryFixture(metadata => ({
      ...metadata,
      utexoNativeOverlay: { ...metadata.utexoNativeOverlay, [field]: value }
    }))
    await expect(verifyReleasedPeers({ packageJson: packageFixture(), fetchImpl: registry.fetchImpl }))
      .rejects.toThrow('Registry native release manifest mismatch')
  })

  it.each(Object.keys(nativeManifest))('rejects missing native provenance field %s', async field => {
    const registry = registryFixture(metadata => {
      delete metadata.utexoNativeOverlay[field]
      return metadata
    })
    await expect(verifyReleasedPeers({ packageJson: packageFixture(), fetchImpl: registry.fetchImpl }))
      .rejects.toThrow('Registry native release manifest mismatch')
  })

  it.each([undefined, null, {}])('rejects absent or incomplete native provenance %p', async manifest => {
    const registry = registryFixture(metadata => ({ ...metadata, utexoNativeOverlay: manifest }))
    await expect(verifyReleasedPeers({ packageJson: packageFixture(), fetchImpl: registry.fetchImpl }))
      .rejects.toThrow('Registry native release manifest mismatch')
  })

  it.each([undefined, '0'.repeat(40)])('rejects missing or unexpected registry gitHead %p', async gitHead => {
    const registry = registryFixture(metadata => ({ ...metadata, gitHead }))
    await expect(verifyReleasedPeers({ packageJson: packageFixture(), fetchImpl: registry.fetchImpl }))
      .rejects.toThrow(`Registry gitHead mismatch for ${bare}`)
  })

  it('checks the second native package instead of accepting the first one alone', async () => {
    const registry = registryFixture(metadata => metadata.name === node
      ? { ...metadata, utexoNativeOverlay: { ...nativeManifest, commit: '0'.repeat(40) } }
      : metadata)
    await expect(verifyReleasedPeers({ packageJson: packageFixture(), fetchImpl: registry.fetchImpl }))
      .rejects.toThrow(`Registry native release manifest mismatch for ${node}`)
    expect(registry.requested).toHaveLength(2)
  })
})
