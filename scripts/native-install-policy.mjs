import { statSync } from 'node:fs'
import path from 'node:path'

const nativePackages = new Set([
  '@utexo/rgb-lightning-node-bare',
  '@utexo/rgb-lightning-node-nodejs'
])

export function nativeInstallPolicyKey ({ packageName, version, tarball }) {
  if (!nativePackages.has(packageName) || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error('Install policy requires a known native package and exact version')
  }
  if (tarball === undefined) return `${packageName}@${version}`
  if (typeof tarball !== 'string' || !tarball || /^[a-z][a-z0-9+.-]*:\/\//i.test(tarball)) {
    throw new Error('Native candidate must be a local tarball file')
  }
  const absolute = path.resolve(tarball)
  if (!absolute.endsWith('.tgz') || !statSync(absolute).isFile()) {
    throw new Error('Native candidate must be a local tarball file')
  }
  // npm 12 matches non-registry dependencies by their exact resolved source.
  // A name@version policy intentionally cannot authorize a local tarball whose
  // self-declared package identity has not yet been trusted by a registry.
  return `file:${absolute}`
}

export function assertInstallScriptConfiguration ({ npmMajor, ignoreScripts, dangerouslyAllowAllScripts }) {
  if (!Number.isInteger(npmMajor) || npmMajor < 12) {
    throw new Error('Native canary requires npm >=12 to enforce reviewed install-script policy')
  }
  if (ignoreScripts !== 'false' || dangerouslyAllowAllScripts !== 'false') {
    throw new Error('Native canary requires install scripts enabled without a global policy bypass')
  }
}

export function assertNativePostinstall (output, { packageName, version, admissionMarker }) {
  if (!output.includes(`> ${packageName}@${version} postinstall`) || !output.includes(admissionMarker)) {
    throw new Error('Native postinstall and successful artifact admission were not observed')
  }
}
