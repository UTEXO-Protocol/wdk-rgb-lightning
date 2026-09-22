import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { minimumVersion } from './peer-version.mjs'

// This desktop canary is not an iOS/Android device qualification test.
if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('The packed Bare canary requires a macOS arm64 host')
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const nativePackage = '@utexo/rgb-lightning-node-bare'
const nativeVersion = minimumVersion(pkg.peerDependencies[nativePackage], nativePackage)
const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'wdk-rln-bare-consumer-'))

function run (command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`)
}

try {
  const packDir = path.join(temporaryRoot, 'pack')
  run(process.execPath, [path.join(root, 'scripts/verify-package.mjs'), '--output-dir', packDir])
  const wdkTarball = path.join(packDir, `utexo-wdk-rgb-lightning-${pkg.version}.tgz`)
  writeFileSync(path.join(temporaryRoot, 'package.json'), JSON.stringify({
    private: true,
    allowScripts: { [`${nativePackage}@${nativeVersion}`]: true }
  }))
  run('npm', ['install', '--no-audit', '--no-fund', '--save-exact', wdkTarball,
    process.env.RLN_BARE_PACKAGE_TARBALL
      ? path.resolve(process.env.RLN_BARE_PACKAGE_TARBALL)
      : `${nativePackage}@${nativeVersion}`,
    'bare-runtime@1.32.0'], {
    cwd: temporaryRoot,
    env: { ...process.env, RLN_BARE_TARGETS: 'darwin-arm64' }
  })

  const program = `
    import WalletManager, { BareRgbLightningBinding, parseLspInfo } from '${pkg.name}'
    import native from '${nativePackage}'
    import { parseLspInfo as parseOnly } from '${pkg.name}/lsp-info'
    if (WalletManager.Binding !== BareRgbLightningBinding || parseLspInfo !== parseOnly) {
      throw new Error('Packed Bare exports resolved incorrectly')
    }
    if (native.getRuntimeInfo().rln_commit !== 'af03c7f1a65135a429f05a5820600338215954dc') {
      throw new Error('Wrong compiled RLN release')
    }
    BareRgbLightningBinding.healthcheck()
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
    console.log('Packed Bare/WDK exports, native identity, signer and offline lifecycle passed')
  `
  const smokePath = path.join(temporaryRoot, 'smoke.mjs')
  writeFileSync(smokePath, program)
  run(process.execPath, [path.join(temporaryRoot, 'node_modules/bare-runtime/bin/bare'), smokePath], { cwd: temporaryRoot })
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true })
}
