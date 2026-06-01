// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
'use strict'

// rgb-lightning-node-bare exports `SdkNode` (a class wrapping the C-FFI
// opaque handle) plus `NativeExternalSigner` (a VLS in-process signer
// helper) and a few module-level helpers. We re-export them through a
// thin binding wrapper so the WDK layer doesn't import the addon
// directly — keeping the same indirection pattern as wdk-wallet-rgb's
// `BareRgbLibBinding`.
//
// Seed handling:
//   The host (WDK) owns the BIP-39 mnemonic. The binding receives a
//   32-byte BIP-32 entropy (`seedHex`) derived from that mnemonic and
//   uses it to construct a `NativeExternalSigner`. RLN never persists
//   the seed — the key-source file written by
//   `initWithNativeExternalSigner` only records identifying public
//   data (xpubs, node id, master fingerprint). On subsequent app
//   launches, the same mnemonic re-derives the same seedHex, which
//   re-derives the same signer identity, which matches the key-source
//   file on disk — so the LDK node identity stays stable across
//   restarts.

import rln from '@utexo/rgb-lightning-node-bare'

const {
  SdkNode,
  NativeExternalSigner,
  uniffiHealthcheck,
  uniffiIsInitialized,
  sdkInitialize,
  sdkShutdown
} = rln

/**
 * @typedef {Object} BareRgbLightningBindingConfig
 * @property {'mainnet'|'testnet'|'regtest'|'signet'} network
 * @property {string} dataDir            - persistent SQLite + LDK channel state path
 * @property {number} [daemonListeningPort=0]
 * @property {number} [ldkPeerListeningPort=0]
 * @property {number} [maxMediaUploadSizeMb=5]
 * @property {boolean} [enableVirtualChannelsV0=false]
 * @property {boolean} [permissiveSignerPolicy=true] - VLS policy filter;
 *   pass `false` to enforce the full simple policy. Defaults to
 *   permissive for in-process use.
 * @property {string} [vssUrl]               - opt-in VSS cloud backup URL
 * @property {boolean} [vssAllowHttp=false]  - allow http:// for non-loopback
 * @property {boolean} [vssAllowEmptyRestore=false] - tolerate failed restore
 */

/**
 * Thin wrapper around `SdkNode` + `NativeExternalSigner`. Holds both
 * handles, centralises the JSON request shape for the lifecycle calls,
 * and swallows the expected `Rln(Conflict)` on second-and-subsequent
 * launches (key-source file already on disk).
 *
 * Lifecycle (called by the WDK manager / account):
 *   1. `new BareRgbLightningBinding(config)`     - stages init request
 *   2. `binding.attachExternalSigner(seedHex)`   - builds the signer
 *   3. `binding.unlock(unlockRequest)`           - first call: init+unlock
 *                                                  next:        attach+unlock
 *   4. `binding.node`                            - SdkNode (after unlock)
 *   5. `binding.shutdown()`                      - idempotent stop
 */
export class BareRgbLightningBinding {
  /** @param {BareRgbLightningBindingConfig} config */
  constructor (config) {
    this._config = config
    this._initRequest = {
      storage_dir_path: config.dataDir,
      daemon_listening_port: config.daemonListeningPort ?? 0,
      ldk_peer_listening_port: config.ldkPeerListeningPort ?? 0,
      network: config.network,
      max_media_upload_size_mb: config.maxMediaUploadSizeMb ?? 5,
      enable_virtual_channels_v0: config.enableVirtualChannelsV0 ?? false
    }
    // VSS fields are only forwarded when the host opts in. Omitting them
    // lets the RLN-side `#[serde(default)]` keep VSS fully disabled.
    if (config.vssUrl) this._initRequest.vss_url = config.vssUrl
    if (config.vssAllowHttp) this._initRequest.vss_allow_http = true
    if (config.vssAllowEmptyRestore) this._initRequest.vss_allow_empty_restore = true
    /** @type {SdkNode | null} */
    this._node = null
    /** @type {NativeExternalSigner | null} */
    this._signer = null
    /** @type {boolean} */
    this._sdkInitDone = false
  }

  /**
   * Construct the `SdkNode`. Idempotent.
   * @returns {SdkNode}
   */
  ensureNode () {
    if (!this._node) {
      this._node = SdkNode.create(this._initRequest)
    }
    return this._node
  }

