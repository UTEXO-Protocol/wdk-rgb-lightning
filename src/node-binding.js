// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
'use strict'

// Node implementation of IRgbLightningBinding. Wraps
// `@utexo/rgb-lightning-node-nodejs` (napi-rs addon over the same
// `rln-c-ffi` static lib the bare addon uses on RN). Surface kept in
// lockstep with `bare-binding.js` so the WDK layer is identical across
// runtimes — see binding-interface.js for the contract.

import rln from '@utexo/rgb-lightning-node-nodejs'
import { retainSecret, revealSecret, secretMatches, wipeSecret } from './secret-buffer.js'

const {
  SdkNode,
  NativeExternalSigner,
  uniffiHealthcheck,
  uniffiIsInitialized,
  sdkInitialize,
  sdkShutdown
} = rln

function isExternalSignerIdentityMismatch (message) {
  return message.includes('Rln(ExternalSignerMismatch)') ||
    /external signer identity does not match persisted (?:node identity|key_source\.json)/i.test(message)
}

/** @typedef {import('./binding-interface.js').RgbLightningBindingConfig} RgbLightningBindingConfig */
/** @typedef {import('./binding-interface.js').IRgbLightningBinding} IRgbLightningBinding */
/** @typedef {import('@utexo/rgb-lightning-node-nodejs').SdkNode} SdkNodeHandle */
/** @typedef {import('@utexo/rgb-lightning-node-nodejs').NativeExternalSigner} NativeExternalSignerHandle */

/**
 * Thin Node.js wrapper around `SdkNode` and `NativeExternalSigner`. It keeps
 * the native handles together, centralizes lifecycle request shaping, and
 * treats the expected init conflict on an existing data directory as an
 * already-initialized signal.
 *
 * @implements {IRgbLightningBinding}
 */
export class NodeRgbLightningBinding {
  /**
   * Create a Node.js binding and stage its native init request.
   *
   * @param {RgbLightningBindingConfig} config - RGB Lightning node
   *   configuration.
   */
  constructor (config) {
    this._config = config
    this._initRequest = {
      storage_dir_path: config.dataDir,
      daemon_listening_port: config.daemonListeningPort ?? 0,
      ldk_peer_listening_port: config.ldkPeerListeningPort ?? 0,
      network: config.network,
      max_media_upload_size_mb: config.maxMediaUploadSizeMb ?? 5,
      enable_virtual_channels_v0: config.enableVirtualChannelsV0 ?? false,
      // WDK reads must not allocate a fresh address on every call. Pin the
      // current address; full accounts rotate it explicitly.
      reuse_addresses: true
    }
    // Virtual-channels-v0 trust list. When the LSP opens (or the device
    // opens against the LSP) a `trusted_no_broadcast` virtual channel,
    // the device must list the LSP's node_id here or RLN's `allows_peer`
    // rejects the channel. Production APay requires this — see Yurii's
    // Signet LSP setup: every mobile client sets enableVirtualChannelsV0
    // + virtualPeerPubkeys=[LSP node_id]. Forwarded only when non-empty.
    if (Array.isArray(config.virtualPeerPubkeys) && config.virtualPeerPubkeys.length > 0) {
      this._initRequest.virtual_peer_pubkeys = config.virtualPeerPubkeys
    }
    // VSS fields are only forwarded when the host opts in. Omitting them
    // lets the RLN-side `#[serde(default)]` keep VSS fully disabled.
    if (config.vssUrl) this._initRequest.vss_url = config.vssUrl
    if (config.vssAllowHttp) this._initRequest.vss_allow_http = true
    if (config.vssAllowEmptyRestore) this._initRequest.vss_allow_empty_restore = true
    // LSP / APay wiring — see BareRgbLightningBinding for the contract.
    if (config.lspBaseUrl) this._initRequest.lsp_base_url = config.lspBaseUrl
    if (config.lspBearerToken) this._initRequest.lsp_bearer_token = config.lspBearerToken
    /** @type {SdkNodeHandle | null} */
    this._node = null
    /** @type {NativeExternalSignerHandle | null} */
    this._signer = null
    /** @type {Buffer | undefined} Zeroizable retained copy for idempotency checks. */
    this._seedHex = undefined
    /** @type {Buffer | undefined} Temporary legacy seed retained until first unlock. */
    this._fallbackSeedHex = undefined
    /** @type {boolean} */
    this._sdkInitDone = false
    /** @type {number | null} Snapshot version returned by the most recent vssBackup(). */
    this._lastVssVersion = null
  }

