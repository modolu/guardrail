# Demo

## Devnet delegate fixture

The demo needs a wallet with a standard SPL Token account that has an active delegate. The fixture scripts create
one on **Solana Devnet** with `@solana/kit` 6 and `@solana-program/token` 0.14 (no `@solana/web3.js`).

### Create

```sh
npm run fixture:create
```

This:

1. Checks that the RPC is Solana Devnet by genesis hash (`EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`) and stops if
   it is not. There is no mainnet path.
2. Loads or creates a dev-only **owner** key and a separate **delegate** key in `.local/fixture/`.
3. If the owner has less than 0.05 SOL, requests a 1 SOL Devnet airdrop (`requestAirdrop`), up to 3 tries with backoff.
4. Creates a standard SPL Token mint (6 decimals; mint authority = owner, no freeze authority).
5. Creates the owner's associated token account for that mint and mints exactly **1000** tokens (raw `1000000000`).
6. Approves the delegate for exactly **500** tokens (raw `500000000`) with `ApproveChecked`.
7. Refetches the token account and runs GuardRail's own scanner (`scanPermissions`) against the owner. It reports
   `VERIFIED` only if both show the delegate and the exact delegated amount.

It prints the owner, delegate, mint, token account, delegated amount, and every transaction signature with Devnet
Explorer links.

Rerunning is safe:

- Fixture valid on-chain: reused, no transactions sent.
- Delegate revoked or changed (for example after a revoke demo): re-approves the same delegate for 500 tokens.
- Recorded token account gone (for example after a Devnet reset): creates a new mint and token account with the same
  keys.
- Token balance changed from 1000: stops and asks you to reset.

### Verify (read-only)

```sh
npm run fixture:verify
```

Reads `.local/fixture/fixture.json` (public data only), refetches the exact token account, and runs the scanner. It
sends no transactions and does not read the secret keys. Exits non-zero unless the delegate and exact delegated amount
are present. After a successful revoke in the app this command **should fail**, which is the expected proof that the
delegate is gone.

### Airdrop rate limits

The public Devnet faucet often answers `429 Too Many Requests`. When all retries fail the script stops before creating
anything and prints the owner address. Fund it manually with at least 0.05 SOL at <https://faucet.solana.com> (choose
Devnet), or wait and retry, then rerun `npm run fixture:create`. The script does not use any paid RPC.

**Current status (2026-10-06):** every airdrop attempt for the fixture owner `EQ8twh3xGQafRDsuGSwDho2Qqd7aYVswcjQ9YyJTE2nh`
returned HTTP 429, so the fixture has not been created on-chain (no `fixture.json` exists). The owner needs at least
0.05 Devnet SOL. Fund that public address, then run `npm run fixture:create`.

To use a different Devnet RPC, set `EXPO_PUBLIC_SOLANA_RPC_URL` in `.env` (see `.env.example`). The scripts load `.env`
and still refuse anything that is not Devnet. The URL is never printed, in case it contains an API key.

### Files

All in `.local/fixture/`, which is gitignored:

| File                    | Contents                                                        | Secret |
| ----------------------- | --------------------------------------------------------------- | ------ |
| `owner-keypair.json`    | Owner keypair, Solana CLI format (JSON array of 64 bytes), 0600 | yes    |
| `delegate-keypair.json` | Delegate keypair, same format, 0600                             | yes    |
| `fixture.json`          | Addresses, amounts, signatures, timestamps                      | no     |

The mint key is generated per run and discarded; the owner is the mint authority. Secret bytes are never printed.

### Reset

Delete only fixture files; never `rm -rf .local`.

```sh
# New mint + token account, same owner and delegate (keeps a wallet that already imported the owner key working):
rm .local/fixture/fixture.json
npm run fixture:create

# Full reset, new owner and delegate keys too:
rm .local/fixture/fixture.json .local/fixture/owner-keypair.json .local/fixture/delegate-keypair.json
npm run fixture:create
```

## Revoke flow

From a scanned finding that GuardRail marks revocable (standard SPL Token delegate, account not frozen, mint readable,
owned by the connected wallet):

1. **Permission screen** -> **Review revoke**. Nothing is built or sent yet.
2. **Revoke review** (`app/revoke/[id].tsx`) shows what will change: the token account, the delegate that will be
   removed, and the delegated amount that will be set to 0. It also states what stays the same (no tokens move; one
   SPL Token `Revoke` instruction for this account only).
3. **Approve in wallet.** GuardRail first re-reads the exact token account and refuses to continue if the delegate,
   amount, or mint no longer matches what was reviewed, or if the account is frozen. It then sends one transaction
   containing only the SPL Token `Revoke` instruction through Mobile Wallet Adapter (`useMobileWallet().sendTransactions`).
   The owner is the fee payer and the only signer.
