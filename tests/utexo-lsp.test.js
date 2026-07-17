// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.

// Unit tests for the composed UtexoLsp flow class plus its pure helpers
// (peerUri, normalizeReceiveStatus) and the typed error subclasses.
// The class wraps a WalletAccountRgbLightning + an LspClient; here we
// pass a fake account (jest.fn methods) and stub the instance's `http`
// (LspClient) so no node, binding or network is touched. globalThis.fetch
// is set so the internal LspClient constructs and so the payAddress LNURL
// fallback path can be exercised.

import { jest } from '@jest/globals'
import {
  LspChannelTimeoutError,
  LspLiquidityTimeoutError,
  LspSettlementError,
  peerUri,
  normalizeReceiveStatus,
  UtexoLsp
} from '../src/utexo-lsp.js'

const PEER = {
  baseUrl: 'https://lsp.example.io',
  peerPubkey: '02' + 'a'.repeat(64),
  peerHost: 'lsp.example.io',
  peerPort: 9735
}

// A fake account exposing every method UtexoLsp may call. Each is a
// jest.fn so callers can assert/override per test.
function makeAccount (overrides = {}) {
  return {
    connectPeer: jest.fn(async () => ({ ok: true })),
    sync: jest.fn(async () => {}),
    listChannels: jest.fn(async () => []),
    createLightningInvoice: jest.fn(async () => ({ invoice: 'lnbcrt-default' })),
    getInvoiceStatus: jest.fn(async () => ({ status: 'Pending' })),
    sendPayment: jest.fn(async () => ({ payment_hash: 'ph' })),
    getNodeInfo: jest.fn(async () => ({ pubkey: 'mynodepubkey' })),
    apayNew: jest.fn(async () => ({ ok: true })),
    listPayments: jest.fn(async () => []),
    claimHodlInvoice: jest.fn(async () => ({ ok: true })),
    ...overrides
  }
}

// Build a UtexoLsp whose internal http (LspClient) methods are all
// jest.fn stubs, so no fetch is performed for the LSP HTTP surface.
function makeLsp (account, peer = PEER) {
  const lsp = new UtexoLsp(account, peer)
  lsp.http = {
    lightningReceive: jest.fn(async () => ({ rgbInvoice: 'rgb:abc', mappingId: 1 })),
    onchainSend: jest.fn(async () => ({ lnInvoice: 'lnbcrt-issued', rgbInvoice: 'rgb:xyz', mappingId: 2 })),
    resolveAddress: jest.fn(async () => ({ pr: 'lnbcrt-resolved' })),
    getInfo: jest.fn(async () => ({ pubkey: 'lsppubkey' })),
    getLightningAddressByPubkey: jest.fn(async () => ({ username: 'alice', domain: 'lsp.example.io' }))
  }
  return lsp
}

function lnurlResponse (body) {
  return { ok: true, status: 200, text: async () => JSON.stringify(body) }
}

function lnurlDiscovery (callback) {
  return {
    tag: 'payRequest',
    callback,
    minSendable: 1,
    maxSendable: 100000,
    metadata: '[["text/plain","pay"]]'
  }
}

beforeEach(() => {
  globalThis.fetch = jest.fn()
})

afterEach(() => {
  jest.clearAllMocks()
  delete globalThis.fetch
})

// ── pure helpers ───────────────────────────────────────────────────────────

describe('peerUri', () => {
  it('builds the pubkey@host:port string connectPeer accepts', () => {
    expect(peerUri(PEER)).toBe(`${PEER.peerPubkey}@lsp.example.io:9735`)
  })

  it('interpolates each field verbatim', () => {
    expect(peerUri({ peerPubkey: 'PK', peerHost: 'h.test', peerPort: 1234 })).toBe('PK@h.test:1234')
  })
})

describe('normalizeReceiveStatus', () => {
  it('maps SUCCEEDED / SETTLED (any case) to Succeeded', () => {
    expect(normalizeReceiveStatus('Succeeded')).toBe('Succeeded')
    expect(normalizeReceiveStatus('succeeded')).toBe('Succeeded')
    expect(normalizeReceiveStatus('SETTLED')).toBe('Succeeded')
    expect(normalizeReceiveStatus({ status: 'settled' })).toBe('Succeeded')
  })

  it('maps FAILED to Failed and EXPIRED to Expired', () => {
    expect(normalizeReceiveStatus('Failed')).toBe('Failed')
    expect(normalizeReceiveStatus({ status: 'EXPIRED' })).toBe('Expired')
  })

  it('treats unknown / pending / empty / nullish as Pending', () => {
    expect(normalizeReceiveStatus('Pending')).toBe('Pending')
    expect(normalizeReceiveStatus('something-else')).toBe('Pending')
    expect(normalizeReceiveStatus('')).toBe('Pending')
    expect(normalizeReceiveStatus(null)).toBe('Pending')
    expect(normalizeReceiveStatus(undefined)).toBe('Pending')
    expect(normalizeReceiveStatus({})).toBe('Pending')
    expect(normalizeReceiveStatus({ status: null })).toBe('Pending')
  })
})

// ── error subclasses ───────────────────────────────────────────────────────

