import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(
  readFileSync(path.join(rootDir, 'package.json'), 'utf8')
)
const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm'

function hasArgument (name) {
  return process.argv.includes(name)
}

function run (command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: 'inherit',
    ...options
  })

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`)
  }
}

function minimumVersion (range, packageName) {
  const match = /^>=([^ ]+)/.exec(range)
  if (!match) {
    throw new Error(
      `Cannot derive the minimum version from ${packageName} range: ${range}`
    )
  }
  return match[1]
}

const temporaryRoot = mkdtempSync(
  path.join(tmpdir(), 'wdk-rgb-lightning-smoke-')
)

try {
  const registryPackage = hasArgument('--registry')
  const verifySignatures = hasArgument('--verify-signatures')
  const positionalArgument = process.argv
    .slice(2)
    .find(argument => !argument.startsWith('--'))
  let packageSpec = registryPackage
    ? `${packageJson.name}@${packageJson.version}`
    : positionalArgument && path.resolve(positionalArgument)

  if (!packageSpec) {
    const packDir = path.join(temporaryRoot, 'pack')
    run(process.execPath, [
      path.join(rootDir, 'scripts', 'verify-package.mjs'),
      '--output-dir',
      packDir
    ])
    packageSpec = path.join(
      packDir,
      `${packageJson.name.replace('@', '').replace('/', '-')}-${packageJson.version}.tgz`
    )
  }

  const nativePackage = '@utexo/rgb-lightning-node-nodejs'
  const nativeVersion = minimumVersion(
    packageJson.peerDependencies[nativePackage],
    nativePackage
  )

  writeFileSync(
    path.join(temporaryRoot, 'package.json'),
    JSON.stringify({
      private: true,
      allowScripts: {
        [`${nativePackage}@${nativeVersion}`]: true
      }
    }, null, 2) + '\n'
  )
  writeFileSync(
    path.join(temporaryRoot, '.npmrc'),
    'strict-allow-scripts=true\n'
  )

  run(npmExecutable, [
    'install',
    '--no-audit',
    '--no-fund',
    '--save-exact',
    packageSpec,
    `${nativePackage}@${nativeVersion}`
  ], { cwd: temporaryRoot })

  if (verifySignatures) {
    run(npmExecutable, ['audit', 'signatures'], { cwd: temporaryRoot })
  }

  const smokeProgram = `
    import WalletManagerRgbLightning, {
      NodeRgbLightningBinding,
      WalletAccountReadOnlyRgbLightning
    } from '${packageJson.name}'

    const metadata = (
      await import('${packageJson.name}/package', {
        with: { type: 'json' }
      })
    ).default

    if (metadata.name !== '${packageJson.name}') {
      throw new Error('Package subpath returned the wrong package name')
    }
    if (metadata.version !== '${packageJson.version}') {
      throw new Error('Package subpath returned the wrong package version')
    }
    if (WalletManagerRgbLightning.Binding !== NodeRgbLightningBinding) {
      throw new Error('The default Node export is wired to the wrong binding')
    }
    if (typeof WalletAccountReadOnlyRgbLightning !== 'function') {
      throw new Error('The read-only account export is missing')
    }
    if (typeof NodeRgbLightningBinding.healthcheck !== 'function') {
      throw new Error('The native healthcheck surface is missing')
    }

    NodeRgbLightningBinding.healthcheck()
  `

  run(
    process.execPath,
    ['--input-type=module', '--eval', smokeProgram],
    { cwd: temporaryRoot }
  )

  console.log(
    `Node package smoke passed with ${nativePackage}@${nativeVersion}`
  )
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true })
}
