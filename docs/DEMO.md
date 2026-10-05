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
