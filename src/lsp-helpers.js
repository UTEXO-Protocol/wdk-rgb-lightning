// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
'use strict'

// Higher-level orchestration on top of LspClient and LnurlPay. These
// helpers take an "account-like" object — anything that exposes
// `sendPayment`, `lnInvoice` / `createInvoice`, `decodeLnInvoice` —
// so they work standalone or, via the small thunks in
// wallet-account-rgb-lightning.js, as account instance methods.
//
// All three helpers return plain DTOs. None of them poll for
// completion: the LSP runs an internal cron and the wallet monitors
// final state through its own RLN node (e.g. account.getInvoiceStatus).

import { LspClient } from './lsp-client.js'
import { resolveAddressToInvoice } from './lnurl-pay.js'
import { toUint64 } from './lsp-utils.js'

/**
 * Pay a Lightning Address end-to-end.
 *
 * 1. Resolve `addr` via LUD-06 (server-agnostic — works for
 *    `alice@getalby.com`, not just utexo-lsp Lightning Addresses).
 * 2. Hand the returned BOLT11 invoice to the account's `sendPayment`.
 *
 * @param {object} account                  Anything with `sendPayment({ invoice })`.
 * @param {string} addr                     `user@host` Lightning Address.
 * @param {bigint|number|string} amountMsat
 * @param {object} [opts]
 * @param {typeof fetch} [opts.fetch]
 * @param {number} [opts.timeoutMs]
 * @param {boolean} [opts.allowHttp]        Allow http on non-loopback hosts (regtest).
 * @param {boolean} [opts.allowCrossHostCallback]
 * @param {string} [opts.comment]           LUD-12 comment.
 * @param {string} [opts.assetId]           Optional RGB asset extension.
 * @param {bigint|number|string} [opts.assetAmount]
 * @param {boolean} [opts.skipAmount]       Don't pass `amt_msat` to sendPayment.
 * @param {(invoice:string, discovery:object) => void|Promise<void>} [opts.beforePay]
 *                                          Hook to inspect the LSP-issued invoice
 *                                          before paying (e.g. to verify the
 *                                          description-hash anchor against
 *                                          discovery.metadata).
 * @returns {Promise<{ invoice:string, sendResult:any, discovery:object, callbackUrl:string }>}
 */
export async function payLightningAddress (account, addr, amountMsat, opts = {}) {
  if (account == null || typeof account.sendPayment !== 'function') {
    throw new TypeError('payLightningAddress: account.sendPayment(request) required')
  }
  const { pr, discovery, callbackUrl } = await resolveAddressToInvoice(addr, amountMsat, opts)
  if (typeof opts.beforePay === 'function') await opts.beforePay(pr, discovery)
  const req = opts.skipAmount ? { invoice: pr } : { invoice: pr, amt_msat: toUint64(amountMsat) }
  const sendResult = await account.sendPayment(req)
  return { invoice: pr, sendResult, discovery, callbackUrl }
}

/**
 * Request the LSP to act as the LN-payer for an RGB transfer the
 * wallet wants to receive.
 *
 * Flow:
 *   1. Wallet creates a BOLT11 invoice on its own RLN node (if not
 *      already supplied).
 *   2. Wallet posts the BOLT11 + RGB params to the LSP.
 *   3. LSP returns an RGB invoice. Wallet shares with sender.
 *   4. Sender pays the RGB invoice → LSP settles, then pays the
 *      wallet's BOLT11 invoice. Wallet observes completion via
 *      `account.getInvoiceStatus(lnInvoice)`.
 *
 * @param {object} account
 * @param {object} args
 * @param {string|LspClient} args.lsp           LSP base URL or pre-built client.
 * @param {string} [args.lnInvoice]             Existing BOLT11 invoice; if omitted, we mint one via account.
 * @param {object} [args.lnInvoiceRequest]      Override for the lnInvoice mint call. Required if lnInvoice omitted.
 * @param {object} args.rgb                     RGB params (assetId, assignment, durationSeconds, witness).
 * @param {object} [args.lspOpts]               Forwarded to new LspClient if lsp is a string.
 * @returns {Promise<{ lnInvoice:string, rgbInvoice:string, mappingId:number }>}
 */
