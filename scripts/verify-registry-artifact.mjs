import { appendFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

function argumentValue (name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return undefined
  if (!process.argv[index + 1]) throw new Error(`${name} requires a value`)
  return process.argv[index + 1]
}

function hasArgument (name) {
  return process.argv.includes(name)
}

function writeOutputs (outputs) {
  if (!process.env.GITHUB_OUTPUT) return
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    Object.entries(outputs)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n') + '\n'
  )
}

async function registryFetch (url) {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(30_000)
  })

  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(
      `Registry request failed (${response.status} ${response.statusText}): ` +
      `${await response.text()}`
    )
  }
  return response
}

function verifyIntegrity (contents, integrity) {
  const match = /^([a-z0-9]+)-(.+)$/.exec(integrity)
  if (!match) throw new Error(`Unsupported integrity value: ${integrity}`)

  const actual = createHash(match[1]).update(contents).digest('base64')
  if (actual !== match[2]) {
    throw new Error('Downloaded registry tarball does not match its integrity')
  }
}

const packageName = argumentValue('--name')
const packageVersion = argumentValue('--version')
const expectedIntegrity = argumentValue('--integrity')
const expectedGitHead = argumentValue('--git-head')
const allowMissing = hasArgument('--allow-missing')
const requireLatest = hasArgument('--require-latest')
const requireProvenance = hasArgument('--require-provenance')
const waitSeconds = Number(argumentValue('--wait-seconds') || 0)

if (!packageName || !packageVersion || !expectedIntegrity) {
  throw new Error('--name, --version, and --integrity are required')
}
if (!Number.isFinite(waitSeconds) || waitSeconds < 0) {
  throw new Error('--wait-seconds must be a non-negative number')
}

const encodedName = encodeURIComponent(packageName)
const encodedVersion = encodeURIComponent(packageVersion)
const versionUrl =
  `https://registry.npmjs.org/${encodedName}/${encodedVersion}`
const distTagsUrl =
  `https://registry.npmjs.org/-/package/${encodedName}/dist-tags`
const deadline = Date.now() + waitSeconds * 1000

let verification
while (!verification) {
  const versionResponse = await registryFetch(versionUrl)
  if (!versionResponse) {
    if (Date.now() < deadline) {
      await delay(10_000)
      continue
    }
    if (allowMissing) {
      writeOutputs({ published: false })
      console.log(`${packageName}@${packageVersion} is not published`)
      process.exit(0)
    }
    throw new Error(`${packageName}@${packageVersion} is not published`)
  }

  const metadata = await versionResponse.json()
  if (metadata.name !== packageName || metadata.version !== packageVersion) {
    throw new Error('Registry metadata returned the wrong package identity')
  }
  if (metadata.dist?.integrity !== expectedIntegrity) {
    throw new Error(
      `Registry integrity ${metadata.dist?.integrity || '<missing>'} does not ` +
      `match local integrity ${expectedIntegrity}`
    )
  }
  if (expectedGitHead && metadata.gitHead !== expectedGitHead) {
    throw new Error(
      `Registry gitHead ${metadata.gitHead || '<missing>'} does not match ` +
      expectedGitHead
    )
  }

  if (requireProvenance) {
    const provenance = metadata.dist?.attestations?.provenance
    const attestationUrl = metadata.dist?.attestations?.url
    if (
      provenance?.predicateType !== 'https://slsa.dev/provenance/v1' ||
      !attestationUrl
    ) {
      if (Date.now() < deadline) {
        await delay(10_000)
        continue
      }
      throw new Error('Registry metadata does not contain SLSA provenance')
    }

    const attestationResponse = await registryFetch(attestationUrl)
    if (!attestationResponse) {
      if (Date.now() < deadline) {
        await delay(10_000)
        continue
      }
      throw new Error('The npm provenance attestation is unavailable')
    }
  }

  let latest
  if (requireLatest) {
    const distTagsResponse = await registryFetch(distTagsUrl)
    if (!distTagsResponse) {
      throw new Error('The npm dist-tags endpoint is unavailable')
    }
    const distTags = await distTagsResponse.json()
    latest = distTags.latest
    if (latest !== packageVersion) {
      if (Date.now() < deadline) {
        await delay(10_000)
        continue
      }
      throw new Error(
        `npm latest points to ${latest || '<missing>'}, not ${packageVersion}`
      )
    }
  }

  const tarballResponse = await registryFetch(metadata.dist.tarball)
  if (!tarballResponse) {
    throw new Error('The registry tarball is unavailable')
  }
  const tarball = Buffer.from(await tarballResponse.arrayBuffer())
  verifyIntegrity(tarball, expectedIntegrity)

  verification = {
    published: true,
    integrity: metadata.dist.integrity,
    tarball: metadata.dist.tarball,
    registry_git_head: metadata.gitHead,
    latest: latest || ''
  }
}

writeOutputs(verification)
console.log(JSON.stringify(verification, null, 2))
