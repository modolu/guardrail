# Hackathon Submission

Submission date: **2026-10-08 (GMT+1)**. Items marked **TODO** are not done yet; nothing below claims they are.

## Project

- **Name:** GuardRail
- **One-line pitch:** An Android wallet security companion that shows which addresses are approved as delegates on your
  SPL Token accounts, lets you revoke one, and proves on-chain that it is gone.
- **Platform:** Android only, Solana Mobile Wallet Adapter
- **Network:** Solana Devnet only
- **GitHub:** <https://github.com/modolu/guardrail>
- **APK:** **TODO** `<APK download URL>` (no release APK has been built: no JDK or Android SDK on the build machine; see
  [BUILD_ENVIRONMENT.md](BUILD_ENVIRONMENT.md#release-apk-not-built-yet))
- **Demo video:** **TODO** `<demo video URL>` (not recorded; needs a device or emulator)
- **dApp Store:** **TODO** `<dApp Store listing URL>` (not submitted; see
  [DAPP_STORE_SUBMISSION.md](DAPP_STORE_SUBMISSION.md))
- **Transaction proof:** **TODO** `<Devnet Explorer link to the revoke transaction signature>` (no revoke has been run
  on-chain yet)

## Problem

A Solana token account can carry a delegate: an address the owner approved to transfer or burn up to a set amount from
that account. The approval stays active until it is revoked or replaced. Wallets rarely make existing approvals easy to
find, so owners often cannot tell which approvals are still active.

## Solution

GuardRail connects to the owner's existing wallet through Mobile Wallet Adapter, reads the wallet's standard SPL Token
accounts on Devnet, and lists each active delegate with plain-language, factual wording ("This address can transfer or
burn up to the delegated amount from this token account while the delegation remains active."). For a supported
delegate it shows exactly what a revoke will change, asks the wallet to sign one `Revoke` instruction, waits for
confirmation, re-reads that exact token account, and reports success only if the delegate is actually gone.

GuardRail reports on-chain facts. It does not label any address as malicious and does not claim a wallet is safe.

## Demo sequence

Full steps and the fixture workflow are in [DEMO.md](DEMO.md). Target running time about 2 minutes.

1. **Fixture** (before recording): `npm run fixture:create`, then `npm run fixture:verify` shows a 500-token delegate.
2. **Connect**: open GuardRail, tap Connect Wallet, approve in the wallet that controls the fixture owner.
3. **Scan**: tap Scan Wallet. One active delegate is listed with the delegated amount.
4. **Explain**: open Review. Show the plain-language explanation, delegate, token account, mint and "Supported" revoke.
5. **Review revoke**: tap Review revoke. Show "What will change" and "What stays the same".
6. **Decline once** (optional): reject in the wallet. The app stays on the review screen and says nothing was sent.
7. **Approve**: approve in the wallet. The result screen shows "Confirming on Devnet".
8. **Verify**: result shows "Delegate removed" with the verified slot and a Devnet Explorer link.
9. **Independent proof**: `npm run fixture:verify` now fails because the delegate is gone. Show the transaction on
   Explorer (record the link above).

Steps 2-8 need an Android device or emulator and have **not** been run.

## Architecture summary

- React Native + TypeScript (strict) on Expo SDK 55 with Expo Router; React Context/local state and TanStack Query for
  cached scan and verification results.
- `@wallet-ui/react-native-kit` provides the Mobile Wallet Adapter session and `sendTransactions`.
- `@solana/kit` 6.x and `@solana-program/token` 0.14 read and decode accounts and build the `Revoke` instruction. No
  `@solana/web3.js`. The wallet library bundles Kit 7.x; the instruction crosses that boundary through one documented
  cast, checked by `npm run verify:revoke`.
- `src/solana/scanPermissions.ts`: strict token account parser (size, owner, program, option tags) and scanner.
- `src/solana/revoke.ts`: preconditions, fresh on-chain re-check before signing, single-instruction transaction,
  confirmation polling, post-confirmation verification.
- Routes: `app/index.tsx` (connect, scan), `permission/[id]`, `revoke/[id]`, `result/[id]`.

More detail in [README.md](../README.md#architecture).

## Supported scope and limitations

Supported: standard SPL Token (`Tokenkeg...`) account delegates on Solana Devnet, owned by the connected wallet, not
frozen, with a readable mint. Revoke sends the SPL Token `Revoke` instruction and nothing else.

Not supported (view-only or not checked): Token-2022 accounts and extensions, other authority types (owner, close,
mint, freeze), frozen accounts, accounts whose mint cannot be read, mainnet, iOS, history or monitoring, push
notifications, multi-wallet monitoring, security scoring or address reputation.

Not verified on a device: every Android path (see [README.md](../README.md#limitations-and-unverified-items)).

## Current blocker

The Devnet fixture has not been created on-chain. The public Devnet faucet answered **HTTP 429** to every airdrop
request for the fixture owner `EQ8twh3xGQafRDsuGSwDho2Qqd7aYVswcjQ9YyJTE2nh` (last tried 2026-10-06). The owner needs at least **0.05 Devnet
SOL** before `npm run fixture:create` can create the mint and token account. Until then there is no real delegate to scan,
so no real Devnet revoke transaction exists and the transaction-proof field above stays empty.

To unblock, any one of: fund the owner address at <https://faucet.solana.com> (Devnet), send Devnet SOL from another
Devnet wallet, wait and rerun the script, or set `EXPO_PUBLIC_SOLANA_RPC_URL` in `.env` to another Devnet RPC. Then run
`npm run fixture:create`. Only the public address is listed here; the owner key stays in the ignored `.local/fixture/`.

## Checklist

- [ ] Fund fixture owner (>= 0.05 Devnet SOL) and run `npm run fixture:create` / `npm run fixture:verify`
- [ ] Install Java and Android SDK, run the manual Android checklist in [DEMO.md](DEMO.md)
- [ ] Build and sign a release APK; fill in the APK link
- [ ] Record the demo video; fill in the link
- [ ] Run the revoke on Devnet; record the transaction signature and Explorer link
- [ ] dApp Store: complete [DAPP_STORE_SUBMISSION.md](DAPP_STORE_SUBMISSION.md); fill in the listing link only if published
- [ ] Re-run `npm run ci`, `verify:scanner`, `verify:revoke`, `verify:flow` on the final commit
