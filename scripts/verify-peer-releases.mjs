import { REQUIRED_NATIVE_RUNTIME } from '../src/native-runtime-contract.js'
import { minimumVersion } from './peer-version.mjs'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(
  readFileSync(path.join(rootDir, 'package.json'), 'utf8')
)

const verifiedPeers = []
for (const [packageName, range] of Object.entries(packageJson.peerDependencies)) {
  const version = minimumVersion(range, packageName)
  const url =
    `https://registry.npmjs.org/${encodeURIComponent(packageName)}/` +
    encodeURIComponent(version)
  const response = await fetch(url, {
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
  if (metadata.name !== packageName || metadata.version !== version) {
    throw new Error(`Registry returned the wrong identity for ${packageName}`)
  }

  const native = metadata.utexoNativeOverlay
  if (!native || native.ref !== 'v' + REQUIRED_NATIVE_RUNTIME.rln_version ||
      native.commit !== REQUIRED_NATIVE_RUNTIME.rln_commit ||
      native.lightningCommit !== REQUIRED_NATIVE_RUNTIME.lightning_commit ||
      native.patchSha256 !== REQUIRED_NATIVE_RUNTIME.adapter_sha256) {
    throw new Error(`Registry native release manifest mismatch for ${packageName}`)
  }

  verifiedPeers.push({ name: packageName, range, minimum: version })
}

console.log(JSON.stringify(verifiedPeers, null, 2))
