import { readFileSync } from 'node:fs'
import { base64 } from '@scure/base'
import { burnDestinationHash, burnDestinationFor, validateBurnDestination, createBurnPackage, MAX_BURN_PROOF_BYTES } from '../src/webrgb.js'

const vectors = JSON.parse(readFileSync(new URL('./fixtures/burn-destination-vectors.json', import.meta.url)))
const routeVectors = JSON.parse(readFileSync(new URL('./fixtures/burn-route-vectors.json', import.meta.url)))
const payout = { chainId: 'eip155:42161', address: '0x' + '11'.repeat(20) }
const routes = [{ chainId: 'eip155:42161', dstEid: 0 }]
const destination = { version: 1, destinationChainId: 42161, dstEid: 0, recipient: payout.address }

test.each(vectors.vectors)('matches independent bridge/enclave ABI vector $name', ({ name, hash, encoded, ...value }) => {
  expect('0x' + burnDestinationHash(value)).toBe(hash)
})

test.each(routeVectors.vectors)('constructs the current $name route and matches independent Go ABI commitment', ({ name, hash, encoded, ...value }) => {
  const chainId = `${name === 'tron' ? 'tron' : 'eip155'}:${value.destinationChainId}`
  const address = name === 'tron' ? 'TEdvoHEatmDKvTh3o9vBRB9Vdtbhn4QFhy' : value.recipient
  const result = burnDestinationFor({ chainId, address }, [{ chainId, dstEid: value.dstEid }])
  expect(result).toEqual(value)
  expect('0x' + burnDestinationHash(result)).toBe(hash)
  const proof = Uint8Array.from([82, 71, 66, 0, 84, 70, 82, 1, 0, 255, 128])
  expect(JSON.parse(createBurnPackage(proof, result)).burnDestination).toEqual(value)
})

test('validates native Tron checksum/version/nonzero identity without EVM reinterpretation', () => {
  const chainId = 'tron:728126428'
  const routes = [{ chainId, dstEid: 30420 }]
  for (const address of ['TEdvoHEatmDKvTh3o9vBRB9Vdtbhn4QFhY', 'tedvoHEatmDKvTh3o9vBRB9Vdtbhn4QFhy',
    '0x' + '33'.repeat(20), '413333333333333333333333333333333333333333',
    'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb']) {
    expect(() => burnDestinationFor({ chainId, address }, routes)).toThrow(TypeError)
  }
  expect(() => burnDestinationFor({ chainId, address: 'TEdvoHEatmDKvTh3o9vBRB9Vdtbhn4QFhy' }, [{ chainId, dstEid: 0 }])).toThrow()
})

test('rejects malformed EVM checksum and namespace confusion', () => {
  const address = '0x52908400098527886E0F7030069857D2E4169EE7'
  expect(burnDestinationFor({ chainId: payout.chainId, address }, routes).recipient).toBe(address.toLowerCase())
  expect(() => burnDestinationFor({ chainId: payout.chainId, address: address.replace('E0', 'e0') }, routes)).toThrow('checksum')
  expect(() => burnDestinationFor({ chainId: payout.chainId, address: 'TEdvoHEatmDKvTh3o9vBRB9Vdtbhn4QFhy' }, routes)).toThrow()
})

test('binds chain, endpoint and full recipient, with no signature domain prefix', () => {
  expect(burnDestinationHash(destination)).toBe(vectors.vectors[0].hash.slice(2))
  for (const changed of [{ ...destination, destinationChainId: 1 }, { ...destination, dstEid: 1 },
    { ...destination, recipient: '0x' + '12'.repeat(20) }]) {
    expect(burnDestinationHash(changed)).not.toBe(burnDestinationHash(destination))
  }
})

test.each([null, [], {}, { ...destination, version: 2 }, { ...destination, destinationChainId: 0 },
  { ...destination, destinationChainId: Number.MAX_SAFE_INTEGER + 1 }, { ...destination, dstEid: -1 },
  { ...destination, dstEid: 0x100000000 }, { ...destination, recipient: '0x11' },
  { ...destination, recipient: '0x' + '11'.repeat(33) }, { ...destination, extra: true }])('rejects malformed portable destination %p', value => {
  expect(() => validateBurnDestination(value)).toThrow(TypeError)
})

test('only constructs explicitly qualified EVM routes and snapshots caller input', () => {
  expect(burnDestinationFor(payout, routes)).toEqual(destination)
  expect(Object.isFrozen(burnDestinationFor(payout, routes))).toBe(true)
  expect(() => burnDestinationFor(payout, [])).toThrow('not qualified')
  expect(() => burnDestinationFor(payout, [...routes, ...routes])).toThrow('not qualified')
  expect(() => burnDestinationFor({ ...payout, chainId: 'eip155:1' }, routes)).toThrow()
  expect(() => burnDestinationFor({ ...payout, address: '0x' + '0'.repeat(40) }, routes)).toThrow()
  expect(() => burnDestinationFor({ chainId: 'tron:728126428', address: 'TExample' }, routes)).toThrow()
})

test('exports a saved proof and destination in one CLI-compatible envelope with exact bytes', () => {
  const proof = Uint8Array.from([82, 71, 66, 0, 84, 70, 82, 1, 0, 255, 128])
  const file = JSON.parse(createBurnPackage(proof, destination))
  expect(file).toEqual({
    format: 'utexo-burn',
    version: 1,
    consignment: { encoding: 'base64', byteLength: proof.length, data: base64.encode(proof) },
    burnDestination: destination
  })
  expect(base64.decode(file.consignment.data)).toEqual(proof)
  expect(() => createBurnPackage(new Uint8Array(), destination)).toThrow()
  expect(() => createBurnPackage(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), destination)).toThrow()
  expect(() => createBurnPackage(new Uint8Array(MAX_BURN_PROOF_BYTES + 1), destination)).toThrow()
  expect(() => createBurnPackage(proof, { ...destination, version: 0 })).toThrow()
})
