// Copyright 2026 UTEXO.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.

// Unit tests for the NodeRgbLightningBinding request-mapping logic — the
// pure config -> RLN init-request translation done in the constructor.
// The native addon `@utexo/rgb-lightning-node-nodejs` is replaced by the
// jest mock wired in package.json (`moduleNameMapper`), so no `.node`
// binary is loaded.

import { NodeRgbLightningBinding } from '../src/node-binding.js'

describe('NodeRgbLightningBinding._initRequest', () => {
  it('applies defaults and omits opt-in fields for a minimal config', () => {
    const binding = new NodeRgbLightningBinding({ network: 'regtest', dataDir: '/data' })
    expect(binding._initRequest).toEqual({
      storage_dir_path: '/data',
      daemon_listening_port: 0,
      ldk_peer_listening_port: 0,
      network: 'regtest',
      max_media_upload_size_mb: 5,
      enable_virtual_channels_v0: false,
      reuse_addresses: true
    })
    // None of the opt-in keys should be present.
    expect(binding._initRequest).not.toHaveProperty('virtual_peer_pubkeys')
    expect(binding._initRequest).not.toHaveProperty('vss_url')
    expect(binding._initRequest).not.toHaveProperty('lsp_base_url')
  })

  it('forwards explicit ports, media size and virtual-channels flag', () => {
    const binding = new NodeRgbLightningBinding({
      network: 'testnet',
      dataDir: '/d',
      daemonListeningPort: 3001,
      ldkPeerListeningPort: 9735,
      maxMediaUploadSizeMb: 10,
      enableVirtualChannelsV0: true
    })
    expect(binding._initRequest).toMatchObject({
      daemon_listening_port: 3001,
      ldk_peer_listening_port: 9735,
      max_media_upload_size_mb: 10,
      enable_virtual_channels_v0: true
    })
  })

  it('forwards virtual_peer_pubkeys only when the list is non-empty', () => {
    const empty = new NodeRgbLightningBinding({ network: 'regtest', dataDir: '/d', virtualPeerPubkeys: [] })
    expect(empty._initRequest).not.toHaveProperty('virtual_peer_pubkeys')

    const withPeers = new NodeRgbLightningBinding({ network: 'regtest', dataDir: '/d', virtualPeerPubkeys: ['02abc'] })
    expect(withPeers._initRequest.virtual_peer_pubkeys).toEqual(['02abc'])
  })

  it('forwards VSS and LSP fields only when opted in', () => {
    const binding = new NodeRgbLightningBinding({
      network: 'regtest',
      dataDir: '/d',
      vssUrl: 'https://vss.example',
      vssAllowHttp: true,
      vssAllowEmptyRestore: true,
      lspBaseUrl: 'https://lsp.example',
      lspBearerToken: 'tok'
    })
    expect(binding._initRequest).toMatchObject({
      vss_url: 'https://vss.example',
      vss_allow_http: true,
      vss_allow_empty_restore: true,
      lsp_base_url: 'https://lsp.example',
      lsp_bearer_token: 'tok'
    })
  })

  it('vssStatus reflects the constructed config without a server round-trip', () => {
    const off = new NodeRgbLightningBinding({ network: 'regtest', dataDir: '/d' })
    expect(off.vssStatus()).toEqual({ configured: false, url: null, allowHttp: false, lastBackupVersion: null })

    const on = new NodeRgbLightningBinding({ network: 'regtest', dataDir: '/d', vssUrl: 'https://vss.example', vssAllowHttp: true })
    expect(on.vssStatus()).toEqual({
      configured: true,
      url: 'https://vss.example',
      allowHttp: true,
      lastBackupVersion: null
    })
  })
})