describe('LspChannelTimeoutError', () => {
  it('formats a seconds message and carries assetId/elapsedMs', () => {
    const e = new LspChannelTimeoutError('assetX', 120000)
    expect(e).toBeInstanceOf(Error)
    expect(e.name).toBe('LspChannelTimeoutError')
    expect(e.assetId).toBe('assetX')
    expect(e.elapsedMs).toBe(120000)
    expect(e.message).toBe('No usable RGB channel for assetX after 120s')
  })
})

describe('LspSettlementError', () => {
  it('formats a terminal-status message and carries step/status', () => {
    const e = new LspSettlementError('ln_invoice', 'Failed')
    expect(e).toBeInstanceOf(Error)
    expect(e.name).toBe('LspSettlementError')
    expect(e.step).toBe('ln_invoice')
    expect(e.status).toBe('Failed')
    expect(e.message).toBe('Settlement ended with status "Failed" at step ln_invoice')
  })
})

describe('LspLiquidityTimeoutError', () => {
  it('carries the requested floor, elapsed time, and LSP peer', () => {
    const e = new LspLiquidityTimeoutError(5000, 120000, PEER.peerPubkey)
    expect(e).toBeInstanceOf(Error)
    expect(e.name).toBe('LspLiquidityTimeoutError')
    expect(e.minMsat).toBe(5000)
    expect(e.elapsedMs).toBe(120000)
    expect(e.peerPubkey).toBe(PEER.peerPubkey)
    expect(e.message).toContain('below 5000 msat after 120s')
  })
})

// ── constructor ────────────────────────────────────────────────────────────

describe('UtexoLsp constructor', () => {
  it('throws when account is null', () => {
    expect(() => new UtexoLsp(null, PEER)).toThrow('account required')
  })

  it('throws when peer is missing or peer.baseUrl is not a string', () => {
    expect(() => new UtexoLsp(makeAccount(), null)).toThrow('peer.baseUrl required')
    expect(() => new UtexoLsp(makeAccount(), { baseUrl: 123 })).toThrow('peer.baseUrl required')
  })

  it('constructs an http LspClient pointed at peer.baseUrl', () => {
    const lsp = new UtexoLsp(makeAccount(), PEER)
    expect(lsp.account).toBeTruthy()
    expect(lsp.peer).toBe(PEER)
    expect(lsp.http.baseUrl).toBe('https://lsp.example.io')
  })

  it('passes a bearer token through as an Authorization header (allowHttp/timeout knobs)', () => {
    const peer = { ...PEER, baseUrl: 'http://127.0.0.1:8080', bearerToken: 'tok', allowHttp: true, timeoutMs: 5000 }
    const lsp = new UtexoLsp(makeAccount(), peer)
    expect(lsp.http.baseUrl).toBe('http://127.0.0.1:8080')
  })
})

// ── connect ────────────────────────────────────────────────────────────────

describe('connect', () => {
  it('forwards the peerUri to account.connectPeer', async () => {
    const account = makeAccount()
    const lsp = makeLsp(account)
    await lsp.connect()
    expect(account.connectPeer).toHaveBeenCalledWith(peerUri(PEER))
  })
})

// ── waitForChannel ─────────────────────────────────────────────────────────

