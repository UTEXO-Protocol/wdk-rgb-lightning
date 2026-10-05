// Copyright 2026 UTEXO. Licensed under the Apache License, Version 2.0.
import { LightningDisabledError } from './errors.js'

export function assertLightningEnabled (network) {
  if (typeof network === 'string' && network.toLowerCase() === 'mainnet') throw new LightningDisabledError()
}

// Account-like integrations remain supported; WDK accounts supply getNetwork().
export function assertAccountLightningEnabled (account) {
  assertLightningEnabled(account?.getNetwork?.())
}
