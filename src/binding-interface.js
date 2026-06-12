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
 *   Enable virtual-channels-v0. REQUIRED (together with
 *   `virtualPeerPubkeys`) for async-payments (APay) against a
 *   production LSP — mobile clients reject standard channels and must
 *   open `trusted_no_broadcast` virtual channels.
 * @property {string[]} [virtualPeerPubkeys]
 *   Trust list of peer node_ids (hex, 33-byte compressed secp256k1)
 *   allowed to open / receive `trusted_no_broadcast` virtual channels
 *   with this node. For APay this is the LSP's node_id:
 *   `virtualPeerPubkeys: [lspNodeId]`. RLN's `allows_peer` rejects a
 *   virtual channel whose counterparty isn't in this list. Omit (or
 *   empty) to disable virtual peering. Forwarded as
 *   `virtual_peer_pubkeys` in the init request.
 * @property {boolean} [permissiveSignerPolicy=true]
 * @property {string}  [vssUrl]
 *   Enables VSS cloud backup. Setting it points the node at a remote
 *   key-value store that mirrors LDK channel state + RGB wallet data
 *   in near-real-time. The encryption key is derived from the BIP-39
 *   mnemonic, so recovery requires the original seed. Leave undefined
 *   to disable VSS (default). Only `https://` URLs (or loopback http)
 *   are accepted unless `vssAllowHttp` is set.
 * @property {boolean} [vssAllowHttp=false]
 *   Permit plain `http://` for non-loopback hosts. Off by default so
 *   channel state can't be sent in plaintext to an untrusted server
 *   by accident.
 * @property {boolean} [vssAllowEmptyRestore=false]
 *   On a fresh device, start with empty local state if the VSS
 *   restore step fails (e.g. server unreachable). Off by default —
 *   set true only when bootstrapping a new node from scratch and you
 *   accept that any previously-backed-up state will not be pulled in.
 * @property {string}  [lspBaseUrl]
 *   LSP base URL used by RLN's *internal* APay client when this node
 *   acts as an async-payments recipient. Required for `account.apayNew()`
 *   and `account.bootstrapLsp()` round-trips to reach the LSP's
 *   `/internal/async_order/*` endpoints. Omit to disable APay.
 * @property {string}  [lspBearerToken]
 *   Bearer token sent on requests to the LSP's `/internal/*` endpoints.
 *   Must match the LSP's `APAY_BEARER_TOKEN` config. Omit if the LSP
 *   doesn't require auth (some dev setups).
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
 * @property {(password: string) => void}               clearVssFence
 *   Forcibly take over a stale VSS ownership fence after the previous
 *   node died holding it. Requires the wallet password (the same one
 *   used at unlock). Throws if VSS isn't configured. Pointing two
 *   live nodes at the same VSS store corrupts state — only call this
 *   when you're certain the previous owner is gone.
 * @property {() => {version: number}}                   vssBackup
 *   Force an immediate VSS backup flush. Returns `{ version }` where
 *   version is the snapshot index just persisted. Useful for app-
 *   controlled checkpoints (e.g. "save state before app suspend")
 *   rather than relying on the implicit on-write flush. Throws if
 *   VSS isn't configured (no `vssUrl` at construction) or the flush
 *   fails (server unreachable, auth rejected, etc.).
 * @property {() => { configured: boolean, url: string|null, allowHttp: boolean, lastBackupVersion: number|null }} vssStatus
 *   Local-view VSS status (no server round-trip): whether VSS was
 *   configured at construction, the URL + allow-http flag, and the
 *   version from the most recent `vssBackup()` this session. RLN's
 *   C-FFI exposes no read-only server-side backup-info query, so for
 *   a live server version call `vssBackup()`.
 * @property {(hostNodeId: string) => object}           apayNew
 *   Register this node with an LSP as an async-payments (APay) recipient.
 *   Used for offline-receive over Lightning Address: the wallet uploads
 *   a batch of pre-allocated payment hashes to the LSP, which then
 *   accepts payments addressed to those hashes on the wallet's behalf
 *   while the wallet is offline. Argument is the LSP's node_id (hex).
 *   Returns the AsyncOrderNewResponse from upstream PR #51.
 * @property {() => void}                               shutdown
 *   Idempotent stop — releases the node handle + destroys the signer.
 */

export const __SHAPE_ONLY = true
