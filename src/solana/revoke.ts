import {
  getBase64Encoder,
  isAddress,
  signature as toSignature,
  type Address,
  type GetAccountInfoApi,
  type GetSignatureStatusesApi,
  type Instruction,
  type Rpc,
  type Signature,
} from '@solana/kit'
import { AccountState, getRevokeInstruction, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token'
// Relative imports (not `@/`) so this module can also be compiled and run under plain Node by scripts/verify-revoke.ts.
import { REVOKE_UNAVAILABLE_REASONS } from '../constants/explanations'
import { GuardRailError, type AppError } from '../types/errors'
import type { PermissionFinding } from '../types/permission'
import type { RevokeOutcome } from '../types/revoke'
import { parseRawAmount } from '../utils/amounts'
import { decodeBase64, parseTokenAccount, type TokenAccountParseResult } from './scanPermissions'

export type RevokeRpc = Rpc<GetAccountInfoApi & GetSignatureStatusesApi>

/** Sends the instructions as one transaction through the connected wallet and returns the base58 signature. */
export type SendInstructions = (instructions: Instruction[]) => Promise<string>

export interface ConfirmOptions {
  timeoutMs?: number
  pollIntervalMs?: number
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

const COMMITMENT = 'confirmed'
const DEFAULT_CONFIRM_TIMEOUT_MS = 45_000
const DEFAULT_POLL_INTERVAL_MS = 1_500

/**
 * Why `finding` cannot be revoked by `connectedAddress`, or null if it can. Pure; no RPC.
 * Only a revocable standard SPL Token delegate whose owner is the connected wallet passes.
 */
export function revokePreconditionError(
  finding: PermissionFinding,
  connectedAddress: string | undefined,
): AppError | null {
  if (!connectedAddress) {
    return { code: 'WALLET_NOT_CONNECTED', message: 'Connect your wallet to revoke a permission.' }
  }
  if (finding.type !== 'SPL_TOKEN_DELEGATE' || finding.tokenProgram !== TOKEN_PROGRAM_ADDRESS) {
    return {
      code: 'UNSUPPORTED_AUTHORITY',
      message: 'GuardRail can only revoke delegates on standard SPL Token accounts.',
    }
  }
  if (finding.owner !== connectedAddress) {
    return {
      code: 'UNSUPPORTED_AUTHORITY',
      message:
        'The connected wallet is not the owner of this token account, and only the owner can revoke its delegate.',
    }
  }
  if (!finding.revocable || REVOKE_UNAVAILABLE_REASONS[finding.explanationCode] !== null) {
    return { code: 'REVOKE_NOT_SUPPORTED', message: 'GuardRail does not offer revoke for this permission.' }
  }
  if (
    !isAddress(finding.tokenAccount) ||
    !isAddress(finding.owner) ||
    !isAddress(finding.mint) ||
    !isAddress(finding.delegate) ||
    parseRawAmount(finding.delegatedAmountRaw) === null
  ) {
    return {
      code: 'TOKEN_ACCOUNT_PARSE_FAILED',
      message: 'The permission data is not valid. Scan again to refresh it.',
    }
  }
  return null
}

export function assertRevokePreconditions(finding: PermissionFinding, connectedAddress: string | undefined): void {
  const error = revokePreconditionError(finding, connectedAddress)
  if (error) {
    throw new GuardRailError(error.code, error.message)
  }
}

/**
 * The one instruction GuardRail ever sends: SPL Token `Revoke` (discriminator 5) for the finding's token account.
 * The owner is the transaction fee payer and so signs the transaction; the instruction itself carries no other
 * accounts or data. Callers must have passed `assertRevokePreconditions` first.
 */
export function buildRevokeInstruction(finding: PermissionFinding) {
  return getRevokeInstruction({ source: finding.tokenAccount as Address, owner: finding.owner as Address })
}

type CausedError = { name?: unknown; code?: unknown; cause?: unknown }

// Mobile Wallet Adapter error shapes, matched by name and code so the nested protocol package need not be imported.
// Protocol errors: -1 ERROR_AUTHORIZATION_FAILED and -3 ERROR_NOT_SIGNED are the wallet declining or the user rejecting.
const MWA_PROTOCOL_ERROR_NAME = 'SolanaMobileWalletAdapterProtocolError'
const MWA_REJECTION_PROTOCOL_CODES = new Set<unknown>([-1, -3])
const MWA_ERROR_NAME = 'SolanaMobileWalletAdapterError'
const MWA_CLOSED_CODES = new Set<unknown>(['ERROR_SESSION_CLOSED', 'ERROR_ASSOCIATION_CANCELLED'])

/** True if `error`, or anything in its cause chain, is the wallet declining or the user closing the wallet. */
export function isWalletRejection(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth += 1) {
    const { name, code, cause } = current as CausedError
    if (name === MWA_PROTOCOL_ERROR_NAME && MWA_REJECTION_PROTOCOL_CODES.has(code)) {
      return true
    }
    if (name === MWA_ERROR_NAME && MWA_CLOSED_CODES.has(code)) {
      return true
    }
    current = cause
  }
  return false
}

/**
 * Re-read the exact token account before asking the wallet to sign, so the user only approves a change that
 * matches what they reviewed. Throws GuardRailError if the account is gone, changed, frozen, or unreadable.
 */
export async function assertDelegateUnchanged(rpc: RevokeRpc, finding: PermissionFinding): Promise<void> {
  const fetched = await fetchTokenAccount(rpc, finding.tokenAccount as Address, finding.owner)
  if (fetched.kind === 'missing') {
    throw new GuardRailError('REVOKE_NOT_SUPPORTED', 'This token account no longer exists on Devnet. Scan again.')
  }
  if (fetched.kind === 'invalid') {
    throw new GuardRailError('TOKEN_ACCOUNT_PARSE_FAILED', `The token account could not be read (${fetched.reason}).`)
  }
  if (fetched.kind === 'no-delegate') {
    throw new GuardRailError(
      'REVOKE_NOT_SUPPORTED',
      'This token account no longer has a delegate, so there is nothing to revoke. Nothing was sent. Scan again to refresh.',
    )
  }
  const { candidate } = fetched
  if (candidate.state !== AccountState.Initialized) {
    throw new GuardRailError('REVOKE_NOT_SUPPORTED', 'This token account is frozen, so revoke is rejected on-chain.')
  }
  if (
    candidate.delegate !== finding.delegate ||
    candidate.mint !== finding.mint ||
    candidate.delegatedAmount.toString() !== finding.delegatedAmountRaw
  ) {
    throw new GuardRailError(
      'REVOKE_NOT_SUPPORTED',
      'This permission changed on-chain since the scan, so it no longer matches what you reviewed. Nothing was sent. Scan again to refresh.',
    )
  }
}

/**
 * Revoke one delegate through the connected wallet: preconditions, fresh on-chain check, then a single
 * transaction containing only the SPL Token Revoke instruction. Resolves with the signature the wallet returned;
 * that proves submission only, never success. Every failure is a GuardRailError; wallet rejection is
 * SIGNATURE_REJECTED, a normal outcome the UI must handle calmly.
 */
export async function submitRevoke(params: {
  finding: PermissionFinding
  connectedAddress: string | undefined
  rpc: RevokeRpc
  sendInstructions: SendInstructions
}): Promise<{ signature: Signature }> {
  const { finding, connectedAddress, rpc, sendInstructions } = params
  assertRevokePreconditions(finding, connectedAddress)
  await assertDelegateUnchanged(rpc, finding)

  let rawSignature: string
  try {
    rawSignature = await sendInstructions([buildRevokeInstruction(finding)])
  } catch (cause) {
    if (isWalletRejection(cause)) {
      throw new GuardRailError('SIGNATURE_REJECTED', 'The wallet did not approve the revoke. Nothing was sent.', {
        cause,
      })
    }
    // The wallet may have failed before or after submitting, so this must not claim that nothing was sent.
    throw new GuardRailError(
      'TRANSACTION_FAILED',
      'The wallet could not complete the revoke transaction. Scan again to see the current state.',
      { cause },
    )
  }
  try {
    return { signature: toSignature(rawSignature) }
  } catch (cause) {
    throw new GuardRailError(
      'TRANSACTION_FAILED',
      'The wallet returned a transaction signature GuardRail could not read. Scan again to see the current state.',
      { cause },
    )
  }
}

type ConfirmResult = { status: 'confirmed'; slot: bigint } | { status: 'failed' } | { status: 'unconfirmed' }

/** Poll until the signature is confirmed (or finalized), failed on-chain, or the timeout passes. RPC errors throw. */
export async function confirmSignature(
  rpc: RevokeRpc,
  signature: Signature,
  options: ConfirmOptions = {},
): Promise<ConfirmResult> {
  const {
    timeoutMs = DEFAULT_CONFIRM_TIMEOUT_MS,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    now = Date.now,
  } = options
  const deadline = now() + timeoutMs
  for (;;) {
    const { value } = await rpc.getSignatureStatuses([signature], { searchTransactionHistory: true }).send()
    const status = value[0]
    if (status) {
      if (status.err !== null) {
        return { status: 'failed' }
      }
      if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
        return { status: 'confirmed', slot: status.slot }
      }
    }
    if (now() >= deadline) {
      return { status: 'unconfirmed' }
    }
    await sleep(pollIntervalMs)
  }
}

