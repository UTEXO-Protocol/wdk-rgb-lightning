'use strict'

// Subpath imports need the same Node builtin mappings as the main Bare entry.
// In particular, the burn commitment's hash dependency imports node:crypto.
import 'bare-node-runtime/global'

export * from './src/webrgb.js' with { imports: 'bare-node-runtime/imports' }
