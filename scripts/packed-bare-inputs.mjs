import { lstatSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { nativeInstallPolicyKey } from './native-install-policy.mjs'

const nativePackage = '@utexo/rgb-lightning-node-bare'
export const BARE_PAYLOAD_TARBALL_ENV = Object.freeze([
  'RLN_BARE_IOS_PACKAGE_TARBALL',
  'RLN_BARE_ANDROID_ARM_PACKAGE_TARBALL',
  'RLN_BARE_ANDROID_X64_PACKAGE_TARBALL'
])

function localArchive (value, name) {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !value || value.trim() !== value ||
      Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) ||
      /^[a-z][a-z0-9+.-]*:/i.test(value) || !value.endsWith('.tgz')) {
    throw new Error(`${name} must name an existing regular local .tgz file`)
  }
  const absolute = path.resolve(value)
  const stat = lstatSync(absolute)
  if (!stat.isFile() || stat.size <= 0) throw new Error(`${name} must name an existing regular local .tgz file`)
  // Canonicalize host aliases such as macOS /var. The final component must
  // already be a regular file, so no archive symlink is admitted here.
  return { file: realpathSync(absolute), identity: `${stat.dev}:${stat.ino}` }
}

/** Select install inputs only. Normal package/native artifact admission still runs. */
export function packedBareInputs ({ version, environment = process.env }) {
  const owner = localArchive(environment.RLN_BARE_PACKAGE_TARBALL, 'RLN_BARE_PACKAGE_TARBALL')
  const payloads = BARE_PAYLOAD_TARBALL_ENV.map(name => localArchive(environment[name], name))
  const count = payloads.filter(Boolean).length
  if (count !== 0 && count !== payloads.length) throw new Error('All three Bare payload tarballs must be supplied together')
  if (count && !owner) throw new Error('Local Bare payload tarballs require the local Bare wrapper tarball')
  if (version === '0.2.0-bfa.0' && (!owner || count !== 3)) {
    throw new Error('The unpublished BFA candidate requires the Bare wrapper and all three local payload tarballs')
  }
  const selected = [owner, ...payloads].filter(Boolean)
  if (new Set(selected.map(value => value.identity)).size !== selected.length) {
    throw new Error('Bare wrapper and payload tarballs must be distinct regular files')
  }
  const nativeTarball = owner?.file
  const nativeSpec = nativeTarball ?? `${nativePackage}@${version}`
  const payloadTarballs = Object.freeze(payloads.filter(Boolean).map(value => value.file))
  return Object.freeze({
    nativeTarball,
    installSpecs: Object.freeze([nativeSpec, ...payloadTarballs]),
    // Data payloads must never receive lifecycle-script approval.
    allowScripts: Object.freeze({ [nativeInstallPolicyKey({ packageName: nativePackage, version, tarball: nativeTarball })]: true })
  })
}
