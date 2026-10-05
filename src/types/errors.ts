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