4. **Wallet declined or closed** (MWA `-3 ERROR_NOT_SIGNED`, `-1 ERROR_AUTHORIZATION_FAILED`, session closed,
   association cancelled) is treated as a normal outcome (`SIGNATURE_REJECTED`): the review screen stays, shows that
   nothing was sent, and the user can approve again.
5. **Result screen** (`app/result/[id].tsx`) polls `getSignatureStatuses` until the transaction is `confirmed` or
   `finalized` (45 s timeout), then refetches the exact token account at or after the confirmation slot. It shows
   **"Delegate removed"** only if the transaction succeeded **and** the refetched account has no delegate.
6. Otherwise it shows why, with a Devnet Explorer link:
   - `TRANSACTION_FAILED`: the transaction was confirmed but failed on-chain, so nothing changed.
   - `VERIFICATION_FAILED`: not confirmed in time, or confirmed but the delegate is still shown. **Retry verification**
     only re-reads Devnet. It never sends another transaction.
   - `RPC_UNAVAILABLE` / `TOKEN_ACCOUNT_PARSE_FAILED`: the state could not be read; retry the same way.

After a verified revoke the delegate disappears from the cached scan, and `npm run fixture:verify` should fail because
the delegate is gone. Run `npm run fixture:create` to re-approve the same delegate and repeat the demo.

### Verify without a device

```sh
npm run verify:revoke
```

Runs offline against a fake RPC. It checks:

- Preconditions: wallet connected, owner is the connected wallet, standard SPL Token program, revocable, valid
  addresses. Frozen, unreadable-mint, Token-2022 and not-owner cases are rejected before any RPC call or wallet request.
- The instruction is SPL Token `Revoke` (data `[5]`, token account writable, owner) and nothing else.
- Compiling that instruction with the `@solana/kit` 7.x copy bundled inside `@wallet-ui/react-native-kit` (the one
  `sendTransactions` uses) gives a one-instruction, one-signer message with exactly three accounts: owner, token
  account, token program.
- Wallet cancellation maps to `SIGNATURE_REJECTED`; other wallet failures map to `TRANSACTION_FAILED`; nothing is
  confirmed or verified after a rejection.
- Stale state before signing (delegate removed, changed, different amount or mint, frozen, account gone) stops with
  nothing sent.
- Confirmation waits through pending and processed, detects on-chain failure, and times out deterministically.
- Verification reports success only when confirmed and the refetched account has no delegate, reads at the
  confirmation slot, and a retry after a "still delegated" read recovers without any write call.

Not covered offline: the real wallet UI, real MWA errors, and real Devnet timing (see below).

## Using the fixture in the app (needs Android, not yet verified)

GuardRail scans and revokes for whichever wallet is connected through Mobile Wallet Adapter. The fixture's delegate
is on the **fixture owner's** token account, so the Android test wallet must control that owner. Two options once an
emulator or device exists:

1. **Import the fixture owner key** into an MWA-compatible Devnet test wallet. `owner-keypair.json` is in the Solana
   CLI keypair format; how to import it depends on the wallet (some accept the JSON byte array, others need a base58
   private key). This is a development-only key holding only Devnet SOL and demo tokens. Never use it on mainnet or
   reuse a real wallet's key here.
2. **Create the permission from the test wallet itself**: fund the wallet's own address on Devnet and run the same
   mint/approve steps with that address as owner. This needs a signer for the wallet's key, so it is not automated yet.

Until an Android emulator or device is available, the connect -> scan -> revoke flow on Android is **unverified**.
The fixture scripts are verified only from Node against Devnet.

### Manual Android checklist (once a device exists)

- [ ] Connect the wallet that owns the fixture token account; scan lists the 500-token delegate.
- [ ] Review revoke shows the token account, delegate, and amount matching the permission screen.
- [ ] Approve in wallet: the wallet's transaction preview shows a single SPL Token Revoke and the owner as signer.
- [ ] Decline in the wallet: the app stays on review, shows "nothing was sent", and Approve works again.
- [ ] Approve: result moves from "Confirming on Devnet" to "Delegate removed" with a working Explorer link.
- [ ] `npm run fixture:verify` now fails (delegate gone); Back to scan no longer lists the finding.
- [ ] With airplane mode on after approving: result shows a retryable not-verified state; after reconnecting,
      **Retry verification** reaches "Delegate removed" without a second wallet prompt.
- [ ] Confirm the real MWA cancellation error from the wallet is one of the codes listed above; if a wallet uses a
      different shape, it surfaces as `TRANSACTION_FAILED` rather than a cancellation and
      `isWalletRejection` in `src/solana/revoke.ts` needs that shape added.
