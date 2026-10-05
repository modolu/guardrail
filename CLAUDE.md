# GuardRail — Claude Code Project Context

## Project
GuardRail is an Android-first Solana wallet security companion. It connects to an existing Solana wallet using Mobile Wallet Adapter, scans standard SPL Token accounts for active delegate permissions, explains those permissions in plain language, lets the owner revoke a supported delegate, then verifies the state change on Solana Devnet.

Hackathon priority: connect wallet -> scan -> detect delegate -> explain -> revoke -> verify on-chain.
Do not broaden scope unless explicitly instructed.

## Deadline
Submission date: 2026-10-08 GMT+1. Reliability of the primary demo path is more important than feature breadth.

## Current constraint
No Android emulator/device is available yet. Build everything that can be implemented and verified without one. Do not block on emulator-specific testing; clearly mark what remains unverified on Android.

## Platform
Android only. Solana Devnet only. Mobile Wallet Adapter. No iOS work.

## Tech stack
Prefer the current official Solana Mobile React Native/Expo Kit stack for a fresh project.
- React Native + TypeScript strict mode
- Expo / Expo Router if current official scaffold uses them
- @solana/kit
- @wallet-ui/react-native-kit
- official Solana token program libraries compatible with Kit
- TanStack Query only if already part of the chosen scaffold or clearly needed
- React Context/local state; no Redux
- Jest or scaffold-provided tests
- ESLint + TypeScript typecheck

Do not introduce legacy @solana/web3.js unless absolutely required by the current official starter and explicitly documented. Never mix competing Solana client stacks casually.

## Network
Hard-code hackathon runtime to Solana Devnet, with optional EXPO_PUBLIC_SOLANA_RPC_URL override. Default: https://api.devnet.solana.com. Never silently switch to mainnet.

## Folder direction
app/
  _layout.tsx
  index.tsx
  permission/[id].tsx
  revoke/[id].tsx
  result/[id].tsx
src/
  components/
  hooks/
  solana/
  types/
  utils/
  constants/
scripts/
  create-demo-fixture.ts
  verify-demo-fixture.ts
docs/
  DEMO.md
  ARCHITECTURE.md
  PRODUCT_BRIEF.md
  BUILD_ENVIRONMENT.md
  SUBMISSION.md

Avoid unnecessary layers.

## Core domain
PermissionFinding should preserve:
- id
- type
- tokenAccount
- mint
- owner
- tokenProgram
- delegate
- delegatedAmountRaw
- decimals
- delegatedAmountDisplay
- revocable
- explanationCode

Raw token amounts must be bigint or decimal strings. Never use floating point for raw token amounts.

## Supported scope
Mutation support: standard SPL Token account delegate only.
Unsupported authority or extension types are view-only/unsupported. Never mutate unimplemented authority types.

## Security language
GuardRail reports objective on-chain facts. Never label a delegate malicious, dangerous, scam, or compromised without external evidence. Never claim the wallet is universally safe.

Preferred explanation: “This address can transfer or burn up to the delegated amount from this token account while the delegation remains active.”

## Revoke invariants
Every state-changing operation must:
1. show what will change;
2. require wallet authorization;
3. submit only the intended instruction;
4. wait for confirmation;
5. refetch the exact affected token account;
6. verify the delegate state actually changed.

Never claim success based only on transaction submission.

## Error codes
WALLET_NOT_CONNECTED
RPC_UNAVAILABLE
TOKEN_ACCOUNT_PARSE_FAILED
UNSUPPORTED_AUTHORITY
REVOKE_NOT_SUPPORTED
SIGNATURE_REJECTED
TRANSACTION_FAILED
VERIFICATION_FAILED

Wallet cancellation is a normal outcome and must not crash the app.

## Secrets
Never commit seed phrases, private keys, signing keys, or private RPC credentials. Keep config in .env and safe examples in .env.example. Development fixture keys, if needed, must live in ignored local paths such as .local/.

## Styling
Use the scaffold's existing styling or React Native StyleSheet. Do not install a UI framework. Design: calm, minimal, high contrast, security-oriented, no alarmist red-heavy UI, no gamified security score.

## Scope cuts
Do not implement unless explicitly asked:
- Watch Mode/history
- push notifications
- backend/database
- analytics/crash SDK
- mainnet transactions
- Token-2022 extension mutation
- iOS
- security scoring/phishing/address reputation
- AI features
- multi-wallet monitoring

## Demo fixture
Provide a reproducible Devnet fixture workflow that creates or loads a development-only authority, obtains Devnet SOL where possible, creates an SPL mint, token account, mints demo tokens, approves a delegate for a known amount, verifies the delegate state, and prints relevant addresses/signatures. Never commit secrets.

## Commands
Maintain scripts for start, lint, typecheck, test, fixture:create, fixture:verify, and Android build/run as supported by the scaffold.

Before marking any task complete: run typecheck, lint, relevant tests, and any non-device build checks available. If Android cannot be run because no emulator/device exists, state that explicitly.

## Git
Commit after each working task with small descriptive messages. Do not force push. Do not rewrite unrelated files.

## Task rules
1. Inspect existing implementation first.
2. Make the smallest correct change.
3. Do not add dependencies without stating why.
4. Preserve working functionality.
5. Add tests for protocol/parsing logic.
6. Run relevant checks.
7. Summarize changed files and remaining risks.
8. Stop and report uncertainty rather than inventing protocol behavior.
