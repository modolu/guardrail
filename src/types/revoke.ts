import type { AppError } from './errors'
import type { PermissionFinding } from './permission'

/** A revoke transaction the wallet accepted and submitted. Confirmation and verification are separate, later steps. */
export interface RevokeAttempt {
  /** The finding exactly as it was reviewed and revoked. A snapshot, so it survives the scan cache being updated. */
  finding: PermissionFinding
  /** Base58 transaction signature returned by the wallet. */
  signature: string
}

/**
 * Result of confirming a submitted revoke on Devnet and re-reading the exact token account.
 * - verified: the transaction was confirmed without error and the token account now has no delegate.
 * - transaction-failed: the transaction was confirmed but failed on-chain, so nothing changed.
 * - not-verified: success could not be established (not confirmed in time, RPC trouble, or the delegate is still set).
 *   Retrying only re-reads the chain; it never sends another transaction.
 */
export type RevokeOutcome =
  | { status: 'verified'; slot: bigint }
  | { status: 'transaction-failed'; error: AppError }
  | { status: 'not-verified'; error: AppError }