  /**
   * Construct the native `SdkNode` once and return the cached handle.
   *
   * @returns {SdkNodeHandle} - The cached or newly created native node.
   */
  ensureNode () {
    if (!this._node) {
      this._node = SdkNode.create(this._initRequest)
    }
    return this._node
  }

  /**
   * Build the in-process VLS signer from host-supplied seed material. Repeat
   * calls with the same seed are no-ops; a different seed is rejected to avoid
   * swapping wallets against the persisted key-source identity.
   *
   * @param {string} seedHex - 64-character hex string containing 32 bytes of
   *   BIP-32 entropy.
   * @param {string} [fallbackSeedHex] - Legacy identity fallback for existing
   *   data directories.
   * @throws {Error} - If a different signer is already attached or native
   *   signer construction fails.
   */
  attachExternalSigner (seedHex, fallbackSeedHex) {
    if (this._signer) {
      if (this._seedHex && !secretMatches(this._seedHex, seedHex)) {
        throw new Error(
          'attachExternalSigner: a different signer is already attached. ' +
          'Shut down the binding before re-attaching with a new seed.'
        )
      }
      if (fallbackSeedHex) {
        wipeSecret(this._fallbackSeedHex)
        this._fallbackSeedHex = retainSecret(fallbackSeedHex)
      }
      return
    }
    this._signer = NativeExternalSigner.create(
      seedHex,
      this._config.network,
      this._config.permissiveSignerPolicy ?? true
    )
    wipeSecret(this._seedHex)
    wipeSecret(this._fallbackSeedHex)
    this._seedHex = retainSecret(seedHex)
    this._fallbackSeedHex = retainSecret(fallbackSeedHex)
  }

  /**
   * Initialize or reattach the signer, then bring the native node online. An
   * init conflict on an existing data directory is treated as the expected
   * already-initialized signal before unlock proceeds.
   *
   * @param {object} unlockRequest - Native `JsonSdkExternalUnlockRequest`
   *   containing backend connection settings.
   * @throws {Error} - If no signer is attached or native initialization or
   *   unlock fails.
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
        if (!msg.includes('Conflict')) throw e
      }
      this._sdkInitDone = true
    }
    try {
      node.unlockWithNativeExternalSigner(this._signer, unlockRequest)
      wipeSecret(this._fallbackSeedHex)
      this._fallbackSeedHex = undefined
    } catch (error) {
      const message = String(error && error.message ? error.message : error)
      if (!this._fallbackSeedHex || !isExternalSignerIdentityMismatch(message)) {
        throw error
      }

      const fallbackSeed = this._fallbackSeedHex
      const fallbackSigner = NativeExternalSigner.create(
        revealSecret(fallbackSeed),
        this._config.network,
        this._config.permissiveSignerPolicy ?? true
      )
      try {
        this._signer.destroy()
      } catch (primaryDestroyError) {
        try {
          fallbackSigner.destroy()
        } catch (fallbackDestroyError) {
          throw new AggregateError(
            [primaryDestroyError, fallbackDestroyError],
            'unlock: failed to destroy both the primary and fallback signers'
          )
        }
        throw primaryDestroyError
      }
      this._signer = fallbackSigner
      wipeSecret(this._seedHex)
      this._seedHex = fallbackSeed
      this._fallbackSeedHex = undefined
      node.unlockWithNativeExternalSigner(this._signer, unlockRequest)
    }
  }

  /**
   * Return the bootstrap dictionary for the currently attached signer.
   *
   * @returns {object} - Native external-signer bootstrap payload.
   * @throws {Error} - If no signer is attached or bootstrap generation fails.
   */
  bootstrap () {
    if (!this._signer) {
      throw new Error('attachExternalSigner(seedHex) must be called before bootstrap()')
    }
    return this._signer.bootstrap()
  }

