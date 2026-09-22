import { REQUIRED_NATIVE_RUNTIME } from '../../src/native-runtime-contract.js'
// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.

// Jest replacement for the optional Bare native addon. It preserves the
// exported shape while keeping binding lifecycle tests platform-independent.

const SdkNode = {
  create: () => ({})
}

const NativeExternalSigner = {
  create: () => ({
    bootstrap: () => ({}),
    destroy: () => {}
  }),
  createWithStorage: () => ({
    bootstrap: () => ({}),
    destroy: () => {}
  })
}

const uniffiHealthcheck = () => 'rgb_lightning_node_uniffi_ready'
const uniffiIsInitialized = () => false
const sdkInitialize = () => {}
const sdkShutdown = () => {}

export default {
  getRuntimeInfo: () => ({ ...REQUIRED_NATIVE_RUNTIME, capabilities: ['canonical-unlock-v1', 'persistent-native-signer', 'refresh-transfers-v1', 'apay-address', 'decoded-invoice-cltv', 'tagged-rgb-assignment'] }),
  SdkNode,
  NativeExternalSigner,
  uniffiHealthcheck,
  uniffiIsInitialized,
  sdkInitialize,
  sdkShutdown
}
