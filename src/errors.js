// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
'use strict'

// Typed error hierarchy for @utexo/wdk-rgb-lightning.
//
// Most of the wallet surface forwards directly to rgb-lightning-node
// (RLN) via the C-FFI, and RLN reports failures as `Rln(<Variant>):
// <message>` strings. Without a typed wrapper, callers are forced to
// substring-match those strings to branch on failure mode — brittle
// and version-coupled. These classes give callers a stable `name` +
// `code` to switch on while preserving the original RLN message
// verbatim (so any existing substring checks keep working) and the
// underlying error as `cause`.
//
// Mirrors the shape of `LspError` (see lsp-client.js): a base class
// with `name`/`code`/`cause` + `toJSON()` for structured logging, and
// purpose-specific subclasses for the boundaries we wrap.

/**
 * Base class for all errors raised by this SDK. Carries a stable
 * machine-readable `code`, the optional originating `cause`, and a
 * `toJSON()` for structured logging.
 */
export class RgbLightningError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: string, cause?: unknown }} [opts]
   */
  constructor (message, opts = {}) {
    super(message)
    this.name = 'RgbLightningError'
    /** Stable, machine-readable error code. */
    this.code = opts.code ?? 'RGB_LIGHTNING_ERROR'
    if (opts.cause !== undefined) this.cause = opts.cause
  }

  toJSON () {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      cause: this.cause instanceof Error
        ? { name: this.cause.name, message: this.cause.message }
        : (this.cause ?? null)
    }
  }
}

/**
 * Raised when bringing the node online (`unlock`) fails — bad
 * bitcoind/indexer/proxy credentials, an unreachable backend, or a
 * VSS init/restore failure surfaced during unlock.
 */
export class UnlockError extends RgbLightningError {
  constructor (message, opts = {}) {
    super(message, { code: opts.code ?? 'UNLOCK_FAILED', cause: opts.cause })
    this.name = 'UnlockError'
  }
}

/**
 * Raised for VSS (cloud backup) operations: a flush that fails, a
 * fence takeover that's rejected, or any other VSS-server interaction
 * error. See {@link VssNotConfiguredError} for the specific case where
 * VSS was never configured at construction.
 */
export class VssError extends RgbLightningError {
  constructor (message, opts = {}) {
    super(message, { code: opts.code ?? 'VSS_ERROR', cause: opts.cause })
    this.name = 'VssError'
  }
}

/**
 * Raised when a VSS operation is attempted on a wallet that was
 * constructed without a `vssUrl`. Distinct from {@link VssError} so
 * callers can tell "you forgot to enable VSS" apart from "the VSS
 * server rejected the request".
 */
export class VssNotConfiguredError extends VssError {
  constructor (message = 'VSS is not configured — construct the wallet with a vssUrl to enable cloud backup.', opts = {}) {
    super(message, { code: 'VSS_NOT_CONFIGURED', cause: opts.cause })
    this.name = 'VssNotConfiguredError'
  }
}

/**
 * Raised for async-payments (APay) operations: `apayNew` /
 * `bootstrapLsp` failures, including the LSP being unreachable, the
 * host peer not being visible in time, or the LSP rejecting the
 * async_order registration.
 */
export class ApayError extends RgbLightningError {
  constructor (message, opts = {}) {
    super(message, { code: opts.code ?? 'APAY_ERROR', cause: opts.cause })
    this.name = 'ApayError'
  }
}

/**
 * Raised by surface that is intentionally not implemented in this
 * module (e.g. `verify`, `signTransaction`) because the underlying
 * C-FFI doesn't expose it or the operation is out of scope. The
 * message documents the supported alternative.
 */
export class NotImplementedError extends RgbLightningError {
  constructor (message, opts = {}) {
    super(message, { code: 'NOT_IMPLEMENTED', cause: opts.cause })
    this.name = 'NotImplementedError'
  }
}

/**
 * Wrap an arbitrary thrown value in a typed SDK error, preserving the
 * original message verbatim (so existing substring checks against the
 * RLN message — e.g. `.includes('Conflict')` — keep working) and
 * attaching the original as `cause`.
 *
 * If `err` is already an instance of the target class it's returned
 * unchanged, so wrapping is idempotent across nested call sites.
 *
 * @template {RgbLightningError} T
 * @param {unknown} err              The caught value.
 * @param {new (msg: string, opts?: object) => T} ErrorClass  Target class.
 * @param {{ code?: string }} [opts]
 * @returns {T}
 */
export function wrapError (err, ErrorClass, opts = {}) {
  if (err instanceof ErrorClass) return err
  const message = err && typeof err === 'object' && 'message' in err && err.message
    ? String(err.message)
    : String(err)
  return new ErrorClass(message, { code: opts.code, cause: err })
}