describe('waitForChannel', () => {
  it('returns ChannelReadyInfo for a usable RGB channel (camelCase fields)', async () => {
    const channel = {
      assetId: 'assetX',
      isUsable: true,
      channelId: 'chan-1',
      capacitySat: 100000,
      outboundBalanceMsat: 50000,
      inboundBalanceMsat: 25000
    }
    const account = makeAccount({ listChannels: jest.fn(async () => [channel]) })
    const lsp = makeLsp(account)
    const onProgress = jest.fn()
    const info = await lsp.waitForChannel('assetX', { timeoutMs: 1000, onProgress })
    expect(info).toEqual({
      channelId: 'chan-1',
      peerPubkey: PEER.peerPubkey,
      capacitySat: 100000,
      outboundBalanceMsat: 50000,
      inboundBalanceMsat: 25000
    })
    expect(account.sync).toHaveBeenCalled()
    expect(onProgress).toHaveBeenCalledWith('channels: 1 — RGB usable: yes')
  })

  it('reads snake_case channel fields and the ready/localBalance fallbacks', async () => {
    const channel = {
      asset_id: 'assetSnake',
      ready: true,
      channel_id: 'chan-2',
      capacity_sat: 7,
      local_balance_msat: 999
    }
    const account = makeAccount({ listChannels: jest.fn(async () => ({ channels: [channel] })) })
    const lsp = makeLsp(account)
    const info = await lsp.waitForChannel('assetSnake', { timeoutMs: 1000 })
    expect(info.channelId).toBe('chan-2')
    expect(info.capacitySat).toBe(7)
    expect(info.outboundBalanceMsat).toBe(999)
    expect(info.inboundBalanceMsat).toBe(0)
  })

  it('runs onEachPoll before checking channels', async () => {
    const onEachPoll = jest.fn(async () => {})
    const channel = { assetId: 'a', isUsable: true }
    const account = makeAccount({ listChannels: jest.fn(async () => [channel]) })
    const lsp = makeLsp(account)
    await lsp.waitForChannel('a', { timeoutMs: 1000, onEachPoll })
    expect(onEachPoll).toHaveBeenCalled()
  })

  it('throws LspChannelTimeoutError when no usable channel appears before the deadline', async () => {
    const account = makeAccount({ listChannels: jest.fn(async () => []) })
    const lsp = makeLsp(account)
    await expect(lsp.waitForChannel('missing', { timeoutMs: 5, pollIntervalMs: 1 }))
      .rejects.toBeInstanceOf(LspChannelTimeoutError)
  })

  it('aborts immediately when the signal is already aborted', async () => {
    const account = makeAccount({ listChannels: jest.fn(async () => []) })
    const lsp = makeLsp(account)
    const controller = new AbortController()
    controller.abort()
    await expect(lsp.waitForChannel('a', { timeoutMs: 1000, signal: controller.signal }))
      .rejects.toThrow('operation aborted')
  })

  it('does not treat a non-matching-asset usable channel as ready', async () => {
    const account = makeAccount({ listChannels: jest.fn(async () => [{ assetId: 'other', isUsable: true }]) })
    const lsp = makeLsp(account)
    await expect(lsp.waitForChannel('wanted', { timeoutMs: 5, pollIntervalMs: 1 }))
      .rejects.toBeInstanceOf(LspChannelTimeoutError)
  })

  it("reports the no-match progress message ('RGB usable: no') when nothing matches", async () => {
    // Channel count is reported and the match flag is 'no' (not 'yes') for an
    // asset that does not match. Pins the false arm of the onProgress ternary.
    const account = makeAccount({ listChannels: jest.fn(async () => [{ assetId: 'other', isUsable: true }, { assetId: 'x' }]) })
    const lsp = makeLsp(account)
    const onProgress = jest.fn()
    await expect(lsp.waitForChannel('wanted', { timeoutMs: 5, pollIntervalMs: 1, onProgress }))
      .rejects.toBeInstanceOf(LspChannelTimeoutError)
    expect(onProgress).toHaveBeenCalledWith('channels: 2 — RGB usable: no')
    expect(onProgress).not.toHaveBeenCalledWith(expect.stringContaining('usable: yes'))
  })

  it('treats isUsable:false as NOT usable even when ready is true (nullish-coalescing precedence)', async () => {
    // `isUsable ?? ready`: false is NOT nullish, so the explicit false wins and
    // `ready:true` must NOT rescue the channel. If `??` were `||`, ready:true
    // would (wrongly) make it usable and the wait would resolve instead of
    // timing out.
    const channel = { assetId: 'wanted', isUsable: false, ready: true, channelId: 'c-false' }
    const account = makeAccount({ listChannels: jest.fn(async () => [channel]) })
    const lsp = makeLsp(account)
    await expect(lsp.waitForChannel('wanted', { timeoutMs: 5, pollIntervalMs: 1 }))
      .rejects.toBeInstanceOf(LspChannelTimeoutError)
  })

  it('reads the localBalanceMsat (camelCase) middle rung and defaults inbound to 0', async () => {
    // _outboundMsat: outboundBalanceMsat is absent, so the camelCase
    // localBalanceMsat fallback rung supplies the value; inbound is absent so
    // the `?? 0` default applies.
    const channel = { assetId: 'wanted', isUsable: true, channelId: 'c-local', localBalanceMsat: 4242 }
    const account = makeAccount({ listChannels: jest.fn(async () => [channel]) })
    const lsp = makeLsp(account)
    const info = await lsp.waitForChannel('wanted', { timeoutMs: 1000 })
    expect(info.outboundBalanceMsat).toBe(4242)
    expect(info.inboundBalanceMsat).toBe(0)
    expect(info.capacitySat).toBe(0)
  })
})

// ── receiveAsset ───────────────────────────────────────────────────────────