  /**
   * Take over a stale VSS ownership fence after a previous node died
   * holding it. Authenticates with the wallet password.
   *
   * @param {string} password - Wallet password used to authenticate the VSS
   *   fence takeover.
   * @throws {Error} - If VSS is not configured or the native takeover fails.
   */
  clearVssFence (password) {
    const node = this.ensureNode()
    node.vssClearFence({ password })
  }

  /**
   * Force an immediate VSS backup flush. Returns the snapshot index just
   * persisted, allowing app-controlled checkpoints instead of relying only on
   * implicit on-write flushes.
   *
   * @returns {{version: number}} - Persisted VSS snapshot version.
   * @throws {Error} - If VSS is not configured or the backup flush fails.
   */
  vssBackup () {
    const node = this.ensureNode()
    const r = node.vssBackup()
    if (r && typeof r === 'object' && 'version' in r && typeof r.version === 'number') {
      this._lastVssVersion = r.version
    }
    return r
  }

  /**
   * Local-view VSS status. RLN's C-FFI exposes no read-only
   * server-side backup-info query (unlike rgb-lib's `vssBackupInfo`),
   * so this reports what the host can know without a round-trip:
   * whether VSS was configured at construction, the configured URL +
   * allow-http flag, and the snapshot version from the most recent
   * `vssBackup()` call this session (`null` if none yet). For a live
   * server version, call `vssBackup()` (it flushes and returns the
   * fresh `{ version }`).
   *
   * @returns {{ configured: boolean, url: string|null, allowHttp: boolean, lastBackupVersion: number|null }} - Local
   *   VSS configuration and last observed backup version.
   */
  vssStatus () {
    return {
      configured: !!this._config.vssUrl,
      url: this._config.vssUrl ?? null,
      allowHttp: !!this._config.vssAllowHttp,
      lastBackupVersion: this._lastVssVersion
    }
  }

  /**
   * Register this node with an LSP as an APay recipient so the LSP can accept
   * Lightning payments for it while it is offline.
   *
   * @param {string} hostNodeId - LSP node ID (hex-encoded, 33-byte compressed
   *   secp256k1 public key).
   * @returns {object} - Native `AsyncOrderNewResponse`.
   * @throws {Error} - If native APay registration fails.
   */
  apayNew (hostNodeId) {
    const node = this.ensureNode()
    return node.apayNew(hostNodeId)
  }

  /**
   * Stop the node and destroy the signer. The operation is idempotent.
   *
   * @throws {Error} - If native node shutdown or signer destruction fails.
   */
  shutdown () {
    let failure
    if (this._node) {
      try {
        this._node.shutdown()
      } catch (error) {
        failure = error
      } finally {
        this._node = null
      }
    }
    if (this._signer) {
      try {
        this._signer.destroy()
      } catch (error) {
        failure ??= error
      } finally {
        this._signer = null
      }
    }
    this._sdkInitDone = false
    wipeSecret(this._seedHex)
    wipeSecret(this._fallbackSeedHex)
    this._seedHex = undefined
    this._fallbackSeedHex = undefined
    if (failure) throw failure
  }

  /** @returns {string} - Native module health status. */
  static healthcheck () { return uniffiHealthcheck() }

  /** @returns {boolean} - Whether the native SDK is globally initialized. */
  static isInitialized () { return uniffiIsInitialized() }

  /** @param {object} request - Module-level `JsonSdkInitRequest`. */
  static initialize (request) { return sdkInitialize(request) }

  /** Release the native module's global runtime. */
  static shutdownGlobal () { return sdkShutdown() }
}
