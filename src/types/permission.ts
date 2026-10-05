/**
 * Why a finding exists and how it should be explained. Codes describe objective on-chain facts only.
 * - SPL_TOKEN_DELEGATE_ACTIVE: delegate set, positive delegated amount, account initialized.
 * - SPL_TOKEN_DELEGATE_ZERO_AMOUNT: delegate set with a delegated amount of 0 (can move nothing until re-approved).
 * - SPL_TOKEN_DELEGATE_ACCOUNT_FROZEN: delegate set but the token account is frozen. View-only because the on-chain
 *   program rejects Revoke with TokenError::AccountFrozen (0x11) before checking the owner. This is enforced by the
 *   program (solana-program/token `process_revoke` and p-token `revoke.rs`), not by the @solana-program/token client.
 * - SPL_TOKEN_DELEGATE_MINT_UNREADABLE: delegate set but the mint could not be read, so decimals are unknown.
 *   Revoke itself does not read the mint; view-only is GuardRail policy so the user never confirms an amount
 *   GuardRail cannot display accurately.
 */
export type PermissionExplanationCode =
  | 'SPL_TOKEN_DELEGATE_ACTIVE'
  | 'SPL_TOKEN_DELEGATE_ZERO_AMOUNT'
  | 'SPL_TOKEN_DELEGATE_ACCOUNT_FROZEN'
  | 'SPL_TOKEN_DELEGATE_MINT_UNREADABLE'

export type PermissionType = 'SPL_TOKEN_DELEGATE'

export interface PermissionFinding {
  /** Stable id for routing; one delegate per token account, so the token account address. */
  id: string
  type: PermissionType
  tokenAccount: string
  mint: string
  /** Token account owner (the connected wallet). */
  owner: string
  /** Program that owns the token account. Always the standard SPL Token program for now. */
  tokenProgram: string
  delegate: string
  /** Raw base-unit amount as a decimal string (u64). Never a float. */
  delegatedAmountRaw: string
  /** Mint decimals, or null if the mint could not be read. */
  decimals: number | null
  /** Human-readable amount derived from raw + decimals using integer math. */
  delegatedAmountDisplay: string
  revocable: boolean
  explanationCode: PermissionExplanationCode
}

export interface PermissionScanResult {
  findings: PermissionFinding[]
  /** Token accounts returned by the RPC for this owner under the standard SPL Token program. */
  scannedAccountCount: number
  /** Accounts that could not be parsed or failed validation; never turned into findings. */
  skippedAccountCount: number
  /** Slot of the token-account snapshot the scan is based on. */
  contextSlot: bigint
}