type FetchedTokenAccount = TokenAccountParseResult | { kind: 'missing' }

/** Read and strictly parse one token account. Throws GuardRailError(RPC_UNAVAILABLE) if the RPC cannot answer. */
export async function fetchTokenAccount(
  rpc: RevokeRpc,
  tokenAccount: Address,
  walletOwner: string,
  minContextSlot?: bigint,
): Promise<FetchedTokenAccount> {
  let response
  try {
    response = await rpc
      .getAccountInfo(tokenAccount, {
        commitment: COMMITMENT,
        encoding: 'base64',
        ...(minContextSlot === undefined ? {} : { minContextSlot }),
      })
      .send()
  } catch (cause) {
    throw new GuardRailError('RPC_UNAVAILABLE', 'Could not read the token account from the Devnet RPC.', { cause })
  }
  const account = response.value
  if (!account) {
    return { kind: 'missing' }
  }
  return parseTokenAccount(
    {
      address: tokenAccount,
      programOwner: account.owner,
      data: decodeBase64(getBase64Encoder(), account.data[0]),
    },
    walletOwner,
  )
}

/**
 * Confirm a submitted revoke and re-read the exact token account. Success is reported only if the signature was
 * confirmed without error AND the refetched token account (read at or after the confirmation slot) has no delegate.
 * Read-only: safe to call again as a retry. Never throws; every problem becomes an outcome the UI can show.
 */
