# Build Environment

Recorded 2026-10-05 on macOS (Darwin 23.4.0).

## Toolchain

| Tool | Version |
| ---- | ------- |
| Node | 22.12.0 |
| npm  | 10.9.0  |

## Key dependencies (from `package.json`)

| Package                        | Declared range |
| ------------------------------ | -------------- |
| expo                           | ~55.0.23       |
| expo-router                    | ~55.0.7        |
| expo-dev-client                | ~55.0.18       |
| react                          | 19.2.0         |
| react-native                   | 0.83.6         |
| @solana/kit                    | ^6.1.0         |
| @wallet-ui/react-native-kit    | ^4.0.1         |
| @solana-program/memo           | ^0.11.0        |
| @solana-program/token          | ^0.14.0        |
| @tanstack/react-query          | ^5.90.7        |
| react-native-quick-crypto      | ^0.7.17        |
| react-native-get-random-values | ~1.11.0        |
| typescript                     | ~5.9.2         |
| eslint                         | ^9.25.0        |
| eslint-config-expo             | ~55.0.0        |
| prettier                       | ^3.8.1         |

Exact resolved versions are pinned in `package-lock.json`.

### Why `@solana-program/token`

`@solana/kit` ships no SPL Token account/mint decoders. `@solana-program/token` is the official Kit-native SPL Token
client (Codama-generated) and provides `getTokenDecoder`, `getMintDecoder`, `TOKEN_PROGRAM_ADDRESS`, and the revoke
instruction builder needed later. It is pinned to `^0.14.0` because that is the newest line whose peer dependency
(`@solana/kit ^6.5.0`) matches the app's Kit 6.x; 0.15+ requires Kit 7/8. It pulls in `@solana-program/system`
transitively. No `@solana/web3.js`.

### Two `@solana/kit` versions

`@wallet-ui/react-native-kit@4.3` bundles its own `@solana/kit@7.x`, while the app uses `@solana/kit@6.x`. Their RPC
types are not assignable to each other, so the scanner uses its own Kit 6 Devnet RPC (`src/solana/rpc.ts`) built from
the same `SOLANA_RPC_URL` as the wallet provider, rather than `useMobileWallet().client.rpc`. Transactions handed to the
wallet for signing (revoke) will cross this boundary and need checking when that work starts.

## Not installed (Android blockers)

- **Java / JDK**: not installed (`java -version` → "Unable to locate a Java Runtime").
- **Android SDK**: not installed (`ANDROID_HOME` unset, no `~/Library/Android/sdk`, no `adb`).
- **Android emulator / device**: none available.

Consequences: `npm run android` and `npm run android:build` (prebuild + Gradle) cannot be run or verified.
Everything on Android — Mobile Wallet Adapter connection, signing, and UI — is **unverified** until these are installed.

## Checks that run without a device

```sh
npx tsc --noEmit
npm run lint:check
npm run format:check
npm run verify:scanner        # deterministic SPL Token parser/scanner checks (Node, no network)
npx expo export --platform android --output-dir /tmp/guardrail-export   # proves Metro bundling for Android
```

`verify:scanner` compiles `scripts/verify-scanner.ts` with `scripts/tsconfig.verify.json` into the ignored
`.local/build/verify/` and runs it with Node. Fixtures are hand-built SPL Token Account (165 B) and Mint (82 B) byte
layouts, so they check the decoder rather than reuse it.
