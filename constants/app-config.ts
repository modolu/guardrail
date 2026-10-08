import { AppIdentity, createSolanaDevnet, SolanaCluster } from '@wallet-ui/react-native-kit'

// GuardRail runs on Solana Devnet only. EXPO_PUBLIC_SOLANA_RPC_URL may override the Devnet RPC endpoint,
// but the cluster stays Devnet; never add mainnet here.
export const DEFAULT_DEVNET_RPC_URL = 'https://api.devnet.solana.com'

export const SOLANA_RPC_URL = process.env.EXPO_PUBLIC_SOLANA_RPC_URL?.trim() || DEFAULT_DEVNET_RPC_URL

export class AppConfig {
  static identity: AppIdentity = { name: 'GuardRail' }
  static networks: SolanaCluster[] = [createSolanaDevnet({ url: SOLANA_RPC_URL })]
}

// Devnet demo setup (docs/DEMO.md). Off unless the build sets EXPO_PUBLIC_DEMO_SETUP=1. Public addresses only.
// Read with literal `process.env.EXPO_PUBLIC_*` access so Expo inlines the values at build time.
export const DEMO_SETUP_ENV = {
  setup: process.env.EXPO_PUBLIC_DEMO_SETUP,
  mint: process.env.EXPO_PUBLIC_DEMO_MINT,
  delegate: process.env.EXPO_PUBLIC_DEMO_DELEGATE,
}
