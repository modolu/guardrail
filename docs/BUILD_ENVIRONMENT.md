# Build Environment

Recorded 2026-10-05 on macOS (Darwin 23.4.0); rechecked 2026-10-06.

## Toolchain

| Tool | Version |
| ---- | ------- |
| Node | 22.12.0 |
| npm  | 10.9.0  |

`@solana-program/token@0.14.0` declares `node >=24`, so npm prints an `EBADENGINE` warning on Node 22. Install,
typecheck, verifiers and the Android JS bundle all work on Node 22.12.

## Key dependencies (from `package.json`)

| Package                        | Declared range |
| ------------------------------ | -------------- |
| expo                           | ~55.0.23       |
| expo-router                    | ~55.0.7        |
| expo-dev-client                | ~55.0.18       |
| react                          | 19.2.0         |
| react-native                   | 0.83.10        |
| react-native-reanimated        | 4.2.1          |
| @solana/kit                    | ^6.1.0         |
| @wallet-ui/react-native-kit    | ^4.0.1         |
| @solana-program/memo           | ^0.11.0        |
| @solana-program/token          | ^0.14.0        |
| @solana-program/system         | ^0.12.2        |
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

`@solana-program/system` is declared directly (same version that token 0.14 already installs, peer `@solana/kit ^6.4`)
because the Devnet fixture script uses its `CreateAccount` instruction to allocate the demo mint. It adds no new code
to `node_modules` and is not used by the app.

### Two `@solana/kit` versions

`@wallet-ui/react-native-kit@4.3` bundles its own `@solana/kit@7.x`, while the app uses `@solana/kit@6.x`. Their RPC
types are not assignable to each other, so the scanner uses its own Kit 6 Devnet RPC (`src/solana/rpc.ts`) built from
the same `SOLANA_RPC_URL` as the wallet provider, rather than `useMobileWallet().client.rpc`. The revoke instruction
crosses this boundary through one documented cast in `src/hooks/useRevokeSubmission.ts`; `npm run verify:revoke`
compiles it with the wallet library's Kit 7 to check the runtime shape.

## Not installed (Android blockers)

- **Java / JDK**: not installed (`java -version` → "Unable to locate a Java Runtime").
- **Android SDK**: not installed (`ANDROID_HOME` unset, no `~/Library/Android/sdk`, no `adb`).
- **Android emulator / device**: none available.

- **Disk**: about 3.3 GiB free on 2026-10-06, which is not enough for a JDK, the Android SDK and NDK, the Gradle cache
  and a four-ABI React Native build.

Consequences: `npm run android` and the Gradle build cannot run, so **no APK has been built**. `npm run android:build`
is only `expo prebuild -p android`, which does run (it is part of `npm run ci`) and generates the ignored `android/`
project. Everything on Android (Mobile Wallet Adapter connection, signing and UI) is **unverified** until the toolchain
and a device or emulator exist.

## Release APK (not built yet)

Once a JDK 17 and the Android SDK are installed (`ANDROID_HOME` set, or `android/local.properties` with `sdk.dir`):

```sh
npm ci
npm run android:build                      # expo prebuild -p android
cd android && ./gradlew assembleRelease    # output: android/app/build/outputs/apk/release/app-release.apk
```

Release metadata comes from `app.json`: app name `GuardRail`, package `com.guardrail.app`, version `1.0.0`,
`versionCode` 1 (bump it for every uploaded build). `android.blockedPermissions` removes `SYSTEM_ALERT_WINDOW` and the
external storage permissions from the main manifest, which leaves `INTERNET` and the template's `VIBRATE`. Debug builds
still get `SYSTEM_ALERT_WINDOW` from the generated debug manifest for the dev client. The final merged manifest has not
been checked because Gradle has not run. Check it with `aapt dump permissions` on the built APK.

Signing: the generated `android/app/build.gradle` signs `release` with the template `debug.keystore`. That is enough
for a sideloadable hackathon APK, but not for the dApp Store, which needs a dedicated release key that is kept for every
future update. To set one up, create the keystore with `keytool` **outside the repo**, put the passwords in
`~/.gradle/gradle.properties` (not in the repo), and point `signingConfigs.release` at them in
`android/app/build.gradle`. `android/` is generated and ignored, so redo that edit after `expo prebuild --clean`.
`*.keystore`, `*.jks` and `keystore.properties` are gitignored. EAS Build with Expo-managed credentials is an
alternative, but it needs the owner's Expo account.

## Checks that run without a device

```sh
npm run ci                    # tsc --noEmit, lint:check, format:check, expo prebuild -p android
npm run verify:scanner        # deterministic SPL Token parser/scanner checks (Node, no network)
npm run verify:revoke         # revoke preconditions, instruction, confirmation, verification (fake RPC)
npm run verify:flow           # scan -> revoke -> verify end to end (fake RPC)
npm run doctor                # expo-doctor
npx expo export --platform android --output-dir /tmp/guardrail-export   # production Hermes bundle for Android
```

Results on 2026-10-06: `ci` passes, `verify:scanner` 17/17, `verify:revoke` 25/25, `verify:flow` 5/5, expo-doctor 20/20,
and the Android export produces a 6.5 MB Hermes bundle.

`verify:scanner` compiles `scripts/verify-scanner.ts` with `scripts/tsconfig.verify.json` into the ignored
`.local/build/verify/` and runs it with Node. Fixtures are hand-built SPL Token Account (165 B) and Mint (82 B) byte
layouts, so they check the decoder rather than reuse it.
