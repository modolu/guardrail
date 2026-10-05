import { AppIdentity, createSolanaDevnet, SolanaCluster } from '@wallet-ui/react-native-kit'

// GuardRail runs on Solana Devnet only. EXPO_PUBLIC_SOLANA_RPC_URL may override the Devnet RPC endpoint,
// but the cluster stays Devnet; never add mainnet here.
export const DEFAULT_DEVNET_RPC_URL = 'https://api.devnet.solana.com'

export const SOLANA_RPC_URL = process.env.EXPO_PUBLIC_SOLANA_RPC_URL?.trim() || DEFAULT_DEVNET_RPC_URL

export class AppConfig {
  static identity: AppIdentity = { name: 'GuardRail' }
  static networks: SolanaCluster[] = [createSolanaDevnet({ url: SOLANA_RPC_URL })]
}
