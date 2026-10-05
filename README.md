# GuardRail

Android-first Solana wallet security companion. Connects to an existing wallet via Mobile Wallet Adapter, scans SPL Token accounts for active delegates, explains them, and lets the owner revoke a supported delegate with on-chain verification.

- Network: Solana Devnet only (override RPC via `EXPO_PUBLIC_SOLANA_RPC_URL`, see `.env.example`).
- Built on the official Solana Mobile `kit-expo-minimal` template (`@solana/kit`, `@wallet-ui/react-native-kit`, Expo Router).
- Build environment and known blockers: [docs/BUILD_ENVIRONMENT.md](docs/BUILD_ENVIRONMENT.md).

## Scripts

- `npm start` / `npm run dev` — Metro bundler (dev client)
- `npx tsc --noEmit` — typecheck
- `npm run lint:check` — ESLint
- `npm run format:check` — Prettier
- `npm run android` — build and run on Android (requires Java + Android SDK)
