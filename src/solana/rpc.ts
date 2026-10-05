import { createSolanaRpc, devnet } from '@solana/kit'
import { SOLANA_RPC_URL } from '@/constants/app-config'

// Same Devnet endpoint as the MobileWalletProvider cluster. Created with the app's own @solana/kit (6.x) rather than
// reusing `useMobileWallet().client.rpc`, because @wallet-ui/react-native-kit bundles @solana/kit 7.x and its RPC
// types are not assignable to the 6.x types that @solana-program/token 0.14 is built against.
export const devnetRpc = createSolanaRpc(devnet(SOLANA_RPC_URL))
