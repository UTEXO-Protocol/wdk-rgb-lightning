import type WalletManager from '@tetherto/wdk-wallet'
import type { IWalletAccount, IWalletAccountReadOnly } from '@tetherto/wdk-wallet'

import type WalletManagerRgbLightning from '../index.js'
import type {
  WalletAccountReadOnlyRgbLightning,
  WalletAccountRgbLightning
} from '../index.js'

declare const manager: WalletManagerRgbLightning
declare const account: WalletAccountRgbLightning
declare const readOnlyAccount: WalletAccountReadOnlyRgbLightning

const managerContract: WalletManager = manager
const accountContract: IWalletAccount = account
const readOnlyContract: IWalletAccountReadOnly = readOnlyAccount

void managerContract
void accountContract
void readOnlyContract
