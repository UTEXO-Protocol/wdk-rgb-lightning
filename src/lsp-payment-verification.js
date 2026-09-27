import { exactUnsignedNumber } from './released-native-contract.js'
import { assertAddressQuote, decodedInvoice } from './lsp-linked-assets.js'
import { snakeCaseLnParams } from './lsp-utils.js'

export function rejectRoutingFeeCap (options = {}) {
  if ('maxTotalRoutingFeeMsat' in options || 'max_total_routing_fee_msat' in options) {
    const error = new Error('RLN 0.13 cannot enforce a routing fee cap')
    error.code = 'ERR_RLN_UNSUPPORTED_CAPABILITY'
    throw error
  }
}

export function paymentExpectation (ln) {
  if (!ln || typeof ln !== 'object' || Array.isArray(ln)) {
    throw new TypeError('Explicit Lightning payment parameters are required')
  }
  rejectRoutingFeeCap(ln)
  const amtMsat = exactUnsignedNumber(ln.amtMsat, 'amountMsat')
  if (amtMsat === 0) throw new TypeError('amountMsat must be positive')
  const assetId = ln.assetId
  const assetAmount = ln.assetAmount === undefined
    ? undefined
    : exactUnsignedNumber(ln.assetAmount, 'assetAmount')
  if ((assetId === undefined) !== (assetAmount === undefined) ||
      (assetId !== undefined && (typeof assetId !== 'string' || !assetId.trim() || assetAmount === 0))) {
    throw new TypeError('An explicit assetId and positive assetAmount must be supplied together')
  }
  const constraints = snakeCaseLnParams({
    paymentHash: ln.paymentHash,
    descriptionHash: ln.descriptionHash,
    minFinalCltvExpiryDelta: ln.minFinalCltvExpiryDelta,
    expirySec: ln.expirySec
  })
  return {
    amtMsat,
    assetId,
    assetAmount,
    paymentHash: constraints.payment_hash,
    descriptionHash: constraints.description_hash,
    minFinalCltvExpiryDelta: constraints.min_final_cltv_expiry_delta,
    expirySeconds: constraints.expiry_sec
  }
}

export function requireInvoiceDecoder (account) {
  if (typeof account.decodeInvoice !== 'function') {
    throw new TypeError('account.decodeInvoice is required for local payment verification')
  }
}

export async function verifyPaymentInvoice (account, invoice, expected) {
  requireInvoiceDecoder(account)
  const decoded = decodedInvoice(await account.decodeInvoice(invoice), 'LSP payment invoice')
  assertAddressQuote(decoded, expected)
}
