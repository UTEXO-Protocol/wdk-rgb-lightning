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
 * @property {boolean} [enableVirtualChannelsV0] - Enable the
 *   virtual-channels-v0 protocol. Defaults to `false`. Production APay requires
 *   this together with `virtualPeerPubkeys` because mobile clients open
 *   `trusted_no_broadcast` virtual channels instead of standard channels.
 * @property {string[]} [virtualPeerPubkeys] - Hex-encoded, 33-byte compressed
 *   secp256k1 node IDs trusted for virtual channels. Defaults to an empty trust
 *   list, which disables virtual peering. For APay, set this to the LSP node ID.
 *   Forwarded to RLN as `virtual_peer_pubkeys`.
 * @property {boolean} [permissiveSignerPolicy] - Whether the in-process VLS
 *   signer uses its permissive policy filter. Defaults to `true`.
 * @property {string} [vssUrl] - VSS cloud-backup service URL. Omit to disable
 *   VSS. Only HTTPS and loopback HTTP URLs are accepted unless `vssAllowHttp`
 *   is enabled. Backup encryption is derived from the wallet seed, which is
 *   required for recovery.
 * @property {boolean} [vssAllowHttp] - Permit non-loopback VSS URLs to use
 *   plain HTTP. Defaults to `false` to avoid transmitting channel state in
 *   plaintext accidentally.
 * @property {boolean} [vssAllowEmptyRestore] - Continue with empty local state
 *   when VSS restore fails on a fresh device. Defaults to `false`; enable only
 *   when intentionally bootstrapping a new node without restored state.
 * @property {string} [lspBaseUrl] - Base URL for RLN's internal APay client.
 *   Required by `apayNew()` and `bootstrapLsp()`; omit to disable APay.
 * @property {string} [lspBearerToken] - Bearer token sent to the LSP's
 *   `/internal/*` endpoints. Omit when the LSP does not require authorization.
 *
 * Concrete WDK bindings always send RLN `reuse_addresses: true`. This keeps
 * inherited read-only `getAddress()` calls pinned to the current address;
 * callers use the full account's explicit `rotateAddress()` command when
 * needed.
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
 * @property {(password: string) => void} clearVssFence - Forcibly take over a
 *   stale VSS ownership fence after the previous node died holding it. Requires
 *   the wallet password and configured VSS. Only call this after confirming the
 *   previous owner is gone; two live owners can corrupt channel state.
 * @property {() => {version: number}} vssBackup - Force an immediate VSS
 *   backup flush. Returns `{ version }` where
 *   version is the snapshot index just persisted. Useful for app-
 *   controlled checkpoints (e.g. "save state before app suspend") rather than
 *   relying on the implicit on-write flush. Requires configured VSS and a
 *   successful server flush.
 * @property {() => { configured: boolean, url: string|null, allowHttp: boolean, lastBackupVersion: number|null }} vssStatus - Return
 *   local-view VSS status without a server round-trip: whether VSS was
 *   configured at construction, the URL + allow-http flag, and the
 *   version from the most recent `vssBackup()` this session. RLN's
 *   C-FFI exposes no read-only server-side backup-info query, so for
 *   a live server version call `vssBackup()`.
 * @property {(hostNodeId: string) => object} apayNew - Register this node
 *   with an LSP as an async-payments (APay) recipient.
 *   Used for offline-receive over Lightning Address: the wallet uploads
 *   a batch of pre-allocated payment hashes to the LSP, which then
 *   accepts payments addressed to those hashes on the wallet's behalf
 *   while the wallet is offline. Argument is the LSP's node_id (hex).
 *   Returns the AsyncOrderNewResponse from upstream PR #51.
 * @property {() => void} shutdown - Idempotently release the node handle and
 *   destroy the signer.
 */

export {}