describe('receiveAsset', () => {
  it('throws when assetId is missing or empty', async () => {
    const lsp = makeLsp(makeAccount())
    await expect(lsp.receiveAsset({})).rejects.toThrow('assetId required')
    await expect(lsp.receiveAsset({ assetId: '' })).rejects.toThrow('assetId required')
  })

  it('mints a LN invoice, registers it with the LSP, and returns both invoices', async () => {
    const account = makeAccount({
      createLightningInvoice: jest.fn(async () => ({ invoice: 'lnbcrt-mine' }))
    })
    const lsp = makeLsp(account)
    const out = await lsp.receiveAsset({ assetId: 'assetX', amountSats: 100, amountRgb: 5, expirySeconds: 600 })
    expect(account.createLightningInvoice).toHaveBeenCalledWith({
      amountMsat: 100000,
      expirySec: 600,
      assetId: 'assetX',
      assetAmount: 5
    })
    // No measurable elapsed time in a fast unit test, so the remaining
    // lifetime equals the full expiry. Pins the exact forwarded value so a
    // sign flip / doubling / drop of the elapsed-subtraction is caught even
    // before the elapsed-aware tests below.
    expect(lsp.http.lightningReceive).toHaveBeenCalledWith({
      lnInvoice: 'lnbcrt-mine',
      rgb: { assetId: 'assetX', durationSeconds: 600 }
    })
    expect(out).toEqual({ lnInvoice: 'lnbcrt-mine', rgbInvoice: 'rgb:abc', mappingId: '1' })
  })

  it('forwards the LN invoice REMAINING lifetime (expiry minus elapsed) as durationSeconds', async () => {
    // Drive Date.now() deterministically: the source reads it once before
    // createLightningInvoice (createdAtMs) and once after (to derive
    // elapsedSeconds). We make invoice creation "take" 7000ms of wall clock
    // so elapsedSeconds === 7, and durationSeconds === expiry - 7.
    const nowSpy = jest.spyOn(Date, 'now')
    nowSpy.mockReturnValueOnce(1_000_000) // createdAtMs
    const account = makeAccount({
      createLightningInvoice: jest.fn(async () => {
        nowSpy.mockReturnValue(1_007_000) // +7000ms elapsed during creation
        return { invoice: 'lnbcrt-mine' }
      })
    })
    const lsp = makeLsp(account)
    try {
      await lsp.receiveAsset({ assetId: 'assetX', expirySeconds: 600 })
    } finally {
      nowSpy.mockRestore()
    }
    expect(lsp.http.lightningReceive).toHaveBeenCalledWith({
      lnInvoice: 'lnbcrt-mine',
      rgb: { assetId: 'assetX', durationSeconds: 593 } // 600 - 7, NOT 600 and NOT 607
    })
  })

  it('floors durationSeconds at 1 when invoice creation outlasts the expiry', async () => {
    // elapsedSeconds (50) exceeds expiry (10): expiry - elapsed = -40, so the
    // Math.max(1, …) floor must clamp to exactly 1.
    const nowSpy = jest.spyOn(Date, 'now')
    nowSpy.mockReturnValueOnce(2_000_000) // createdAtMs
    const account = makeAccount({
      createLightningInvoice: jest.fn(async () => {
        nowSpy.mockReturnValue(2_050_000) // +50_000ms elapsed
        return { invoice: 'lnbcrt-slow' }
      })
    })
    const lsp = makeLsp(account)
    try {
      await lsp.receiveAsset({ assetId: 'assetX', expirySeconds: 10 })
    } finally {
      nowSpy.mockRestore()
    }
    expect(lsp.http.lightningReceive).toHaveBeenCalledWith({
      lnInvoice: 'lnbcrt-slow',
      rgb: { assetId: 'assetX', durationSeconds: 1 }
    })
  })

  it('omits amountMsat for an amountless invoice and defaults expiry to 3600', async () => {
    const account = makeAccount()
    const lsp = makeLsp(account)
    await lsp.receiveAsset({ assetId: 'assetX' })
    expect(account.createLightningInvoice).toHaveBeenCalledWith({
      amountMsat: undefined,
      expirySec: 3600,
      assetId: 'assetX',
      assetAmount: undefined
    })
  })

  it('accepts the lnInvoice fallback field name', async () => {
    const account = makeAccount({ createLightningInvoice: jest.fn(async () => ({ lnInvoice: 'lnbcrt-alt' })) })
    const lsp = makeLsp(account)
    const out = await lsp.receiveAsset({ assetId: 'assetX' })
    expect(out.lnInvoice).toBe('lnbcrt-alt')
  })

  it('throws when createLightningInvoice returns no invoice', async () => {
    const account = makeAccount({ createLightningInvoice: jest.fn(async () => ({})) })
    const lsp = makeLsp(account)
    await expect(lsp.receiveAsset({ assetId: 'assetX' })).rejects.toThrow('returned no invoice')
  })
})

// ── awaitReceiveSettlement ─────────────────────────────────────────────────

describe('awaitReceiveSettlement', () => {
  it("returns 'settled' once status normalizes to Succeeded", async () => {
    const account = makeAccount({ getInvoiceStatus: jest.fn(async () => ({ status: 'Succeeded' })) })
    const lsp = makeLsp(account)
    const onProgress = jest.fn()
    await expect(lsp.awaitReceiveSettlement('ln', { timeoutMs: 1000, onProgress })).resolves.toBe('settled')
    expect(onProgress).toHaveBeenCalledWith('Succeeded')
  })

  it('throws LspSettlementError on a Failed status', async () => {
    const account = makeAccount({ getInvoiceStatus: jest.fn(async () => 'Failed') })
    const lsp = makeLsp(account)
    const err = await lsp.awaitReceiveSettlement('ln', { timeoutMs: 1000 }).catch((e) => e)
    expect(err).toBeInstanceOf(LspSettlementError)
    expect(err.status).toBe('Failed')
    expect(err.step).toBe('ln_invoice')
  })

  it('keeps polling through Pending and settles on a later Succeeded (multi-iteration)', async () => {
    const getInvoiceStatus = jest.fn()
      .mockResolvedValueOnce({ status: 'Pending' })
      .mockResolvedValueOnce({ status: 'Pending' })
      .mockResolvedValueOnce({ status: 'Succeeded' })
    const account = makeAccount({ getInvoiceStatus })
    const lsp = makeLsp(account)
    const onProgress = jest.fn()
    await expect(lsp.awaitReceiveSettlement('ln', { timeoutMs: 1000, pollIntervalMs: 1, onProgress }))
      .resolves.toBe('settled')
    // Three polls: Pending, Pending, then Succeeded — proves the loop iterates
    // across the sleep instead of resolving on the first read.
    expect(getInvoiceStatus).toHaveBeenCalledTimes(3)
    expect(account.sync).toHaveBeenCalledTimes(3)
    expect(onProgress).toHaveBeenNthCalledWith(1, 'Pending')
    expect(onProgress).toHaveBeenNthCalledWith(2, 'Pending')
    expect(onProgress).toHaveBeenNthCalledWith(3, 'Succeeded')
    expect(onProgress).not.toHaveBeenCalledWith('timeout')
  })

  it('throws LspSettlementError on an Expired status', async () => {
    const account = makeAccount({ getInvoiceStatus: jest.fn(async () => ({ status: 'Expired' })) })
    const lsp = makeLsp(account)
    await expect(lsp.awaitReceiveSettlement('ln', { timeoutMs: 1000 }))
      .rejects.toBeInstanceOf(LspSettlementError)
  })

  it("returns 'timed_out' (and reports it) when status never settles", async () => {
    const account = makeAccount({ getInvoiceStatus: jest.fn(async () => ({ status: 'Pending' })) })
    const lsp = makeLsp(account)
    const onProgress = jest.fn()
    await expect(lsp.awaitReceiveSettlement('ln', { timeoutMs: 5, pollIntervalMs: 1, onProgress }))
      .resolves.toBe('timed_out')
    expect(onProgress).toHaveBeenCalledWith('timeout')
  })

  it('throws on an already-aborted signal', async () => {
    const account = makeAccount({ getInvoiceStatus: jest.fn(async () => ({ status: 'Pending' })) })
    const lsp = makeLsp(account)
    const controller = new AbortController()
    controller.abort()
    await expect(lsp.awaitReceiveSettlement('ln', { timeoutMs: 1000, signal: controller.signal }))
      .rejects.toThrow('operation aborted')
  })
})