export async function confirmAndVerifyRevoke(
  rpc: RevokeRpc,
  finding: PermissionFinding,
  signature: string,
  options: ConfirmOptions = {},
): Promise<RevokeOutcome> {
  try {
    const confirmation = await confirmSignature(rpc, toSignature(signature), options)
    if (confirmation.status === 'failed') {
      return {
        status: 'transaction-failed',
        error: {
          code: 'TRANSACTION_FAILED',
          message: 'The revoke transaction was confirmed on Devnet but failed, so the delegate was not removed.',
        },
      }
    }
    if (confirmation.status === 'unconfirmed') {
      return {
        status: 'not-verified',
        error: {
          code: 'VERIFICATION_FAILED',
          message:
            'The transaction was not confirmed on Devnet in time. It may still land, so success cannot be claimed yet. Retry verification in a moment.',
        },
      }
    }

    const fetched = await fetchTokenAccount(rpc, finding.tokenAccount as Address, finding.owner, confirmation.slot)
    switch (fetched.kind) {
      case 'no-delegate':
        return { status: 'verified', slot: confirmation.slot }
      case 'delegate':
        return {
          status: 'not-verified',
          error: {
            code: 'VERIFICATION_FAILED',
            message:
              'The transaction was confirmed, but the token account still shows a delegate. Retry verification; the RPC may be behind.',
          },
        }
      case 'missing':
        return {
          status: 'not-verified',
          error: {
            code: 'VERIFICATION_FAILED',
            message: 'The token account could not be found on Devnet, so the delegate state could not be verified.',
          },
        }
      case 'invalid':
        return {
          status: 'not-verified',
          error: {
            code: 'TOKEN_ACCOUNT_PARSE_FAILED',
            message: `The token account could not be read to verify the revoke (${fetched.reason}).`,
          },
        }
    }
  } catch (error) {
    const message =
      error instanceof GuardRailError
        ? error.message
        : 'Could not confirm the transaction on Devnet. Check your connection and retry.'
    return {
      status: 'not-verified',
      error: { code: error instanceof GuardRailError ? error.code : 'RPC_UNAVAILABLE', message },
    }
  }
}
