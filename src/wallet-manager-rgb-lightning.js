// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
'use strict'

import WalletManager from '@tetherto/wdk-wallet'
import { mnemonicToSeedSync } from 'bip39'
import WalletAccountRgbLightning from './wallet-account-rgb-lightning.js'

const MEMPOOL_SPACE_URL = 'https://mempool.space'

/** @typedef {import('@tetherto/wdk-wallet').FeeRates} FeeRates */
/** @typedef {import('./binding-interface.js').IRgbLightningBinding} IRgbLightningBinding */
/** @typedef {import('./binding-interface.js').RgbLightningBindingConfig} RgbLightningBindingConfig */

/**
 * @typedef {RgbLightningBindingConfig & {
 *   bitcoindRpcUsername?: string,
 *   bitcoindRpcPassword?: string,
 *   bitcoindRpcHost?: string,
 *   bitcoindRpcPort?: number,
 *   indexerUrl?: string,
 *   proxyEndpoint?: string,
 *   announceAddresses?: string[],
 *   announceAlias?: string
 * }} RgbLightningWalletConfig
 */

/**
 * Derive the 32-byte node entropy that gets handed to
 * `NativeExternalSigner` from a BIP-39 mnemonic.
 *
 * Approach: take the first 32 bytes of the BIP-39 PBKDF2 seed
 * (no passphrase). This is deterministic, stable across launches,
 * and matches the convention RLN's `NativeExternalSigner::new`
 * expects (`Vec<u8>::from_hex` → 32-byte VLS seed). The remaining
 * 32 bytes of the 64-byte BIP-39 seed are unused here — VLS
 * derives all subkeys it needs from this entropy via its own KDF
 * (`KeyDerivationStyle::Ldk`).
 *
 * @param {string} mnemonic - BIP-39 mnemonic phrase
 * @returns {string} 64-char hex string (the 32 entropy bytes)
 */
function mnemonicToNodeSeedHex (mnemonic) {
  if (typeof mnemonic !== 'string' || mnemonic.trim().length === 0) {
    throw new Error('RGB Lightning wallet requires a BIP-39 mnemonic seed phrase')
  }
  const seed = mnemonicToSeedSync(mnemonic, '')
  // Web-style Buffer (bare-node-runtime polyfill) supports .subarray + .toString.
  const first32 = seed.subarray(0, 32)
  return Buffer.from(first32).toString('hex')
}

/**
 * RGB Lightning wallet manager.
 *
 * Mirrors `WalletManagerRgb`'s shape but for the LN node. Only one
 * account (index 0) is supported — rgb-lightning-node owns a single
 * LDK node per dataDir.
 *
 * Seed handling:
 *   The WDK secret manager owns the BIP-39 mnemonic. We never persist
 *   the mnemonic ourselves — we derive a 32-byte VLS node entropy
 *   from it on demand and hand it to RLN's `NativeExternalSigner`,
 *   which runs the VLS signer entirely in-process. RLN's on-disk
 *   state only contains identifying public data (xpubs, node id,
 *   master fingerprint via the key-source file), never the seed.
 */
export default class WalletManagerRgbLightning extends WalletManager {
  /**
   * Subclasses (one per runtime) override this static getter to point
   * at the binding implementation that works in their environment.
   * The base class is intentionally abstract — call sites should pull
   * a concrete class from `./index-bare.js` or `./index-node.js`.
   *
   * @returns {new (config: RgbLightningBindingConfig) => IRgbLightningBinding}
   */
  static get Binding () {
    throw new Error(
      'WalletManagerRgbLightning is abstract — import from ' +
      "'@utexo/wdk-rgb-lightning' (Node) or via the bare conditional " +
      'export (RN/bare worklet) so the right binding is wired automatically.'
    )
  }

  /**
   * @param {string | Uint8Array} seed - BIP-39 mnemonic phrase (string)
   *   or a Uint8Array carrying the same. Inherited from WDK's
   *   `WalletManager` contract.
   * @param {RgbLightningWalletConfig} config
   */
  constructor (seed, config = {}) {
    super(seed, config)

    if (!config.network) throw new Error('network configuration is required.')
    if (!config.dataDir) {
      throw new Error(
        'dataDir is required — pass a persistent, app-private path for ' +
        "rgb-lightning-node's SQLite + LDK state."
      )
    }

    /** @private */ this._network = config.network
    /** @private @type {IRgbLightningBinding | null} */
    this._binding = null
  }

  /**
   * Returns the (only) account. RGB Lightning is single-account.
   *
   * @param {number} [index]
   * @returns {Promise<WalletAccountRgbLightning>}
   */
  async getAccount (index = 0) {
    if (index !== 0) {
      throw new Error('RGB Lightning wallets only support account index 0.')
    }
    if (!this._accounts[index]) {
      const Binding = this.constructor.Binding
      const binding = new Binding({
        network: this._network,
        dataDir: this._config.dataDir,
        daemonListeningPort: this._config.daemonListeningPort,
        ldkPeerListeningPort: this._config.ldkPeerListeningPort,
        maxMediaUploadSizeMb: this._config.maxMediaUploadSizeMb,
        enableVirtualChannelsV0: this._config.enableVirtualChannelsV0,
        permissiveSignerPolicy: this._config.permissiveSignerPolicy,
        vssUrl: this._config.vssUrl,
        vssAllowHttp: this._config.vssAllowHttp,
        vssAllowEmptyRestore: this._config.vssAllowEmptyRestore,
        lspBaseUrl: this._config.lspBaseUrl,
        lspBearerToken: this._config.lspBearerToken
      })
      this._binding = binding

      // Attach the external signer once at account creation. The
      // actual VLS-derived node identity is fixed by this seed — the
      // RN-side `unlock()` call then brings LDK + bitcoind online
      // using the bootstrap that's already on disk (or writes it if
      // this is a fresh dataDir).
      const mnemonic = typeof this.seed === 'string'
        ? this.seed
        : Buffer.from(this.seed).toString('utf8')
      const seedHex = mnemonicToNodeSeedHex(mnemonic)
      binding.attachExternalSigner(seedHex)

      this._accounts[index] = new WalletAccountRgbLightning({ binding })
    }
    return this._accounts[index]
  }

  /**
   * @param {string} _path
   * @returns {Promise<never>}
   */
  async getAccountByPath (_path) {
    throw new Error('Method not supported on RGB Lightning')
  }

  /**
   * @returns {Promise<FeeRates>}
   */
  async getFeeRates () {
    const response = await fetch(`${MEMPOOL_SPACE_URL}/api/v1/fees/recommended`)
    const { fastestFee, hourFee } = await response.json()
    return {
      normal: BigInt(hourFee),
      fast: BigInt(fastestFee)
    }
  }

  dispose () {
    if (this._binding) {
      this._binding.shutdown()
      this._binding = null
    }
    super.dispose()
  }
}
