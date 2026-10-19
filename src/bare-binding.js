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
//   uses it to construct a disk-backed `NativeExternalSigner`. RLN never
//   persists
//   the seed — the key-source file written by
//   `initWithNativeExternalSigner` only records identifying public
//   data (xpubs, node id, master fingerprint). On subsequent app
//   launches, the same mnemonic re-derives the same seedHex, which
//   re-derives the same signer identity, which matches the key-source
//   file on disk — while the VLS store preserves channel commitment state
//   across restarts.

import { assertVssConfigurationSafe, localVssStatus, validateVssBackup, validateVssBackupInfo, assertVssRecoveryScope, validateVssRestoreReceipt } from './vss-policy.js'
import { VssNotConfiguredError, AccountLockedError, VssError } from './errors.js'
import rln from '@utexo/rgb-lightning-node-bare'
import { retainSecret, revealSecret, secretMatches, wipeSecret } from './secret-buffer.js'
import { signerStoragePath } from './signer-storage-path.js'
import { normalizeUnlockRequest } from './node-unlock-request.js'
import { assertNativeRuntime } from './native-runtime-contract.js'
import { addressReuse } from './receive-address.js'
import { nativeSupportsBip322, requireBip322, validateBip322Message, validateBip322Address, validateBip322Signature } from './bip322-contract.js'

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

/** @typedef {import('./binding-interface.js').IRgbLightningBinding} IRgbLightningBinding */
/** @typedef {import('./binding-interface.js').RgbLightningBindingConfig} RgbLightningBindingConfig */

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
 *   4. `binding.ensureNode()`                    - cached SdkNode handle
 *   5. `binding.shutdown()`                      - idempotent stop
 *
 * @implements {IRgbLightningBinding}
 */
export class BareRgbLightningBinding {
  /**
   * Create a Bare runtime binding and stage its native init request.
   *
   * @param {RgbLightningBindingConfig} config - RGB Lightning node
   *   configuration.
   */
  constructor (config) {
    assertVssConfigurationSafe(config)
    assertNativeRuntime(rln)
    this._config = { ...config }
    this._closed = false
    this._initRequest = {
      storage_dir_path: config.dataDir,
      daemon_listening_port: config.daemonListeningPort ?? 0,
      ldk_peer_listening_port: config.ldkPeerListeningPort ?? 0,
      network: config.network,
      max_media_upload_size_mb: config.maxMediaUploadSizeMb ?? 5,
      enable_virtual_channels_v0: config.enableVirtualChannelsV0 ?? false,
      reuse_addresses: addressReuse(config)
    }
    // Trusted no-broadcast channels require virtual-channel support and an
    // explicit trust entry for the peer's node ID. Forward the trust list
    // only when configured.
    if (Array.isArray(config.virtualPeerPubkeys) && config.virtualPeerPubkeys.length > 0) {
      this._initRequest.virtual_peer_pubkeys = config.virtualPeerPubkeys
    }
    if (config.vssUrl !== undefined) {
      this._initRequest.vss_url = config.vssUrl
      this._initRequest.vss_allow_http = config.vssAllowHttp ?? false
      this._initRequest.vss_allow_empty_restore = config.vssAllowEmptyRestore ?? false
    }
    this._lastBackupVersion = null
    this._vssCheckpointFailed = false
    // LSP / APay wiring — needed for RLN's internal async-payments client
    // to reach the LSP's /internal/async_order/* endpoints from inside
    // `account.apayNew()` / `account.bootstrapLsp()`. Omit both to leave
    // APay disabled.
    if (config.lspBaseUrl) this._initRequest.lsp_base_url = config.lspBaseUrl
    if (config.lspBearerToken) this._initRequest.lsp_bearer_token = config.lspBearerToken
    /** @type {SdkNode | null} */
    this._node = null
    /** @type {NativeExternalSigner | null} */
    this._signer = null
    /** @type {NativeExternalSigner[]} Failed rollback handles retained for shutdown retry. */
    this._pendingSignerCleanup = []
    /** @type {Buffer | undefined} Zeroizable retained copy for idempotency checks. */
    this._seedHex = undefined
    /** @type {Buffer | undefined} Temporary legacy seed retained until first unlock. */
    this._fallbackSeedHex = undefined
    /** @type {boolean} */
    this._sdkInitDone = false
  }

