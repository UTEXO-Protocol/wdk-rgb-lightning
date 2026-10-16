import { REQUIRED_NATIVE_RUNTIME } from '../src/native-runtime-contract.js'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  NATIVE_PEER_NAMES,
  readNativePeerSources,
  validateNativePeerPackage,
  validateNativePeerSources
} from './verify-native-peer-sources.mjs'

export async function verifyNativePeerReleases ({
  packageJson,
  fetchImpl = globalThis.fetch,
  expectedRuntime = REQUIRED_NATIVE_RUNTIME,
  sources = readNativePeerSources()
}) {
  // Both runtimes are release prerequisites even though a consumer installs only
  // its optional runtime peer. Unrelated peers have no native overlay manifest.
  validateNativePeerSources(sources, packageJson)
  const peers = NATIVE_PEER_NAMES.map(packageName => ({ packageName, version: sources.peers[packageName].version }))

  const verifiedPeers = []
  for (const { packageName, version } of peers) {
    const url =
      `https://registry.npmjs.org/${encodeURIComponent(packageName)}/` +
      encodeURIComponent(version)
    const response = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(30_000)
    })

    if (!response.ok) {
      throw new Error(
        `${packageName}@${version} is unavailable ` +
        `(${response.status} ${response.statusText})`
      )
    }

    const metadata = await response.json()
    if (metadata?.name !== packageName || metadata.version !== version) {
      throw new Error(`Registry returned the wrong identity for ${packageName}`)
    }

    if (metadata.gitHead !== sources.peers[packageName].commit) {
      throw new Error(`Registry gitHead mismatch for ${packageName}`)
    }
    try {
      validateNativePeerPackage(metadata, { packageName, sources, expectedRuntime })
    } catch (error) {
      if (!/Native release manifest mismatch/.test(error.message)) throw error
      throw new Error(`Registry native release manifest mismatch for ${packageName}`)
    }

    verifiedPeers.push({ name: packageName, range: version, minimum: version })
  }

  return verifiedPeers
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const packageJson = JSON.parse(
    readFileSync(path.join(rootDir, 'package.json'), 'utf8')
  )
  console.log(JSON.stringify(await verifyNativePeerReleases({ packageJson }), null, 2))
}
