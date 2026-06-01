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

const {
  SdkNode,
  NativeExternalSigner,
  uniffiHealthcheck,
  uniffiIsInitialized,
  sdkInitialize,
  sdkShutdown
} = rln

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
      enable_virtual_channels_v0: config.enableVirtualChannelsV0 ?? false
    }
    // VSS fields are only forwarded when the host opts in. Omitting them
    // lets the RLN-side `#[serde(default)]` keep VSS fully disabled.
    if (config.vssUrl) this._initRequest.vss_url = config.vssUrl
    if (config.vssAllowHttp) this._initRequest.vss_allow_http = true
    if (config.vssAllowEmptyRestore) this._initRequest.vss_allow_empty_restore = true
    /** @type {unknown | null} */
    this._node = null
    /** @type {unknown | null} */
    this._signer = null
    /** @type {boolean} */
    this._sdkInitDone = false
  }

  ensureNode () {
    if (!this._node) {
      this._node = SdkNode.create(this._initRequest)
    }
    return this._node
  }

  /** @param {string} seedHex */
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
    node.unlockWithNativeExternalSigner(this._signer, unlockRequest)
  }

  get node () {
    if (!this._node) throw new Error('SdkNode not created — call unlock() first')
    return this._node
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
    return this.node.vssBackup()
  }

  /**
   * Register this node with an LSP as an async-payments (APay) recipient.
   *
   * @param {string} hostNodeId  - LSP's node_id (hex)
   * @returns {object}  AsyncOrderNewResponse from upstream PR #51
   */
  apayNew (hostNodeId) {
    const node = this.node
    return node.apayNew(hostNodeId)
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

  static healthcheck () { return uniffiHealthcheck() }
  static isInitialized () { return uniffiIsInitialized() }
  static initialize (request) { return sdkInitialize(request) }
  static shutdownGlobal () { return sdkShutdown() }
}
