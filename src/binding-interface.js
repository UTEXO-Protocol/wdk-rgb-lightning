// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
'use strict'

// IRgbLightningBinding is documented here as a JSDoc contract — there is
// no runtime export. Concrete implementations live in `bare-binding.js`
// (RN / bare worklet) and `node-binding.js` (Node). Both wrap the same
// `SdkNode` + `NativeExternalSigner` C-FFI surface; the only difference
// is the underlying npm addon (`@utexo/rgb-lightning-node-bare` vs
// `@utexo/rgb-lightning-node-nodejs`).

/**
 * @typedef {Object} RgbLightningBindingConfig
 * @property {'mainnet'|'testnet'|'regtest'|'signet'} network
 * @property {string}  dataDir
 * @property {number}  [daemonListeningPort=0]
 * @property {number}  [ldkPeerListeningPort=0]
 * @property {number}  [maxMediaUploadSizeMb=5]
 * @property {boolean} [enableVirtualChannelsV0=false]
 * @property {boolean} [permissiveSignerPolicy=true]
 */

/**
 * @typedef {Object} IRgbLightningBinding
 * @property {() => unknown}                            ensureNode
 *   Construct (or return cached) `SdkNode` handle.
 * @property {(seedHex: string) => void}                attachExternalSigner
 *   Build the in-process VLS signer from a host-supplied 32-byte seed.
 *   Must be called before `unlock()`.
 * @property {(unlockRequest: object) => void}          unlock
 *   First call: init+unlock against a fresh dataDir. Later calls swallow
 *   the expected `Rln(Conflict)` from init and proceed with unlock.
 * @property {unknown}                                  node
 *   The `SdkNode` handle (getter). Throws if `unlock()` has not run.
 * @property {() => object}                             bootstrap
 *   Returns the signer's bootstrap payload (node_id, xpubs, master_fp).
 * @property {() => void}                               shutdown
 *   Idempotent stop — releases the node handle + destroys the signer.
 */

export const __SHAPE_ONLY = true