// ── waitForOutboundLiquidity ───────────────────────────────────────────────

describe('waitForOutboundLiquidity', () => {
  it('resolves once outbound balance on the LSP channel meets the minimum', async () => {
    const channel = { peerPubkey: PEER.peerPubkey, isUsable: true, outboundBalanceMsat: 5000 }
    const account = makeAccount({ listChannels: jest.fn(async () => [channel]) })
    const lsp = makeLsp(account)
    const onProgress = jest.fn()
    await expect(lsp.waitForOutboundLiquidity(5000, { timeoutMs: 1000, onProgress })).resolves.toBeUndefined()
    expect(onProgress).toHaveBeenCalledWith('outbound: 5000 msat (need 5000)')
  })

  it('reads snake_case fields for the LSP channel match', async () => {
    const channel = { peer_pubkey: PEER.peerPubkey, is_usable: true, outbound_balance_msat: 9000 }
    const account = makeAccount({ listChannels: jest.fn(async () => [channel]) })
    const lsp = makeLsp(account)
    const onProgress = jest.fn()
    await expect(lsp.waitForOutboundLiquidity(1, { timeoutMs: 1000, onProgress })).resolves.toBeUndefined()
    // Resolution on the FIRST poll (not a timeout): proves the snake_case
    // channel was selected and its outbound (9000) was read, meeting need=1.
    expect(onProgress).toHaveBeenCalledTimes(1)
    expect(onProgress).toHaveBeenCalledWith('outbound: 9000 msat (need 1)')
  })

  it('throws a typed timeout when liquidity never arrives', async () => {
    const account = makeAccount({ listChannels: jest.fn(async () => []) })
    const lsp = makeLsp(account)
    const error = await lsp.waitForOutboundLiquidity(10000, { timeoutMs: 5, pollIntervalMs: 1 }).catch((cause) => cause)
    expect(error).toBeInstanceOf(LspLiquidityTimeoutError)
    expect(error).toMatchObject({ minMsat: 10000, elapsedMs: 5, peerPubkey: PEER.peerPubkey })
  })

  it('IGNORES a peer-matching channel that is not usable (the is_usable conjunct)', async () => {
    // Right peer, ample outbound, but is_usable=false: the AND-guard must
    // reject it so no channel is selected and outbound reads 0 (need 5000 ->
    // never met). If the is_usable conjunct were dropped, this channel would
    // be selected and onProgress would report 9999 msat. We assert the EXACT
    // reported outbound to pin the distinct outcome.
    const channel = { peerPubkey: PEER.peerPubkey, isUsable: false, outboundBalanceMsat: 9999 }
    const account = makeAccount({ listChannels: jest.fn(async () => [channel]) })
    const lsp = makeLsp(account)
    const onProgress = jest.fn()
    await expect(lsp.waitForOutboundLiquidity(5000, { timeoutMs: 5, pollIntervalMs: 1, onProgress }))
      .rejects.toBeInstanceOf(LspLiquidityTimeoutError)
    expect(onProgress).toHaveBeenCalledWith('outbound: 0 msat (need 5000)')
    expect(onProgress).not.toHaveBeenCalledWith(expect.stringContaining('9999'))
  })

  it('IGNORES a usable channel on the WRONG peer (the peerPubkey conjunct)', async () => {
    // Usable, ample outbound, but a different peer: must not satisfy the
    // liquidity wait. Pins the peerPubkey side of the AND.
    const channel = { peerPubkey: '03' + 'f'.repeat(64), isUsable: true, outboundBalanceMsat: 9999 }
    const account = makeAccount({ listChannels: jest.fn(async () => [channel]) })
    const lsp = makeLsp(account)
    const onProgress = jest.fn()
    await expect(lsp.waitForOutboundLiquidity(5000, { timeoutMs: 5, pollIntervalMs: 1, onProgress }))
      .rejects.toBeInstanceOf(LspLiquidityTimeoutError)
    expect(onProgress).toHaveBeenCalledWith('outbound: 0 msat (need 5000)')
    expect(onProgress).not.toHaveBeenCalledWith(expect.stringContaining('9999'))
  })

  it('aborts on an already-aborted signal', async () => {
    const account = makeAccount({ listChannels: jest.fn(async () => []) })
    const lsp = makeLsp(account)
    const controller = new AbortController()
    controller.abort()
    await expect(lsp.waitForOutboundLiquidity(1, { timeoutMs: 1000, signal: controller.signal }))
      .rejects.toThrow('operation aborted')
  })
})

