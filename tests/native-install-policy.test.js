import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  assertInstallScriptConfiguration,
  assertNativePostinstall,
  nativeInstallPolicyKey
} from '../scripts/native-install-policy.mjs'

const packageName = '@utexo/rgb-lightning-node-nodejs'
const version = '0.2.0-beta.4'

describe('native consumer install-script policy', () => {
  it('pins registry approval to the reviewed native package version', () => {
    expect(nativeInstallPolicyKey({ packageName, version })).toBe(`${packageName}@${version}`)
  })

  it('approves a local candidate by its exact file source instead of its self-declared package name', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'wdk reviewed native '))
    try {
      const tarball = path.join(root, 'native-candidate.tgz')
      writeFileSync(tarball, 'Fixture path; real native tarball admission runs in the packed canary.')
      expect(nativeInstallPolicyKey({ packageName, version, tarball })).toBe(`file:${tarball}`)
      expect(nativeInstallPolicyKey({ packageName, version, tarball })).not.toBe(`${packageName}@${version}`)
      expect(() => nativeInstallPolicyKey({ packageName, version, tarball: root })).toThrow('local tarball file')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it.each([
    { packageName: 'unreviewed-transitive', version },
    { packageName, version: '^0.2.0-beta.4' },
    { packageName, version: 'latest' }
  ])('rejects unreviewed native identity or floating version %p', identity => {
    expect(() => nativeInstallPolicyKey(identity)).toThrow('known native package and exact version')
  })

  it.each(['', 'https://example.com/native.tgz'])('rejects a non-local candidate %p', tarball => {
    expect(() => nativeInstallPolicyKey({ packageName, version, tarball })).toThrow('local tarball file')
  })

  it('requires scripts enabled with no policy bypass', () => {
    expect(() => assertInstallScriptConfiguration({ npmMajor: 12, ignoreScripts: 'false', dangerouslyAllowAllScripts: 'false' })).not.toThrow()
  })

  it.each([
    { npmMajor: 12, ignoreScripts: 'true', dangerouslyAllowAllScripts: 'false' },
    { npmMajor: 12, ignoreScripts: 'false', dangerouslyAllowAllScripts: 'true' },
    { npmMajor: 12, ignoreScripts: undefined, dangerouslyAllowAllScripts: 'false' }
  ])('rejects a disabled or bypassed script policy %p', configuration => {
    expect(() => assertInstallScriptConfiguration(configuration)).toThrow('without a global policy bypass')
  })

  it.each([10, 11, NaN, undefined])('rejects npm without the reviewed script policy (major=%p)', npmMajor => {
    expect(() => assertInstallScriptConfiguration({ npmMajor, ignoreScripts: 'false', dangerouslyAllowAllScripts: 'false' }))
      .toThrow('requires npm >=12')
  })

  it('requires both the actual native postinstall and artifact-admission success', () => {
    const identity = `> ${packageName}@${version} postinstall\n> node scripts/install-overlay-addon.js\n`
    const admissionMarker = 'Verified release-based native addon.'
    const options = { packageName, version, admissionMarker }
    expect(() => assertNativePostinstall(identity + admissionMarker, options)).not.toThrow()
    expect(() => assertNativePostinstall(identity, options)).toThrow('not observed')
    expect(() => assertNativePostinstall(admissionMarker, options)).toThrow('not observed')
    expect(() => assertNativePostinstall(identity.replace(version, '0.2.0-beta.3') + admissionMarker, options)).toThrow('not observed')
  })
})
