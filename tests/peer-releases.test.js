import { verifyNativePeerReleases } from '../scripts/verify-peer-releases.mjs'

const bare = '@utexo/rgb-lightning-node-bare'
const node = '@utexo/rgb-lightning-node-nodejs'

// Synthetic registry metadata for an unpublished candidate. No network calls
// or actual publication identities are used; fields stay independent of the
// verifier's runtime object so each admission comparison is exercised.
const nativeManifest = {
  repository: 'https://github.com/UTEXO-Protocol/rgb-lightning-node.git',
  ref: '3'.repeat(40),
  commit: '3'.repeat(40),
  rlnVersion: '0.17.0-beta.3',
  lightningCommit: '4'.repeat(40),
  rgbLibRepository: 'https://github.com/UTEXO-Protocol/rgb-lib-bfa.git',
  rgbLibCommit: '5'.repeat(40),
  patch: 'patches/release-adapter-v0.17.0-beta.3.patch',
  patchSha256: '6'.repeat(64),
  cffiLockSha256: '7'.repeat(64)
}
const fixtureCommits = {
  [bare]: '1'.repeat(40),
  [node]: '2'.repeat(40)
}

// A mocked registry response is a policy test, never release evidence.
const fixtureSources = {
  schemaVersion: 1,
  sharedCffiLockSha256: nativeManifest.cffiLockSha256,
  peers: Object.fromEntries([bare, node].map(name => [name, {
    repository: `https://github.com/UTEXO-Protocol/${name.slice('@utexo/'.length)}.git`,
    ref: 'main',
    commit: fixtureCommits[name],
    version: '0.2.0-bfa.0'
  }]))
}
const fixtureRuntime = {
  abi_version: 1,
  rln_version: nativeManifest.rlnVersion,
  rln_commit: nativeManifest.commit,
  lightning_commit: nativeManifest.lightningCommit,
  rgb_lib_commit: nativeManifest.rgbLibCommit,
  adapter_sha256: nativeManifest.patchSha256
}
const verifyFixturePeers = options => verifyNativePeerReleases({
  sources: fixtureSources, expectedRuntime: fixtureRuntime, ...options
})

function packageFixture () {
  return {
    peerDependencies: {
      '@utexo/webrgb': '^0.1.0',
      [bare]: '0.2.0-bfa.0',
      [node]: '0.2.0-bfa.0'
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
      json: async () => mutate({ name, version, gitHead: fixtureCommits[name], utexoNativeOverlay: { ...nativeManifest } })
    }
  }
  return { requested, fetchImpl }
}