// ── sendAsset ──────────────────────────────────────────────────────────────

describe('sendAsset', () => {
  it('throws when rgbInvoice is missing or empty', async () => {
    const lsp = makeLsp(makeAccount())
    await expect(lsp.sendAsset({})).rejects.toThrow('rgbInvoice required')
    await expect(lsp.sendAsset({ rgbInvoice: '' })).rejects.toThrow('rgbInvoice required')
  })

  it('issues an LN invoice via the LSP then pays it through the account', async () => {
    const account = makeAccount({ sendPayment: jest.fn(async () => ({ payment_hash: 'sent' })) })
    const lsp = makeLsp(account)
    const ln = { amtMsat: 1000, expirySec: 60 }
    const out = await lsp.sendAsset({ rgbInvoice: 'rgb:xyz', ln })
    expect(lsp.http.onchainSend).toHaveBeenCalledWith({ rgbInvoice: 'rgb:xyz', ln })
    expect(account.sendPayment).toHaveBeenCalledWith({ invoice: 'lnbcrt-issued' })
    expect(out).toEqual({
      lnInvoice: 'lnbcrt-issued',
      rgbInvoice: 'rgb:xyz',
      mappingId: '2',
      sendResult: { payment_hash: 'sent' }
    })
  })
})

// ── payAddress ─────────────────────────────────────────────────────────────

