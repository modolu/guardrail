// Relative import (not `@/`) so this module can also be compiled and run under plain Node by scripts/verify-scanner.ts.
import type { PermissionExplanationCode, PermissionFinding } from '../types/permission'

// Objective, non-alarmist explanations. Never label a delegate as malicious or the wallet as safe.
export const PERMISSION_EXPLANATIONS: Record<PermissionExplanationCode, string> = {
  SPL_TOKEN_DELEGATE_ACTIVE:
    'This address can transfer or burn up to the delegated amount from this token account while the delegation remains active.',
  SPL_TOKEN_DELEGATE_ZERO_AMOUNT:
    'This address is set as the delegate for this token account with a delegated amount of 0, so it cannot currently move tokens. The delegate entry stays until revoked or replaced.',
  SPL_TOKEN_DELEGATE_ACCOUNT_FROZEN:
    'This address is the delegate for this token account, but the account is frozen by the mint’s freeze authority. The token program does not allow revoking while the account is frozen.',
  SPL_TOKEN_DELEGATE_MINT_UNREADABLE:
    'This address is the delegate for this token account, but GuardRail could not read the token mint, so the amount is shown in base units. GuardRail does not offer revoke until the mint can be read.',
}

/**
 * Why GuardRail shows no revoke action for a finding, or null when revoke is offered.
 * Must agree with `PermissionFinding.revocable` (checked in scripts/verify-scanner.ts).
 */
export const REVOKE_UNAVAILABLE_REASONS: Record<PermissionExplanationCode, string | null> = {
  SPL_TOKEN_DELEGATE_ACTIVE: null,
  SPL_TOKEN_DELEGATE_ZERO_AMOUNT: null,
  SPL_TOKEN_DELEGATE_ACCOUNT_FROZEN:
    'This token account is frozen. The SPL Token program rejects Revoke on frozen accounts (AccountFrozen error), so no transaction is offered. Revoke becomes possible only after the mint’s freeze authority thaws the account.',
  SPL_TOKEN_DELEGATE_MINT_UNREADABLE:
    'GuardRail could not read this token’s mint, so it cannot show the delegated amount in token units. The token program does not require the mint to revoke, but GuardRail only offers revoke when it can show exactly what is delegated. Scan again to retry.',
}

/** Plain-language summary of what the delegate can move, e.g. "Can move up to 250.5 tokens". */
export function delegatedAmountSummary(
  finding: Pick<PermissionFinding, 'delegatedAmountRaw' | 'delegatedAmountDisplay' | 'decimals'>,
): string {
  if (finding.delegatedAmountRaw === '0') {
    return 'Delegated amount is 0; cannot currently move tokens'
  }
  // Without decimals the display is already "<raw> base units".
  return finding.decimals === null
    ? `Can move up to ${finding.delegatedAmountDisplay}`
    : `Can move up to ${finding.delegatedAmountDisplay} tokens`
}