  /**
   * Construct the native `SdkNode` once and return the cached handle.
   *
   * @returns {SdkNode} - The cached or newly created native node.
   */
  ensureNode () {
    if (this._closed) throw new Error('RGB Lightning binding is closed')
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
    if (this._closed) throw new Error('RGB Lightning binding is closed')
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
    this._signer = NativeExternalSigner.createWithStorage(
      seedHex,
      this._config.network,
      signerStoragePath(this._config.dataDir, this._config.signerStorageIdentity ?? 'primary'),
      this._config.permissiveSignerPolicy ?? false
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
    unlockRequest = normalizeUnlockRequest(unlockRequest)
    let node = this._initializeExternalNode()
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
      const fallbackSigner = NativeExternalSigner.createWithStorage(
        revealSecret(fallbackSeed),
        this._config.network,
        signerStoragePath(this._config.dataDir, 'legacy'),
        this._config.permissiveSignerPolicy ?? false
      )
      try {
        // A failed unlock may still have attached the primary signer. Retire
        // that node before revocation; a cancelled native node cannot be reused.
        node.shutdown()
        this._node = null
        this._signer.shutdown()
        this._signer.destroy()
      } catch (primaryDestroyError) {
        this._closed = true
        this._pendingSignerCleanup.push(fallbackSigner)
        try {
          fallbackSigner.shutdown()
          fallbackSigner.destroy()
          this._pendingSignerCleanup.pop()
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
      node = this.ensureNode()
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

  /** @private Initialize key-source identity without unlocking or creating an RGB wallet. */
  _initializeExternalNode () {
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
        if (!msg.startsWith('Rln(Conflict):')) throw e
      }
      this._sdkInitDone = true
    }
    return node
  }

  /** Download and promote an existing VSS snapshot before native wallet creation. */
  prepareVssRestore (expectedScope) {
    if (!this._config.vssUrl) throw new VssNotConfiguredError()
    assertVssRecoveryScope(this._config, expectedScope, () => this.bootstrap())
    const node = this._initializeExternalNode()
    return validateVssRestoreReceipt(node.prepareVssRestore(), this._config, this.bootstrap())
  }

  /** Read actual per-handle restore provenance; never infers it from cloud existence. */
  getVssRestoreInfo () {
    if (this._closed || !this._node) return null
    return validateVssRestoreReceipt(this._node.vssRestoreInfo(), this._config, this.bootstrap(), true)
  }

  /** Explicit takeover only. Native rejects takeover while this node is unlocked. */
  clearVssFence (password, expectedScope) {
    if (typeof password !== 'string') throw new TypeError('clearVssFence requires a string password')
    if (!this._config.vssUrl) throw new VssNotConfiguredError()
    assertVssRecoveryScope(this._config, expectedScope, () => this.bootstrap())
    this.ensureNode().vssClearFence({ password })
    return { ok: true }
  }

  /** Upload the current RGB backup. No whole-wallet atomicity is implied. */
  vssBackup () {
    if (!this._config.vssUrl) throw new VssNotConfiguredError()
    const node = this.ensureNode()
    validateVssBackup(node.vssBackup())
    // The upload's raw version may use a different object counter after crossing
    // the chunk threshold. Acknowledgement uses the canonical remote manifest.
    let info
    try {
      info = validateVssBackupInfo(node.vssBackupInfo())
      if (!info.backup_exists || info.version === null || info.backup_required) throw new Error()
    } catch (error) {
      throw new VssError('The RGB upload finished but its remote manifest could not be confirmed.', { cause: error })
    }
    this._lastBackupVersion = info.version
    this._vssCheckpointFailed = false
    return { version: info.version }
  }

  /** Observe actual native/remote RGB backup state. Requires an existing unlocked node. */
  getVssBackupInfo () {
    if (!this._config.vssUrl) throw new VssNotConfiguredError()
    if (this._closed || !this._node) throw new AccountLockedError('Unlock the RGB Lightning account before reading backup information.')
    const info = validateVssBackupInfo(this._node.vssBackupInfo())
    this._lastBackupVersion = info.version
    return {
      ...info,
      backup_required: info.backup_required || this._vssCheckpointFailed,
      last_auto_backup_failed: info.last_auto_backup_failed || this._vssCheckpointFailed
    }
  }

  /** Local status only; failed backups never advance the last successful version. */
  vssStatus () { return localVssStatus(this._config, this._lastBackupVersion) }

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
   * Register an APay hash batch with a signed Lightning Address attestation.
   *
   * @param {string} hostNodeId - LSP node ID.
   * @param {string} username - LSP-provisioned Lightning Address username.
   * @param {string} domain - LSP-provisioned Lightning Address domain.
   * @returns {object} - Native `AsyncOrderNewResponse`.
   * @throws {Error} - If the installed native wrapper predates this generated
   *   method or native APay registration fails.
   */
  apayNewWithAddress (hostNodeId, username, domain) {
    const node = this.ensureNode()
    if (typeof node.apayNewWithAddress !== 'function') {
      throw new Error(
        'Address-attested APay requires @utexo/rgb-lightning-node-bare ' +
        'with apayNewWithAddress support'
      )
    }
    return node.apayNewWithAddress(hostNodeId, username, domain)
  }

  /** Native feature support, without constructing an RLN node or signer. */
  getMessageSigningCapabilities () {
    const supported = nativeSupportsBip322(rln)
    return { signing: supported, verification: supported }
  }

  /** Fixed first vanilla BIP86 receive address; no allocation or rotation. */
  getMessageSigningAddress () {
    requireBip322(this, 'signing')
    return validateBip322Address(this.ensureNode().getMessageSigningAddress(), this._config.network)
  }

  signMessageBip322 (message, address) {
    validateBip322Message(message)
    validateBip322Address(address, this._config.network)
    requireBip322(this, 'signing')
    return validateBip322Signature(this.ensureNode().signMessageBip322(message, address), true)
  }

  verifyMessageBip322 (message, address, signature) {
    validateBip322Message(message)
    validateBip322Address(address, this._config.network)
    validateBip322Signature(signature)
    requireBip322(this, 'verification')
    const result = rln.verifyMessageBip322(message, address, signature, this._config.network)
    if (typeof result !== 'boolean') throw new Error('BIP-322 verifier returned an invalid result')
    return result
  }

  /**
   * Stop the node, revoke the signer and release its handle. Idempotent.
   *
   * @throws {Error} - If native node shutdown, signer revocation or handle release fails.
   */
  shutdown () {
    this._closed = true
    if (this._node) {
      // Keep both handles available for an explicit retry after failed shutdown.
      this._node.shutdown()
      this._node = null
    }
    this._sdkInitDone = false
    if (this._signer) {
      // Node shutdown drains operations and flushes state while signing is
      // still available. Revocation then releases private state in all clones.
      this._signer.shutdown()
      this._signer.destroy()
      this._signer = null
    }
    while (this._pendingSignerCleanup.length) {
      const signer = this._pendingSignerCleanup[0]
      signer.shutdown()
      signer.destroy()
      this._pendingSignerCleanup.shift()
    }
    wipeSecret(this._seedHex)
    wipeSecret(this._fallbackSeedHex)
    this._seedHex = undefined
    this._fallbackSeedHex = undefined
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
