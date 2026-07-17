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
  })
}

const uniffiHealthcheck = () => true
const uniffiIsInitialized = () => false
const sdkInitialize = () => {}
const sdkShutdown = () => {}

export default {
  SdkNode,
  NativeExternalSigner,
  uniffiHealthcheck,
  uniffiIsInitialized,
  sdkInitialize,
  sdkShutdown
}
