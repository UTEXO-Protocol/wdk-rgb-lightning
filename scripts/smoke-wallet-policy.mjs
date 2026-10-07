// Shared by fresh packed Node and Bare consumers. No network or funded wallet.
export async function smokeWalletPolicy (WalletManager, WebRgbProvider, LightningDisabledError, dataDir) {
  // Public deterministic fixture. Never fund this wallet.
  const manager = new WalletManager(new Uint8Array(64).fill(2), { network: 'mainnet', dataDir })
  try {
    const account = await manager.getAccount()
    const caps = account.getCapabilities()
    if (caps.network !== 'mainnet' || caps.lightning || caps.burn || !caps.bfaValidation || !caps.consignmentExport) {
      throw new Error('Incorrect mainnet capabilities')
    }
    for (const method of ['listChannels', 'listPayments', 'createInvoice', 'sendPayment', 'createLsp', 'bootstrapLsp']) {
      let rejected = false
      try { await account[method]() } catch (error) {
        if (!(error instanceof LightningDisabledError) || error.code !== 'LIGHTNING_DISABLED_ON_MAINNET') throw error
        rejected = true
      }
      if (!rejected) throw new Error(`Mainnet ${method} was not blocked`)
    }
    const provider = new WebRgbProvider(account, { origin: 'https://example.com', confirm: async () => true })
    await provider.enable()
    const info = await provider.getInfo()
    if (info.network !== 'mainnet' || !info.methods.includes('blindReceive') || info.methods.includes('burnAsset')) {
      throw new Error('Incorrect WebRGB methods')
    }
    provider.revoke()
    let rejected = false
    try { await provider.getAddress() } catch (error) {
      if (error.code !== 'NOT_ENABLED') throw error
      rejected = true
    }
    if (!rejected) throw new Error('Revoked WebRGB provider leaked an address')
    await account.shutdown()
    if (!account.isDisposed()) throw new Error('Closed account remains active')
  } finally {
    manager.dispose()
  }
}
