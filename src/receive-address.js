// Copyright 2026 UTEXO. Licensed under the Apache License, Version 2.0.
'use strict'

const states = new WeakMap()

export function addressReuse (config) {
  if (config.reuseAddresses !== undefined && typeof config.reuseAddresses !== 'boolean') {
    throw new TypeError('reuseAddresses must be a boolean')
  }
  return config.reuseAddresses ?? true
}

function addressFrom (value) {
  const address = typeof value === 'string' ? value : value?.address
  if (typeof address !== 'string' || address.length === 0) throw new Error('RGB Lightning node returned an invalid receive address')
  return address
}

function stateFor (binding) {
  if (!states.has(binding)) states.set(binding, { current: null, tail: Promise.resolve(), pending: 0, closed: false })
  return states.get(binding)
}

export function addressOperationPending (binding) {
  return (states.get(binding)?.pending ?? 0) > 0
}

export async function joinAddressOperations (binding) {
  await states.get(binding)?.tail
}

export function stopAddressOperations (binding) {
  stateFor(binding).closed = true
}

// The read-only facade and full account share one queue and current address.
// Non-reuse allocates once per session/read, then only on an explicit request.
export function receiveAddress (binding, fresh = false, rotateOnly = false) {
  const state = stateFor(binding)
  if (state.closed) return Promise.reject(new Error('RGB Lightning account is closed'))
  state.pending++
  const operation = state.tail.then(async () => {
    const node = binding.ensureNode()
    const reuse = addressReuse(binding._config ?? {})
    if (rotateOnly && !reuse) throw new Error('Address reuse is disabled; use getNewAddress()')
    if (!fresh && !reuse && state.current !== null) return state.current
    let rotated
    if (fresh && reuse) {
      if (typeof node.rotateAddress !== 'function') throw new Error('The installed RGB Lightning native binding does not expose rotateAddress()')
      const result = await node.rotateAddress()
      rotated = typeof result === 'string' ? result : result?.address
      if (typeof rotated !== 'string' || rotated.length === 0) throw new Error('RGB Lightning node returned an invalid rotated address')
    }
    // RLN rotation peeks the script. A native address read reveals/persists it.
    const address = addressFrom(await node.address())
    if (rotated !== undefined && rotated !== address) throw new Error('Rotated address differs from the persisted receive address')
    state.current = address
    return address
  }).catch(error => {
    state.current = null
    throw error
  }).finally(() => { state.pending-- })
  state.tail = operation.catch(() => {})
  return operation
}
