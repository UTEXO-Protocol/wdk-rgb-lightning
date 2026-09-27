import { minimumVersion } from '../scripts/peer-version.mjs'

it('accepts exact coordinated candidates and legacy minimum ranges', () => {
  expect(minimumVersion('0.2.0-beta.1', 'native')).toBe('0.2.0-beta.1')
  expect(minimumVersion('>=0.1.0-beta.10 <0.2.0', 'native')).toBe('0.1.0-beta.10')
  expect(() => minimumVersion('*', 'native')).toThrow()
  expect(() => minimumVersion('^0.2.0', 'native')).toThrow()
})
