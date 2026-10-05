import type { PermissionExplanationCode } from '@/src/types/permission'

// Objective, non-alarmist explanations. Never label a delegate as malicious or the wallet as safe.
export const PERMISSION_EXPLANATIONS: Record<PermissionExplanationCode, string> = {
  SPL_TOKEN_DELEGATE_ACTIVE:
    'This address can transfer or burn up to the delegated amount from this token account while the delegation remains active.',
  SPL_TOKEN_DELEGATE_ZERO_AMOUNT:
    'This address is set as the delegate for this token account with a delegated amount of 0, so it cannot currently move tokens. The delegate entry stays until revoked or replaced.',
  SPL_TOKEN_DELEGATE_ACCOUNT_FROZEN:
    'This address is the delegate for this token account, but the account is frozen by the mint’s freeze authority. The token program does not allow revoking while the account is frozen.',
  SPL_TOKEN_DELEGATE_MINT_UNREADABLE:
    'This address is the delegate for this token account, but GuardRail could not read the token mint, so the amount is shown in base units. Revoke is unavailable until the mint can be read.',
}
