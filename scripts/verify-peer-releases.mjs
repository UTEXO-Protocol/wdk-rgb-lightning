import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(
  readFileSync(path.join(rootDir, 'package.json'), 'utf8')
)

function minimumVersion (range, packageName) {
  const match = /^>=([^ ]+)/.exec(range)
  if (!match) {
    throw new Error(
      `Cannot derive the minimum version from ${packageName} range: ${range}`
    )
  }
  return match[1]
}

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

  verifiedPeers.push({ name: packageName, range, minimum: version })
}

console.log(JSON.stringify(verifiedPeers, null, 2))