  /**
   * Build the in-process VLS signer from a host-supplied 32-byte seed.
   * Must be called before `unlock()`. Idempotent — repeat calls with
   * the same seed are no-ops; calling with a different seed mid-session
   * throws (would imply a wallet swap and invalidate the on-disk
   * key-source file).
   *
   * @param {string} seedHex - 64-char hex string (32 BIP-32 entropy bytes)
   */
  attachExternalSigner (seedHex) {
    if (this._signer) {
      if (this._seedHex && this._seedHex !== seedHex) {
        throw new Error(
          'attachExternalSigner: a different signer is already attached. ' +
          'Shut down the binding before re-attaching with a new seed.'
        )
      }
      return
    }
    this._signer = NativeExternalSigner.create(
      seedHex,
      this._config.network,
      this._config.permissiveSignerPolicy ?? true
    )
    this._seedHex = seedHex
  }

  /**
   * Bring the node online. On the first call against a fresh dataDir,
   * runs `initWithNativeExternalSigner` to write the key-source file;
   * on subsequent calls (key-source already on disk) RLN throws
   * `Rln(Conflict)` from init which we swallow as the expected
   * "already-initialised" signal. Then runs
   * `unlockWithNativeExternalSigner` which attaches + unlocks in one
   * call.
   *
   * @param {Object} unlockRequest - JsonSdkExternalUnlockRequest
   *   (bitcoind RPC creds + indexer + proxy; no password)
   */
  unlock (unlockRequest) {
    const node = this.ensureNode()
    if (!this._signer) {
      throw new Error('attachExternalSigner(seedHex) must be called before unlock()')
    }
    if (!this._sdkInitDone) {
      try {
        node.initWithNativeExternalSigner(this._signer)
      } catch (e) {
        const msg = String(e && e.message ? e.message : e)
        // Rln(Conflict) on init is the "already-initialised on disk"
        // signal — expected on every relaunch after the first wallet
        // create. Anything else is a real failure.
        if (!msg.includes('Conflict')) throw e
      }
      this._sdkInitDone = true
    }
    node.unlockWithNativeExternalSigner(this._signer, unlockRequest)
  }

  /** @returns {SdkNode} */
  get node () {
    if (!this._node) throw new Error('SdkNode not created — call unlock() first')
    return this._node
  }

  /**
   * Returns the bootstrap dictionary for the currently-attached signer
   * (node_id, xpubs, master_fingerprint). Throws if no signer attached.
   */
  bootstrap () {
    if (!this._signer) {
      throw new Error('attachExternalSigner(seedHex) must be called before bootstrap()')
    }
    return this._signer.bootstrap()
  }

  /**
   * Take over a stale VSS ownership fence after a previous node died
   * holding it. Authenticates with the wallet password. Throws
   * `Rln(FailedVssInit)` if VSS isn't configured or the takeover fails.
   *
   * @param {string} password
   */
  clearVssFence (password) {
    const node = this.ensureNode()
    node.vssClearFence({ password })
  }

  /**
   * Register this node with an LSP as an async-payments (APay) recipient.
   * Used for offline-receive over Lightning Address — the wallet uploads
   * a batch of pre-allocated payment hashes to the LSP, which then
   * accepts payments addressed to those hashes on the wallet's behalf
   * while the wallet is offline.
   *
   * @param {string} hostNodeId  - LSP's node_id (hex, 33-byte compressed secp256k1)
   * @returns {object}  AsyncOrderNewResponse — request_id, host_node_id,
   *   protocol_version, order_id, status, accepted_through_index,
   *   next_index_expected, unused_hashes, refill_batch_size, first_hash_index
   */
  apayNew (hostNodeId) {
    const node = this.node
    return node.apayNew(hostNodeId)
  }

  /**
   * Register with an LSP as an APay (async-payments) recipient. The
   * wallet uploads a batch of pre-allocated payment hashes to the LSP;
   * the LSP then accepts Lightning payments addressed to those hashes
   * on the wallet's behalf, even while the wallet is offline.
   *
   * @param {string} hostNodeId - the LSP's node_id (hex, compressed secp256k1)
   * @returns {object} AsyncOrderNewResponse — request_id, host_node_id,
   *   protocol_version, order_id, status, accepted_through_index,
   *   next_index_expected, unused_hashes, refill_batch_size, first_hash_index
   */
  apayNew (hostNodeId) {
    const node = this.ensureNode()
    return node.apayNew(hostNodeId)
  }

  /** Best-effort shutdown. Idempotent. */
  shutdown () {
    if (this._node) {
      this._node.shutdown()
      this._node = null
    }
    if (this._signer) {
      this._signer.destroy()
      this._signer = null
    }
    this._sdkInitDone = false
  }

  /** @returns {string} */
  static healthcheck () { return uniffiHealthcheck() }

  /** @returns {boolean} */
  static isInitialized () { return uniffiIsInitialized() }

  /** @param {Object} request - module-level JsonSdkInitRequest */
  static initialize (request) { return sdkInitialize(request) }

  /** Module-level shutdown (releases the static tokio runtime). */
  static shutdownGlobal () { return sdkShutdown() }
}
