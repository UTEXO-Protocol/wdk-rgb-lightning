import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { minimumVersion } from './peer-version.mjs'
import { packedBareInputs } from './packed-bare-inputs.mjs'
import {
  assertInstallScriptConfiguration,
  assertNativePostinstall
} from './native-install-policy.mjs'

// This desktop canary is not an iOS/Android device qualification test.
if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('The packed Bare canary requires a macOS arm64 host')
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const burnVector = JSON.parse(readFileSync(path.join(root, 'tests/fixtures/burn-destination-vectors.json'), 'utf8')).vectors[0]
const nativePackage = '@utexo/rgb-lightning-node-bare'
const nativeVersion = minimumVersion(pkg.peerDependencies[nativePackage], nativePackage)
const inputs = packedBareInputs({ version: nativeVersion })
const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'wdk-rln-bare-consumer-'))

function run (command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`)
}

function runAndCapture (command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
    ...options
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} exited with ${result.status}:\n${result.stdout}${result.stderr}`)
  }
  return result
}

try {
  const npmMajor = Number(runAndCapture('npm', ['--version'], { cwd: temporaryRoot }).stdout.trim().split('.')[0])
  if (!Number.isInteger(npmMajor)) throw new Error('npm returned an invalid version')
  if (npmMajor < 12) throw new Error('Packed Bare canary requires npm >=12 for install-script approval')
  const installScriptConfig = {
    npmMajor,
    ignoreScripts: runAndCapture('npm', ['config', 'get', 'ignore-scripts'], { cwd: temporaryRoot }).stdout.trim(),
    dangerouslyAllowAllScripts: runAndCapture('npm', ['config', 'get', 'dangerously-allow-all-scripts'], { cwd: temporaryRoot }).stdout.trim()
  }
  assertInstallScriptConfiguration(installScriptConfig)
  console.log('Native install-script configuration: ' + JSON.stringify(installScriptConfig))

  let wdkTarball = process.argv[2] && path.resolve(process.argv[2])
  if (!wdkTarball) {
    const packDir = path.join(temporaryRoot, 'pack')
    run(process.execPath, [path.join(root, 'scripts/verify-package.mjs'), '--output-dir', packDir])
    wdkTarball = path.join(packDir, `utexo-wdk-rgb-lightning-${pkg.version}.tgz`)
  }
  writeFileSync(path.join(temporaryRoot, 'package.json'), JSON.stringify({
    private: true,
    allowScripts: inputs.allowScripts
  }))
  const installation = runAndCapture('npm', ['install', '--foreground-scripts', '--no-audit', '--no-fund', '--save-exact', wdkTarball,
    ...inputs.installSpecs,
    'bare-runtime@1.33.0'], {
    cwd: temporaryRoot,
    env: { ...process.env, RLN_BARE_TARGETS: 'darwin-arm64' }
  })
  process.stdout.write(installation.stdout)
  process.stderr.write(installation.stderr)
  assertNativePostinstall(installation.stdout + installation.stderr, {
    packageName: nativePackage,
    version: nativeVersion,
    admissionMarker: '[rgb-lightning-node-bare] Verified packed prebuilds: darwin-arm64'
  })

  const policy = JSON.parse(runAndCapture('npm', ['install-scripts', 'ls', '--json'], { cwd: temporaryRoot }).stdout)
  if (!Array.isArray(policy.allowScripts)) throw new Error('npm returned an invalid install-script policy')
  if (policy.allowScripts.length > 0) {
    throw new Error('Unreviewed dependency install scripts remain:\n' + JSON.stringify(policy.allowScripts, null, 2))
  }
  console.log('Packed Bare native postinstall admitted; no unreviewed dependency install scripts remain')

  const program = `
    import WalletManager, { BareRgbLightningBinding, parseLspInfo, LightningDisabledError } from '${pkg.name}'
    import { WebRgbProvider, burnDestinationHash } from '${pkg.name}/webrgb'
    import { smokeWalletPolicy } from ${JSON.stringify(path.join(root, 'scripts/smoke-wallet-policy.mjs'))}
    import { assertNativeRuntime } from ${JSON.stringify(path.join(root, 'src/native-runtime-contract.js'))}
    import native from '${nativePackage}'
    import { parseLspInfo as parseOnly } from '${pkg.name}/lsp-info'
    // An unresolved Promise alone does not keep Bare's event loop alive.
    const completionGuard = setTimeout(() => {
      throw new Error('Packed Bare checks did not complete within 60 seconds')
    }, 60_000)
    if (WalletManager.Binding !== BareRgbLightningBinding || parseLspInfo !== parseOnly) {
      throw new Error('Packed Bare exports resolved incorrectly')
    }
    // The source contract checks every REQUIRED_NATIVE_RUNTIME graph identity,
    // compiled capabilities and VSS policy. Packed binding admission still runs.
    assertNativeRuntime(native)
    BareRgbLightningBinding.healthcheck()
    const { name, hash, encoded, ...burnDestination } = ${JSON.stringify(burnVector)}
    if ('0x' + burnDestinationHash(burnDestination) !== hash) {
      throw new Error('Packed Bare burn commitment differs from independent bridge vector ' + name)
    }
    // Public deterministic fixture seed. Never fund this wallet.
    const manager = new WalletManager(new Uint8Array(64).fill(1), {
      network: 'regtest', dataDir: ${JSON.stringify(path.join(temporaryRoot, 'wallet'))}
    })
    try {
      const account = await manager.getAccount()
      const bootstrap = await account.getBootstrap()
      if (!/^(02|03)[a-f0-9]{64}$/.test(bootstrap.node_id)) throw new Error('Invalid signer bootstrap')
      let failed = false
      try { await account.getNodeInfo() } catch (error) {
        if (!/NotInitialized/.test(String(error))) throw error
        failed = true
      }
      if (!failed) throw new Error('Uninitialized native query unexpectedly succeeded')
      await account.shutdown()
    } finally {
      manager.dispose()
    }
    await smokeWalletPolicy(WalletManager, WebRgbProvider, LightningDisabledError, ${JSON.stringify(path.join(temporaryRoot, 'mainnet-wallet'))})
    clearTimeout(completionGuard)
    console.log('Packed Bare/WDK exports, native identity, signer, mainnet policy and WebRGB passed')
  `
  const smokePath = path.join(temporaryRoot, 'smoke.mjs')
  writeFileSync(smokePath, program)
  const bareLauncher = path.join(temporaryRoot, 'node_modules/bare-runtime/bin/bare')
  console.log('Packed Bare CLI runtime version:')
  run(process.execPath, [bareLauncher, '--version'], { cwd: temporaryRoot })
  const smoke = runAndCapture(process.execPath, [bareLauncher, smokePath], {
    cwd: temporaryRoot,
    timeout: 90_000
  })
  process.stdout.write(smoke.stdout)
  process.stderr.write(smoke.stderr)
  if (!smoke.stdout.includes('Packed Bare/WDK exports, native identity, signer, mainnet policy and WebRGB passed')) {
    throw new Error('Packed Bare checks exited without their completion marker')
  }
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true })
}