describe('native registry peer admission with synthetic unpublished candidate metadata', () => {
  it('checks the exact graph and both optional runtime peers', async () => {
    const registry = registryFixture()
    const packageJson = packageFixture()
    packageJson.peerDependencies['unrelated-peer'] = '*'
    packageJson.peerDependenciesMeta['unrelated-peer'] = { optional: true }

    const result = await verifyFixturePeers({ packageJson, fetchImpl: registry.fetchImpl })

    expect(result).toEqual([
      { name: bare, range: '0.2.0-bfa.0', minimum: '0.2.0-bfa.0' },
      { name: node, range: '0.2.0-bfa.0', minimum: '0.2.0-bfa.0' }
    ])
    expect(registry.requested).toEqual([
      'https://registry.npmjs.org/%40utexo%2Frgb-lightning-node-bare/0.2.0-bfa.0',
      'https://registry.npmjs.org/%40utexo%2Frgb-lightning-node-nodejs/0.2.0-bfa.0'
    ])
  })

  it.each([bare, node])('does not waive unpublished optional native peer %s', async packageName => {
    const registry = registryFixture()
    const missingUrl = `/${encodeURIComponent(packageName)}/`
    const fetchImpl = url => url.includes(missingUrl)
      ? Promise.resolve({ ok: false, status: 404, statusText: 'Not Found' })
      : registry.fetchImpl(url)

    await expect(verifyFixturePeers({ packageJson: packageFixture(), fetchImpl }))
      .rejects.toThrow(`${packageName}@0.2.0-bfa.0 is unavailable (404 Not Found)`)
  })

  it('reports registry service failures without accepting an incomplete release', async () => {
    await expect(verifyFixturePeers({
      packageJson: packageFixture(),
      fetchImpl: async () => ({ ok: false, status: 503, statusText: 'Service Unavailable' })
    })).rejects.toThrow('503 Service Unavailable')
  })

  it.each([
    ['missing', undefined],
    ['floating branch', 'github:UTEXO-Protocol/rgb-lightning-node-nodejs#main'],
    ['range', '^0.2.0-bfa.0'],
    ['floor', '>=0.2.0-bfa.0 <0.3.0']
  ])('rejects a %s native peer declaration before making registry requests', async (_, version) => {
    const packageJson = packageFixture()
    packageJson.peerDependencies[node] = version
    const registry = registryFixture()

    await expect(verifyFixturePeers({ packageJson, fetchImpl: registry.fetchImpl }))
      .rejects.toThrow(`Native peer ${node} must declare one exact version`)
    expect(registry.requested).toEqual([])
  })

  it.each([
    ['name', '@utexo/unrelated-package'],
    ['version', '0.2.0-beta.3']
  ])('rejects registry identity mismatch in %s', async (field, value) => {
    const registry = registryFixture(metadata => ({ ...metadata, [field]: value }))
    await expect(verifyFixturePeers({ packageJson: packageFixture(), fetchImpl: registry.fetchImpl }))
      .rejects.toThrow('Registry returned the wrong identity')
  })

  it.each([
    ['repository', 'https://github.com/unrelated/rgb-lightning-node.git'],
    ['ref', 'v0.17.0-beta.3'],
    ['ref', 'main'],
    ['commit', '0'.repeat(40)],
    ['rlnVersion', '0.16.0-beta.1'],
    ['lightningCommit', '0'.repeat(40)],
    ['rgbLibRepository', 'https://github.com/UTEXO-Protocol/rgb-lib.git'],
    ['rgbLibCommit', '0'.repeat(40)],
    ['patch', '../untrusted.patch'],
    ['patchSha256', '0'.repeat(64)],
    ['cffiLockSha256', '0'.repeat(64)]
  ])('rejects a mismatched native %s even at the right npm version', async (field, value) => {
    const registry = registryFixture(metadata => ({
      ...metadata,
      utexoNativeOverlay: { ...metadata.utexoNativeOverlay, [field]: value }
    }))
    await expect(verifyFixturePeers({ packageJson: packageFixture(), fetchImpl: registry.fetchImpl }))
      .rejects.toThrow('Registry native release manifest mismatch')
  })

  it.each(Object.keys(nativeManifest))('rejects missing native provenance field %s', async field => {
    const registry = registryFixture(metadata => {
      delete metadata.utexoNativeOverlay[field]
      return metadata
    })
    await expect(verifyFixturePeers({ packageJson: packageFixture(), fetchImpl: registry.fetchImpl }))
      .rejects.toThrow('Registry native release manifest mismatch')
  })

  it.each([undefined, null, {}])('rejects absent or incomplete native provenance %p', async manifest => {
    const registry = registryFixture(metadata => ({ ...metadata, utexoNativeOverlay: manifest }))
    await expect(verifyFixturePeers({ packageJson: packageFixture(), fetchImpl: registry.fetchImpl }))
      .rejects.toThrow('Registry native release manifest mismatch')
  })

  it.each([undefined, '0'.repeat(40)])('rejects missing or unexpected registry gitHead %p', async gitHead => {
    const registry = registryFixture(metadata => ({ ...metadata, gitHead }))
    await expect(verifyFixturePeers({ packageJson: packageFixture(), fetchImpl: registry.fetchImpl }))
      .rejects.toThrow(`Registry gitHead mismatch for ${bare}`)
  })

  it('checks the second native package instead of accepting the first one alone', async () => {
    const registry = registryFixture(metadata => metadata.name === node
      ? { ...metadata, utexoNativeOverlay: { ...nativeManifest, commit: '0'.repeat(40) } }
      : metadata)
    await expect(verifyFixturePeers({ packageJson: packageFixture(), fetchImpl: registry.fetchImpl }))
      .rejects.toThrow(`Registry native release manifest mismatch for ${node}`)
    expect(registry.requested).toHaveLength(2)
  })
})
