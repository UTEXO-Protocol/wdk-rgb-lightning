import { readFileSync } from 'node:fs'
import { REQUIRED_NATIVE_RUNTIME } from '../../src/native-runtime-contract.js'

export const HISTORICAL_QUALIFICATION_RUNTIME = Object.freeze({
  abi_version: 1,
  rln_version: '0.17.0-beta.3',
  rln_commit: 'ecc69f20308231400561f6f060fea88acfa40cc4',
  lightning_commit: '79b9eb5166546c62692d3a672986f385c7fe047d',
  adapter_sha256: '6d46717b80ffba8ed8af2de023a536af242aadcacbbb799fb9bb89f8933e4ca5'
})

/** Fail before touching the historical chain, controller or native wallet. */
export function assertHistoricalQualification ({ packageJson, runtime = REQUIRED_NATIVE_RUNTIME } = {}) {
  packageJson ??= JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  if (packageJson.version !== '0.2.0-beta.5' ||
      ['@utexo/rgb-lightning-node-bare', '@utexo/rgb-lightning-node-nodejs']
        .some(name => packageJson.peerDependencies?.[name] !== '0.2.0-beta.5') ||
      !runtime || Object.entries(HISTORICAL_QUALIFICATION_RUNTIME).some(([key, value]) => runtime[key] !== value) ||
      Object.keys(runtime).some(key => !Object.hasOwn(HISTORICAL_QUALIFICATION_RUNTIME, key))) {
    throw new Error('Historical beta.5/proxy-0.3 qualification fixtures cannot operate from this source graph. Use the isolated rgb-lib-bfa migration harness; these fixtures do not qualify the migration.')
  }
}
