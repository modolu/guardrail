export type AppErrorCode =
  | 'WALLET_NOT_CONNECTED'
  | 'RPC_UNAVAILABLE'
  | 'TOKEN_ACCOUNT_PARSE_FAILED'
  | 'UNSUPPORTED_AUTHORITY'
  | 'REVOKE_NOT_SUPPORTED'
  | 'SIGNATURE_REJECTED'
  | 'TRANSACTION_FAILED'
  | 'VERIFICATION_FAILED'

export interface AppError {
  code: AppErrorCode
  message: string
}

/** Error carrying a GuardRail error code, so UI can show a calm, specific message instead of crashing. */
export class GuardRailError extends Error {
  readonly code: AppErrorCode

  constructor(code: AppErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'GuardRailError'
    this.code = code
  }
}

export function toAppError(error: unknown, fallbackCode: AppErrorCode, fallbackMessage: string): AppError {
  if (error instanceof GuardRailError) {
    return { code: error.code, message: error.message }
  }
  return { code: fallbackCode, message: fallbackMessage }
}
