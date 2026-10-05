// GuardRail is Devnet-only, so every link carries cluster=devnet.
const EXPLORER_BASE_URL = 'https://explorer.solana.com'

// Base58 alphabet without 0, O, I, l. A transaction signature is 64 bytes, which is 86 or 87 (rarely 88) characters.
const SIGNATURE_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/

/** Devnet Explorer link for a transaction signature, or null if the value is not a plausible base58 signature. */
export function explorerTransactionUrl(signature: string): string | null {
  return SIGNATURE_PATTERN.test(signature) ? `${EXPLORER_BASE_URL}/tx/${signature}?cluster=devnet` : null
}
