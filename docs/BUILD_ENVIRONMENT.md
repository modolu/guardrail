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
| @tanstack/react-query          | ^5.90.7        |
| react-native-quick-crypto      | ^0.7.17        |
| react-native-get-random-values | ~1.11.0        |
| typescript                     | ~5.9.2         |
| eslint                         | ^9.25.0        |
| eslint-config-expo             | ~55.0.0        |
| prettier                       | ^3.8.1         |

Exact resolved versions are pinned in `package-lock.json`.

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
```