export async function requestLspRgbDeposit (account, { lsp, lnInvoice, lnInvoiceRequest, rgb, lspOpts } = {}) {
  if (account == null) throw new TypeError('requestLspRgbDeposit: account required')
  if (rgb == null || typeof rgb !== 'object') throw new TypeError('requestLspRgbDeposit: rgb params required')
  const client = asLspClient(lsp, lspOpts)

  let invoice = lnInvoice
  if (!invoice) {
    if (lnInvoiceRequest == null) {
      throw new TypeError('requestLspRgbDeposit: provide either args.lnInvoice or args.lnInvoiceRequest')
    }
    const minter = pickInvoiceMinter(account)
    const minted = await minter(lnInvoiceRequest)
    invoice = typeof minted === 'string' ? minted : minted?.invoice
    if (typeof invoice !== 'string') {
      throw new Error(`requestLspRgbDeposit: account invoice mint returned no invoice: ${truncate(JSON.stringify(minted))}`)
    }
  }

  // LspClient.lightningReceive() now returns the response normalized
  // to camelCase ({lnInvoice, rgbInvoice, mappingId}); raw snake_case
  // fields are preserved on the same object for backward compatibility.
  const res = await client.lightningReceive({ lnInvoice: invoice, rgb })
  return {
    lnInvoice: res.lnInvoice ?? res.ln_invoice,
    rgbInvoice: res.rgbInvoice ?? res.rgb_invoice,
    mappingId: res.mappingId ?? res.mapping_id
  }
}

/**
 * Pay an RGB invoice via the LSP-mediated bridge. The LSP issues a
 * BOLT11 invoice for an equivalent LN amount; the wallet pays it
 * locally; the LSP runs `sendrgb` to the recipient embedded in the
 * RGB invoice once the LN payment settles.
 *
 * Caller is responsible for `ln.amtMsat` / `ln.expirySec` — the LSP
 * does not auto-quote.
 *
 * @param {object} account
 * @param {object} args
 * @param {string|LspClient} args.lsp
 * @param {string} args.rgbInvoice
 * @param {object} args.ln                 `{ amtMsat, expirySec, assetId?, assetAmount?, … }`
 * @param {object} [args.lspOpts]
 * @returns {Promise<{ lnInvoice:string, rgbInvoice:string, mappingId:number, sendResult:any }>}
 */
export async function payRgbViaLsp (account, { lsp, rgbInvoice, ln, lspOpts } = {}) {
  if (account == null || typeof account.sendPayment !== 'function') {
    throw new TypeError('payRgbViaLsp: account.sendPayment required')
  }
  if (typeof rgbInvoice !== 'string' || rgbInvoice.length === 0) {
    throw new TypeError('payRgbViaLsp: rgbInvoice required')
  }
  if (ln == null) throw new TypeError('payRgbViaLsp: ln params required')

  const client = asLspClient(lsp, lspOpts)
  // LspClient.onchainSend() now returns the response normalized to
  // camelCase; raw snake_case fields are preserved for backward compat.
  const issued = await client.onchainSend({ rgbInvoice, ln })
  const lnInvoice = issued.lnInvoice ?? issued.ln_invoice
  const sendResult = await account.sendPayment({ invoice: lnInvoice })

  return {
    lnInvoice,
    rgbInvoice: issued.rgbInvoice ?? issued.rgb_invoice,
    mappingId: issued.mappingId ?? issued.mapping_id,
    sendResult
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function asLspClient (lsp, lspOpts) {
  if (lsp instanceof LspClient) return lsp
  if (typeof lsp === 'string' && lsp.length > 0) return new LspClient({ baseUrl: lsp, ...(lspOpts ?? {}) })
  throw new TypeError('lsp must be an LspClient or a base URL string')
}

/**
 * The account exposes `createInvoice` (our naming convention) and the
 * underlying daemon also accepts `lnInvoice`. Support both so callers
 * don't have to remember which name the account has.
 */
function pickInvoiceMinter (account) {
  if (typeof account.createInvoice === 'function') return account.createInvoice.bind(account)
  if (typeof account.lnInvoice === 'function') return account.lnInvoice.bind(account)
  throw new TypeError('requestLspRgbDeposit: account must expose createInvoice or lnInvoice')
}

function truncate (s) { return s.length > 200 ? s.slice(0, 197) + '…' : s }
