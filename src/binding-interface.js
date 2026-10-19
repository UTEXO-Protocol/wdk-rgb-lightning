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
 * @property {'mainnet'|'testnet'|'regtest'|'signet'} network - Bitcoin
 *   network used by the RGB Lightning node.
 * @property {string} dataDir - Persistent, app-private path for the node's
 *   SQLite database and LDK state.
 * @property {number} [daemonListeningPort] - RGB Lightning daemon port.
 *   Defaults to `0`, which lets the operating system choose a port.
 * @property {number} [ldkPeerListeningPort] - Lightning peer-listening port.
 *   Defaults to `0`, which lets the operating system choose a port.
 * @property {number} [maxMediaUploadSizeMb] - Maximum RGB media upload size
 *   in MiB. Defaults to `5`.
 * @property {boolean} [reuseAddresses] - Defaults to true. False uses released
 *   native non-reuse for Bitcoin and colored scripts. Account address reads
 *   share a session cache; getNewAddress explicitly allocates another address.
 * @property {boolean} [enableVirtualChannelsV0] - Enable the
 *   virtual-channels-v0 protocol. Defaults to `false`. Production APay requires
 *   this together with `virtualPeerPubkeys` because mobile clients open
 *   `trusted_no_broadcast` virtual channels instead of standard channels.
 * @property {string[]} [virtualPeerPubkeys] - Hex-encoded, 33-byte compressed
 *   secp256k1 node IDs trusted for virtual channels. Defaults to an empty trust
 *   list, which disables virtual peering. For APay, set this to the LSP node ID.
 *   Forwarded to RLN as `virtual_peer_pubkeys`.
 * @property {boolean} [permissiveSignerPolicy] - Whether the in-process VLS
 *   signer uses its permissive policy filter. Defaults to `false`; the released
 *   native runtime rejects permissive mode on mainnet.
 * @property {string} [vssUrl] - Explicit VSS endpoint; HTTPS required by default.
 * @property {boolean} [vssAllowHttp] - Explicitly permit HTTP for local testing.
 * @property {boolean} [vssAllowEmptyRestore] - Permit initialization when no remote backup exists.
 * @property {string} [lspBaseUrl] - Base URL for RLN's internal APay client.
 *   Required by `apayNew()` and `bootstrapLsp()`; omit to disable APay.
 * @property {string} [lspBearerToken] - Bearer token sent to the LSP's
 *   `/internal/*` endpoints. Omit when the LSP does not require authorization.
 *
 * Address policy is explicit and must remain consistent for a wallet. The
 * default preserves reuse; new wallets may opt into native non-reuse.
 */

/**
 * @typedef {Object} IRgbLightningBinding
 * @property {() => unknown} ensureNode - Construct or return the cached
 *   `SdkNode` handle.
 * @property {(seedHex: string, fallbackSeedHex?: string) => void} attachExternalSigner - Build
 *   the in-process VLS signer from a host-supplied 32-byte seed.
 *   Must be called before `unlock()`.
 * @property {(unlockRequest: object) => void} unlock - Bring the node online.
 *   The first call initializes and unlocks a fresh data directory. Later calls
 *   treat the expected init `Rln(Conflict)` as already initialized and proceed
 *   with unlock.
 * @property {() => object} bootstrap - Return the signer's bootstrap payload
 *   (`node_id`, xpubs, and master fingerprint).
 * @property {(password: string, expectedScope?: {network: string, dataDir: string, vssUrl: string, nodeId: string}) => {ok: true}} clearVssFence - Explicit takeover;
 *   native requires a locked node. Never called automatically.
 * @property {() => {version: number}} vssBackup - Upload current RGB state.
 * @property {(expectedScope?: object) => object} prepareVssRestore - Download and validate an existing RGB snapshot before first unlock.
 * @property {() => object|null} getVssRestoreInfo - Actual per-handle/durable restore receipt and native unlocked state.
 * @property {() => object} getVssBackupInfo - Read actual backup state without writes.
 * @property {() => object} vssStatus - Local configuration and last successful RGB
 *   upload in this session, without a remote health query or recovery guarantee.
 * @property {(hostNodeId: string) => object} apayNew - Register this node
 *   with an LSP as an async-payments (APay) recipient.
 *   Used for offline-receive over Lightning Address: the wallet uploads
 *   a batch of pre-allocated payment hashes to the LSP, which then
 *   accepts payments addressed to those hashes on the wallet's behalf
 *   while the wallet is offline. Argument is the LSP's node_id (hex).
 *   Returns the native AsyncOrderNewResponse unchanged.
 * @property {(hostNodeId: string, username: string, domain: string) => object} apayNewWithAddress -
 *   Register an APay hash batch carrying the wallet node's signed Lightning
 *   Address attestation. Production Lightning Address registration uses this
 *   method so the LSP can bind the batch to `username@domain` without trusting
 *   caller-supplied identity data. Returns the native AsyncOrderNewResponse
 *   unchanged.
 * @property {() => void} shutdown - Idempotently release the node handle and
 *   destroy the signer.
 * @property {() => { signing: boolean, verification: boolean }} [getMessageSigningCapabilities] -
 *   Detect the native BIP-322 simple extension without constructing a handle.
 * @property {() => string} [getMessageSigningAddress] - Read the fixed owned
 *   first vanilla BIP86 address without allocating or rotating a script.
 * @property {(message: string, address: string) => string} [signMessageBip322] -
 *   Sign an exact UTF-8 message for the explicitly supplied owned address.
 * @property {(message: string, address: string, signature: string) => boolean} [verifyMessageBip322] -
 *   Public-key verification of a BIP-322 simple proof on the configured network.
 */

export {}
