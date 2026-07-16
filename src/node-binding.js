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

/** @implements {import('./binding-interface.js').IRgbLightningBinding} */
export class NodeRgbLightningBinding {
  /** @param {RgbLightningBindingConfig} config */
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
    /** @type {unknown | null} */
    this._node = null
    /** @type {unknown | null} */
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

  ensureNode () {
    if (!this._node) {
      this._node = SdkNode.create(this._initRequest)
    }
    return this._node
  }

  /** @param {string} seedHex */
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

  /** @param {object} unlockRequest */
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
      this._signer.destroy()
      this._signer = fallbackSigner
      wipeSecret(this._seedHex)
      this._seedHex = fallbackSeed
      this._fallbackSeedHex = undefined
      node.unlockWithNativeExternalSigner(this._signer, unlockRequest)
    }
  }

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
   * Force an immediate VSS backup flush. Returns `{ version }`.
   * Mirror of the bare binding's vssBackup. See bare-binding.js for
   * the full contract.
   *
   * @returns {{version: number}}
   */
  vssBackup () {
    const node = this.ensureNode()
    const r = node.vssBackup()
    if (r && typeof r.version === 'number') this._lastVssVersion = r.version
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
   * @returns {{ configured: boolean, url: string|null, allowHttp: boolean, lastBackupVersion: number|null }}
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
   * Register with an LSP as an APay (async-payments) recipient. See
   * BareRgbLightningBinding.apayNew for the full contract.
   *
   * @param {string} hostNodeId
   * @returns {object} AsyncOrderNewResponse
   */
  apayNew (hostNodeId) {
    const node = this.ensureNode()
    return node.apayNew(hostNodeId)
  }

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

  static healthcheck () { return uniffiHealthcheck() }
  static isInitialized () { return uniffiIsInitialized() }
  static initialize (request) { return sdkInitialize(request) }
  static shutdownGlobal () { return sdkShutdown() }
}
