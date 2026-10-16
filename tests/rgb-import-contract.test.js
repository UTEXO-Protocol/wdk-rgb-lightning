import {
  validateImportRgbContractRequest,
  validateImportRgbContractResult,
  validateImportRgbTransferConsignmentRequest,
  validateImportRgbTransferConsignmentResult
} from '../src/rgb-import-contract.js'

const TXID = 'AB'.repeat(32)
const ASSET_ID = 'rgb:approved'

describe('RGB import boundary contract', () => {
  it('normalizes a transfer request without changing its binary payload', () => {
    expect(validateImportRgbTransferConsignmentRequest({
      consignment_base64: 'Y29uc2lnbm1lbnQ=',
      offchain_txid: TXID,
      expected_asset_id: ASSET_ID
    })).toEqual({
      consignment_base64: 'Y29uc2lnbm1lbnQ=',
      offchain_txid: TXID.toLowerCase(),
      expected_asset_id: ASSET_ID
    })
  })

  it('requires an exact, bounded transfer request shape', () => {
    expect(() => validateImportRgbTransferConsignmentRequest({
      consignment_base64: '',
      offchain_txid: TXID
    })).toThrow('consignment_base64')
    expect(() => validateImportRgbTransferConsignmentRequest({
      consignment_base64: 'YQ==',
      offchain_txid: 'not-a-txid'
    })).toThrow('offchain_txid')
    expect(() => validateImportRgbTransferConsignmentRequest({
      consignment_base64: 'YQ==',
      offchain_txid: TXID,
      typo: true
    })).toThrow('contain only')
  })

  it('requires an expected asset id for standalone contract imports', () => {
    expect(validateImportRgbContractRequest({
      contract_base64: 'Y29udHJhY3Q=',
      expected_asset_id: ASSET_ID
    })).toEqual({
      contract_base64: 'Y29udHJhY3Q=',
      expected_asset_id: ASSET_ID
    })
    expect(() => validateImportRgbContractRequest({
      contract_base64: 'Y29udHJhY3Q='
    })).toThrow('contain expected_asset_id')
  })

  it('rejects native results for a different asset', () => {
    const result = {
      asset_id: 'rgb:other',
      already_imported: false,
      metadata: {}
    }
    expect(() => validateImportRgbContractResult(result, ASSET_ID))
      .toThrow('equal expected_asset_id')
    expect(() => validateImportRgbTransferConsignmentResult(result, ASSET_ID))
      .toThrow('equal expected_asset_id')
  })

  it('accepts idempotent, metadata-only native results', () => {
    expect(validateImportRgbContractResult({
      asset_id: ASSET_ID,
      already_imported: true,
      metadata: { ticker: 'USDT' }
    }, ASSET_ID)).toEqual({
      asset_id: ASSET_ID,
      already_imported: true,
      metadata: { ticker: 'USDT' }
    })
  })
})