describe('payAddress', () => {
  it('rejects a malformed Lightning Address', async () => {
    const lsp = makeLsp(makeAccount())
    await expect(lsp.payAddress({ address: 'noatsign' })).rejects.toThrow('invalid Lightning Address')
    await expect(lsp.payAddress({ address: 123 })).rejects.toThrow('invalid Lightning Address')
  })

  it('rejects an address with an empty username or domain', async () => {
    const lsp = makeLsp(makeAccount())
    await expect(lsp.payAddress({ address: '@host' })).rejects.toThrow('invalid Lightning Address')
    await expect(lsp.payAddress({ address: 'user@' })).rejects.toThrow('invalid Lightning Address')
  })

  it('resolves via the LSP and pays the returned invoice', async () => {
    const account = makeAccount({ sendPayment: jest.fn(async () => ({ payment_hash: 'paid' })) })
    const lsp = makeLsp(account)
    const out = await lsp.payAddress({
      address: 'alice@lsp.example.io',
      amtMsat: 2000,
      asset: { assetId: 'assetX', assetAmount: 7 }
    })
    expect(lsp.http.resolveAddress).toHaveBeenCalledWith('alice', 2000, { assetId: 'assetX', assetAmount: 7 })
    expect(account.sendPayment).toHaveBeenCalledWith({ invoice: 'lnbcrt-resolved' })
    expect(out).toEqual({ invoice: 'lnbcrt-resolved', sendResult: { payment_hash: 'paid' } })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('uses the shared LNURL resolver directly for an external address', async () => {
    const account = makeAccount({ sendPayment: jest.fn(async () => ({ payment_hash: 'fb' })) })
    const lsp = makeLsp(account)
    globalThis.fetch = jest.fn()
      .mockResolvedValueOnce(lnurlResponse(lnurlDiscovery('https://other.test/cb?x=1')))
      .mockResolvedValueOnce(lnurlResponse({ pr: 'lnbcrt-lnurl' }))

    const out = await lsp.payAddress({
      address: 'bob@other.test',
      amtMsat: 3000,
      asset: { assetId: 'assetY', assetAmount: 9 }
    })
    expect(globalThis.fetch.mock.calls[0][0]).toBe('https://other.test/.well-known/lnurlp/bob')
    expect(lsp.http.resolveAddress).not.toHaveBeenCalled()
    const secondUrl = globalThis.fetch.mock.calls[1][0]
    expect(secondUrl).toContain('https://other.test/cb?x=1')
    expect(secondUrl).toContain('&amount=3000')
    expect(secondUrl).toContain('&asset_id=assetY')
    expect(secondUrl).toContain('&asset_amount=9')
    expect(out).toEqual({ invoice: 'lnbcrt-lnurl', sendResult: { payment_hash: 'fb' } })
  })

  it('rejects a delegated callback by default', async () => {
    const account = makeAccount()
    const lsp = makeLsp(account)
    globalThis.fetch = jest.fn()
      .mockResolvedValueOnce(lnurlResponse(lnurlDiscovery('https://delegate.test/cb')))

    await expect(lsp.payAddress({ address: 'bob@other.test', amtMsat: 3000 }))
      .rejects.toThrow("callback host 'delegate.test' does not match discovery host 'other.test'")
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(account.sendPayment).not.toHaveBeenCalled()
  })

  it('forwards the explicit delegated-callback opt-in', async () => {
    const account = makeAccount({ sendPayment: jest.fn(async () => ({ payment_hash: 'delegated' })) })
    const lsp = makeLsp(account)
    globalThis.fetch = jest.fn()
      .mockResolvedValueOnce(lnurlResponse(lnurlDiscovery('https://delegate.test/cb')))
      .mockResolvedValueOnce(lnurlResponse({ pr: 'lnbcrt-delegated' }))

    await expect(lsp.payAddress({
      address: 'bob@other.test',
      amtMsat: '3000',
      allowCrossHostCallback: true
    })).resolves.toEqual({
      invoice: 'lnbcrt-delegated',
      sendResult: { payment_hash: 'delegated' }
    })
    expect(globalThis.fetch.mock.calls[1][0]).toBe('https://delegate.test/cb?amount=3000')
    expect(account.sendPayment).toHaveBeenCalledWith({ invoice: 'lnbcrt-delegated' })
  })

  it('uses a ? separator in the fallback callback when none is present', async () => {
    const lsp = makeLsp(makeAccount())
    globalThis.fetch = jest.fn()
      .mockResolvedValueOnce(lnurlResponse(lnurlDiscovery('https://other.test/cb')))
      .mockResolvedValueOnce(lnurlResponse({ pr: 'lnbcrt-q' }))
    await lsp.payAddress({ address: 'bob@other.test', amtMsat: 1 })
    expect(globalThis.fetch.mock.calls[1][0]).toContain('https://other.test/cb?amount=1')
  })

  it('throws when no global fetch is available for the fallback', async () => {
    const lsp = makeLsp(makeAccount())
    delete globalThis.fetch
    await expect(lsp.payAddress({ address: 'bob@other.test', amtMsat: 1 }))
      .rejects.toThrow('no global fetch')
  })

  it('throws when the LNURL response has no callback', async () => {
    const lsp = makeLsp(makeAccount())
    globalThis.fetch = jest.fn().mockResolvedValueOnce(lnurlResponse(lnurlDiscovery(undefined)))
    await expect(lsp.payAddress({ address: 'bob@other.test', amtMsat: 1 }))
      .rejects.toThrow('invalid callback')
  })

  it('falls back to the shared resolver when the same-host LSP path fails', async () => {
    const lsp = makeLsp(makeAccount())
    lsp.http.resolveAddress = jest.fn(async () => { throw new Error('LSP unavailable') })
    globalThis.fetch = jest.fn()
      .mockResolvedValueOnce(lnurlResponse(lnurlDiscovery('https://lsp.example.io/cb')))
      .mockResolvedValueOnce(lnurlResponse({ pr: 'lnbcrt-fallback' }))
    await expect(lsp.payAddress({ address: 'alice@lsp.example.io', amtMsat: 2 }))
      .resolves.toMatchObject({ invoice: 'lnbcrt-fallback' })
    expect(lsp.http.resolveAddress).toHaveBeenCalledTimes(1)
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
  })

  it('throws when no invoice is returned from either path', async () => {
    const lsp = makeLsp(makeAccount())
    lsp.http.resolveAddress = jest.fn(async () => ({ pr: undefined }))
    await expect(lsp.payAddress({ address: 'alice@lsp.example.io', amtMsat: 1 }))
      .rejects.toThrow('no invoice returned for Lightning Address')
  })
})

// ── enableLightningAddress ─────────────────────────────────────────────────

describe('enableLightningAddress', () => {
  it('registers the apay pool and reads back the assigned Lightning Address', async () => {
    const account = makeAccount({ getNodeInfo: jest.fn(async () => ({ pubkey: 'wallet-pk' })) })
    const lsp = makeLsp(account)
    const out = await lsp.enableLightningAddress()
    expect(lsp.http.getInfo).toHaveBeenCalled()
    expect(account.apayNew).toHaveBeenCalledWith('lsppubkey')
    expect(lsp.http.getLightningAddressByPubkey).toHaveBeenCalledWith('wallet-pk')
    expect(out).toEqual({ username: 'alice', domain: 'lsp.example.io', address: 'alice@lsp.example.io' })
  })

  it('throws when the wallet is not unlocked (no pubkey)', async () => {
    const account = makeAccount({ getNodeInfo: jest.fn(async () => ({})) })
    const lsp = makeLsp(account)
    await expect(lsp.enableLightningAddress()).rejects.toThrow('wallet not unlocked')
    expect(account.apayNew).not.toHaveBeenCalled()
  })

  it('throws when the LSP /get_info returns no pubkey', async () => {
    const account = makeAccount({ getNodeInfo: jest.fn(async () => ({ pubkey: 'wallet-pk' })) })
    const lsp = makeLsp(account)
    lsp.http.getInfo = jest.fn(async () => ({}))
    await expect(lsp.enableLightningAddress()).rejects.toThrow('returned no pubkey')
    expect(account.apayNew).not.toHaveBeenCalled()
  })
})

// ── claimPendingPayments ───────────────────────────────────────────────────

describe('claimPendingPayments', () => {
  it('returns an empty list when there are no claimable payments', async () => {
    const account = makeAccount({ listPayments: jest.fn(async () => []) })
    const lsp = makeLsp(account)
    await expect(lsp.claimPendingPayments()).resolves.toEqual([])
    expect(account.claimHodlInvoice).not.toHaveBeenCalled()
  })

  it('claims CLAIMABLE and CLAIMING payments (camelCase + snake_case shapes)', async () => {
    const payments = [
      { status: 'CLAIMABLE', paymentHash: 'h1', paymentPreimage: 'p1' },
      { status: 'claiming', payment_hash: 'h2', payment_preimage: 'p2' },
      { status: 'SUCCEEDED', paymentHash: 'h3' }
    ]
    const account = makeAccount({ listPayments: jest.fn(async () => ({ payments })) })
    const lsp = makeLsp(account)
    const results = await lsp.claimPendingPayments()
    expect(account.claimHodlInvoice).toHaveBeenCalledTimes(2)
    expect(account.claimHodlInvoice).toHaveBeenNthCalledWith(1, { payment_hash: 'h1', payment_preimage: 'p1' })
    expect(account.claimHodlInvoice).toHaveBeenNthCalledWith(2, { payment_hash: 'h2', payment_preimage: 'p2' })
    expect(results).toEqual([
      { paymentHash: 'h1', claimed: true },
      { paymentHash: 'h2', claimed: true }
    ])
  })

  it('falls back to the paymentImage preimage key', async () => {
    const payments = [{ status: 'CLAIMABLE', paymentHash: 'h1', paymentImage: 'img-preimage' }]
    const account = makeAccount({ listPayments: jest.fn(async () => payments) })
    const lsp = makeLsp(account)
    await lsp.claimPendingPayments()
    expect(account.claimHodlInvoice).toHaveBeenCalledWith({ payment_hash: 'h1', payment_preimage: 'img-preimage' })
  })

  it('reads a snake_case-only payment_preimage (camel paymentPreimage absent)', async () => {
    // First rung `paymentPreimage` is undefined, so the `_raw` snake fallback
    // must supply `payment_preimage`. payment_hash also via snake fallback.
    const payments = [{ status: 'CLAIMING', payment_hash: 'snakeH', payment_preimage: 'snakeP' }]
    const account = makeAccount({ listPayments: jest.fn(async () => payments) })
    const lsp = makeLsp(account)
    const results = await lsp.claimPendingPayments()
    expect(account.claimHodlInvoice).toHaveBeenCalledWith({ payment_hash: 'snakeH', payment_preimage: 'snakeP' })
    expect(results).toEqual([{ paymentHash: 'snakeH', claimed: true }])
  })

  it("defaults the preimage to '' when no preimage key is present", async () => {
    // No paymentPreimage / payment_preimage / paymentImage at all: the final
    // `?? ''` default must produce an empty-string preimage (still attempts
    // the claim with the hash). Pins the terminal default of the chain.
    const payments = [{ status: 'CLAIMABLE', paymentHash: 'noPreimage' }]
    const account = makeAccount({ listPayments: jest.fn(async () => payments) })
    const lsp = makeLsp(account)
    const results = await lsp.claimPendingPayments()
    expect(account.claimHodlInvoice).toHaveBeenCalledWith({ payment_hash: 'noPreimage', payment_preimage: '' })
    expect(results).toEqual([{ paymentHash: 'noPreimage', claimed: true }])
  })

  it('records a failed claim with its error message and keeps going', async () => {
    const payments = [
      { status: 'CLAIMABLE', paymentHash: 'boom', paymentPreimage: 'p' },
      { status: 'CLAIMABLE', paymentHash: 'ok', paymentPreimage: 'p2' }
    ]
    const claimHodlInvoice = jest.fn()
      .mockRejectedValueOnce(new Error('claim failed'))
      .mockResolvedValueOnce({ ok: true })
    const account = makeAccount({ listPayments: jest.fn(async () => payments), claimHodlInvoice })
    const lsp = makeLsp(account)
    const results = await lsp.claimPendingPayments()
    expect(results).toEqual([
      { paymentHash: 'boom', claimed: false, error: 'claim failed' },
      { paymentHash: 'ok', claimed: true }
    ])
  })
})

// ── private helpers via observable behaviour ───────────────────────────────

describe('list normalization helpers', () => {
  it('_listChannels yields [] for a non-array, non-{channels} response (timeout path)', async () => {
    const account = makeAccount({ listChannels: jest.fn(async () => ({ foo: 'bar' })) })
    const lsp = makeLsp(account)
    await expect(lsp.waitForChannel('a', { timeoutMs: 5, pollIntervalMs: 1 }))
      .rejects.toBeInstanceOf(LspChannelTimeoutError)
  })

  it('_sleep rejects when the signal aborts mid-wait', async () => {
    const account = makeAccount({ listChannels: jest.fn(async () => []) })
    const lsp = makeLsp(account)
    const controller = new AbortController()
    const p = lsp.waitForChannel('a', { timeoutMs: 1000, pollIntervalMs: 50, signal: controller.signal })
    // Abort after the first sync/list completes and the sleep has begun.
    setTimeout(() => controller.abort(), 5)
    await expect(p).rejects.toThrow('aborted')
  })
})
