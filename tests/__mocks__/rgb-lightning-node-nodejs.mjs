// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.

// Jest mock for the native napi addon `@utexo/rgb-lightning-node-nodejs`.
// Wired in via the `moduleNameMapper` entry in package.json's jest config
// so that importing `src/node-binding.js` under test does not pull in (or
// require the install of) the real platform-specific `.node` binary. The
// shape mirrors the addon's documented surface; methods are inert stubs —
// `node-binding-config.test.js` only exercises the pure request-mapping
// logic in the binding constructor, which never calls into these.

const SdkNode = {
  create: () => ({})
}

const NativeExternalSigner = {
  create: () => ({
    bootstrap: () => ({}),
    destroy: () => {}
  })
}

const uniffiHealthcheck = () => 'unsupported-in-node-binding'
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
