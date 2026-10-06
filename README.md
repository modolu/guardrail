# GuardRail

Android-first Solana wallet security companion. It connects to your existing wallet with Mobile Wallet Adapter, scans
your standard SPL Token accounts for active delegate approvals, explains each one in plain language, lets you revoke a
supported delegate, and then verifies on-chain that the delegate is really gone.

> **Status (hackathon build, Solana Devnet only).** The scan, revoke and verify logic is implemented and checked offline
> from Node. No APK has been built, the Android app has **not** been run on a device or emulator, and the Devnet demo
> fixture has **not** been created yet. See [Limitations and unverified items](#limitations-and-unverified-items) and
> [Current blocker](#current-blocker-devnet-fixture-funding).

## Submission links

- GitHub: <https://github.com/modolu/guardrail>
- APK: **TODO** `<APK download URL>`
- Demo video: **TODO** `<demo video URL>`
- Solana dApp Store: **TODO** `<dApp Store listing URL>` (not submitted)
- Revoke transaction proof: **TODO** `<Devnet Explorer link>`

Details: [docs/SUBMISSION.md](docs/SUBMISSION.md), [docs/DAPP_STORE_SUBMISSION.md](docs/DAPP_STORE_SUBMISSION.md).

## What it does

1. **Connect** a wallet through Mobile Wallet Adapter.
2. **Scan** the wallet's standard SPL Token accounts on Devnet for an active delegate.
3. **Explain** each delegate with objective wording: _"This address can transfer or burn up to the delegated amount from
   this token account while the delegation remains active."_
4. **Revoke** a supported delegate. The review screen shows what will change and what stays the same before anything is
   sent to the wallet.
5. **Verify**: wait for confirmation, re-read the exact token account, and show success only if the delegate is gone.

## Setup

Requirements: Node 22 and npm. Running the app also needs Java, the Android SDK and a device or emulator, which are not
needed for the checks below.

```sh
npm install
cp .env.example .env     # optional; only overrides the Devnet RPC endpoint
npm start                # Metro (dev client)
npm run android          # build and run on Android (needs Java + Android SDK + device/emulator)
```

`EXPO_PUBLIC_SOLANA_RPC_URL` overrides the Devnet RPC (default `https://api.devnet.solana.com`). The cluster stays
Devnet either way. `EXPO_PUBLIC_*` values are embedded in the app bundle, so never put a private RPC key there for a
published build. See [docs/BUILD_ENVIRONMENT.md](docs/BUILD_ENVIRONMENT.md) for versions and the Android toolchain.

## Verification commands

All of these run on a laptop with no device. Only the two fixture commands need the network.

- `npm run ci`: typecheck, lint, format check and `expo prebuild -p android` in one command
- `npx tsc --noEmit`: TypeScript strict typecheck
- `npm run lint:check`: ESLint (Expo config)
- `npm run format:check`: Prettier
- `npm run verify:scanner`: token account and mint parsing, option tags, finding construction, wording rules
- `npm run verify:revoke`: preconditions, single `Revoke` instruction, cancellation, stale state, confirmation,
  verification
- `npm run verify:flow`: scan -> revoke -> verify end to end against a fake RPC
- `npm run doctor`: expo-doctor
- `npm run fixture:create`: creates or reuses the Devnet fixture (needs a funded owner, see below; uses the network)
- `npm run fixture:verify`: read-only check of the fixture on Devnet (uses the network)
- `npm run android:build`: `expo prebuild -p android`, generates the ignored `android/` project (no Gradle build)

## Devnet fixture

The demo needs a wallet whose standard SPL Token account has an active delegate. `npm run fixture:create` makes one on
Devnet: dev-only owner and delegate keys in `.local/fixture/` (gitignored), a 6-decimal mint, 1000 tokens minted to the
owner, and a 500-token approval to the delegate, then verifies it with GuardRail's own scanner. `npm run fixture:verify`
re-checks it read-only; after a successful revoke it is **expected to fail**, which is independent proof the delegate is
gone. Full details, reset steps and the Android checklist are in [docs/DEMO.md](docs/DEMO.md).

Fixture addresses (public):

- Owner: `EQ8twh3xGQafRDsuGSwDho2Qqd7aYVswcjQ9YyJTE2nh`
- Delegate: `ChTVBqLPsujEc3NYaJStzRkRJTy9kaWDjqkpreeEu2Fi`

Keys are never printed or committed.

## Current blocker: Devnet fixture funding

The public Devnet faucet returned **HTTP 429** for every airdrop request for the owner address above (last tried
2026-10-06; balance still 0). The owner needs
at least **0.05 Devnet SOL** before `npm run fixture:create` can run. Until then there is no real delegate on Devnet and
no real revoke transaction exists. Fund the owner at <https://faucet.solana.com> (Devnet) or from another Devnet wallet,
or point `EXPO_PUBLIC_SOLANA_RPC_URL` at another Devnet RPC, then rerun `npm run fixture:create`.

## Demo flow

1. `npm run fixture:create` and `npm run fixture:verify` (delegate of 500 tokens is present).
2. In GuardRail, connect the wallet that controls the fixture owner, then tap **Scan Wallet**.
3. Open the delegate, read the explanation, tap **Review revoke**.
4. Approve the single `Revoke` instruction in the wallet.
5. The result screen shows **Delegate removed** only after Devnet confirms and the token account is re-read.
6. `npm run fixture:verify` now fails, and the transaction is visible on Solana Explorer (Devnet).

Steps 2-5 are unverified on Android. Manual checklist: [docs/DEMO.md](docs/DEMO.md#manual-android-checklist-once-a-device-exists).

## Architecture

```
app/                      Expo Router screens
  index.tsx               connect wallet, scan, list findings
  permission/[id].tsx     explain one finding
  revoke/[id].tsx         "what will change" review, then wallet approval
  result/[id].tsx         confirm on Devnet, re-read account, show verified / not verified
src/solana/
  rpc.ts                  Kit 6 Devnet RPC
  scanPermissions.ts      strict token account parser and scanner
  revoke.ts               preconditions, fresh re-check, Revoke instruction, confirmation, verification
src/hooks/                scan, finding lookup, revoke submission, revoke verification (TanStack Query cache)
src/components, constants, types, utils
scripts/                  offline verifiers and Devnet fixture scripts
```

- Stack: React Native, TypeScript strict, Expo SDK 55 + Expo Router, `@solana/kit` 6, `@solana-program/token` 0.14,
  `@wallet-ui/react-native-kit`. No `@solana/web3.js`, no backend, no analytics.
- Two Kit versions: `@wallet-ui/react-native-kit` bundles `@solana/kit` 7.x while the app uses 6.x, so the app has its own
  Kit 6 RPC, and the revoke instruction crosses into the wallet library through one documented cast. `verify:revoke`
  compiles the instruction with the wallet library's Kit to check that the real shape matches.
- Findings are read from the TanStack Query cache of the connected wallet's own scan. Route params are only lookup keys,
  so a stale or malformed id shows a calm "not in the latest scan" screen instead of acting on anything.
- The revoke path: preconditions (connected wallet owns the account, standard SPL Token program, not frozen, mint
  readable) -> re-read the exact account and refuse if it changed -> one transaction with only `Revoke` -> poll
  `getSignatureStatuses` until `confirmed`/`finalized` (45 s) -> re-read the account at or after that slot -> success only
  if it has no delegate. Retrying verification only reads; it never sends another transaction.

## Security model

- GuardRail reports objective on-chain facts. It never labels an address malicious, dangerous or a scam, never scores or
  rates addresses, and never claims a wallet is safe. "No supported active delegates" means only that the latest scan
  found none on standard SPL Token accounts on Devnet.
- Private keys never reach GuardRail. Signing happens in the user's wallet through Mobile Wallet Adapter.
- The only state-changing operation is SPL Token `Revoke` for one token account, and only when the connected wallet is
  its owner. Anything else (Token-2022, other authorities, frozen accounts, unreadable mints) is view-only. Unimplemented
  authority types are never mutated.
- Success is never inferred from a transaction signature alone; it requires confirmation and a re-read of the account.
- Wallet cancellation is a normal outcome (`SIGNATURE_REJECTED`): nothing is sent and the user can try again.
- Fixture keys are development-only, live in ignored `.local/`, and are excluded by `.gitignore` patterns
  (`.local/`, `*keypair*.json`, `*.keystore`, `.env`). Never reuse a real wallet key with the fixture.
- The Devnet RPC provider can see the connected wallet address and the device's IP address. The app makes no other
  requests of its own; the Explorer link opens in the browser only when tapped.

Error codes shown in the UI: `WALLET_NOT_CONNECTED`, `RPC_UNAVAILABLE`, `TOKEN_ACCOUNT_PARSE_FAILED`,
`UNSUPPORTED_AUTHORITY`, `REVOKE_NOT_SUPPORTED`, `SIGNATURE_REJECTED`, `TRANSACTION_FAILED`, `VERIFICATION_FAILED`.

## Limitations and unverified items

Out of scope: mainnet, iOS, Token-2022 and extension mutation, other authority types, watch mode or history, push
notifications, backend or database, analytics, security scoring or reputation, AI features, multi-wallet monitoring.

**Not verified on Android (no Java, Android SDK, emulator or device on the build machine):**

- Building and installing the APK. `expo prebuild` runs, but the Gradle build does not (see
  [docs/BUILD_ENVIRONMENT.md](docs/BUILD_ENVIRONMENT.md#release-apk-not-built-yet)).
- Mobile Wallet Adapter connect, disconnect and `sendTransactions` against a real wallet, including the real
  cancellation error shapes (`isWalletRejection` matches the documented ones by name and code).
- That the wallet shows a single `Revoke` instruction with the owner as signer.
- Real Devnet timing, the 45 s confirmation window, and behaviour with airplane mode or a rate-limited RPC.
- UI layout, scrolling, hardware back behaviour and screenshots.

**Not yet done on Devnet:** the fixture has not been created (see the blocker above), so no real revoke has been run.

## Docs

- [docs/SUBMISSION.md](docs/SUBMISSION.md) - hackathon submission sheet
- [docs/DAPP_STORE_SUBMISSION.md](docs/DAPP_STORE_SUBMISSION.md) - dApp Store prep checklist (not submitted)
- [docs/DEMO.md](docs/DEMO.md) - fixture, revoke flow and manual Android checklist
- [docs/BUILD_ENVIRONMENT.md](docs/BUILD_ENVIRONMENT.md) - toolchain and dependency notes
