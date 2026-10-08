import {
  getBase64Encoder,
  isAddress,
  signature as toSignature,
  type Address,
  type GetAccountInfoApi,
  type GetGenesisHashApi,
  type GetSignatureStatusesApi,
  type Rpc,
  type Signature,
} from '@solana/kit'
import {
  AccountState,
  findAssociatedTokenPda,
  getApproveCheckedInstruction,
  getTokenDecoder,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token'
// Relative imports (not `@/`) so this module can also be compiled and run under plain Node by
// scripts/verify-demo-approve.ts.
import { GuardRailError, type AppError } from '../types/errors'
import type { RevokeOutcome } from '../types/revoke'
import {
  confirmSignature,
  fetchTokenAccount,
  isWalletRejection,
  type ConfirmOptions,
  type SendInstructions,
} from './revoke'
import { decodeBase64, parseMintDecimals, parseTokenAccount } from './scanPermissions'

/**
 * Devnet-only demo setup: lets the connected wallet approve a known demo delegate on its own demo token account, so the
 * scan -> explain -> revoke flow has a real delegate to show. Off unless the build sets EXPO_PUBLIC_DEMO_SETUP=1.
 * The approval is fixed: SPL Token ApproveChecked for exactly 500 tokens of a 6-decimal mint, signed by the wallet.
 */
export const DEMO_APPROVE_DECIMALS = 6
export const DEMO_APPROVE_AMOUNT_RAW = 500n * 10n ** BigInt(DEMO_APPROVE_DECIMALS)
export const DEVNET_CHAIN = 'solana:devnet'
// Genesis hash of Solana Devnet. Checked before the wallet is asked to sign, so a misconfigured RPC never gets an approve.
export const DEVNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'

export type DemoSetupConfig =
  | { status: 'disabled' }
  | { status: 'invalid'; reason: string }
  | { status: 'enabled'; mint: Address; delegate: Address }

export interface DemoSetupEnv {
  setup?: string
  mint?: string
  delegate?: string
}

/** Demo setup is enabled only by exactly EXPO_PUBLIC_DEMO_SETUP=1 with valid, distinct mint and delegate addresses. */
export function parseDemoSetupConfig(env: DemoSetupEnv): DemoSetupConfig {
  if (env.setup?.trim() !== '1') {
    return { status: 'disabled' }
  }
  const mint = env.mint?.trim() ?? ''
  const delegate = env.delegate?.trim() ?? ''
  if (!isAddress(mint)) {
    return { status: 'invalid', reason: 'EXPO_PUBLIC_DEMO_MINT is missing or is not a valid address.' }
  }
  if (!isAddress(delegate)) {
    return { status: 'invalid', reason: 'EXPO_PUBLIC_DEMO_DELEGATE is missing or is not a valid address.' }
  }
  if (mint === delegate) {
    return { status: 'invalid', reason: 'EXPO_PUBLIC_DEMO_MINT and EXPO_PUBLIC_DEMO_DELEGATE must be different.' }
  }
  return { status: 'enabled', mint, delegate }
}

/** Same three outcomes as a revoke: verified, failed on-chain, or not (yet) verifiable. */
export type DemoApproveOutcome = RevokeOutcome

export type DemoApproveRpc = Rpc<GetAccountInfoApi & GetSignatureStatusesApi & GetGenesisHashApi>

export interface DemoApproveTarget {
  owner: Address
  tokenAccount: Address
  mint: Address
  delegate: Address
}

const notSent = (message: string) => `${message} Nothing was sent.`

/** Why the demo approve cannot start, or null if it can. Pure; no RPC. */
export function demoApprovePreconditionError(
  config: DemoSetupConfig,
  connectedAddress: string | undefined,
  chain: string,
): AppError | null {
  if (config.status !== 'enabled') {
    return { code: 'TRANSACTION_FAILED', message: notSent('Demo setup is not enabled in this build.') }
  }
  if (!connectedAddress || !isAddress(connectedAddress)) {
    return { code: 'WALLET_NOT_CONNECTED', message: 'Connect your wallet to run the demo setup.' }
  }
  if (chain !== DEVNET_CHAIN) {
    return { code: 'TRANSACTION_FAILED', message: notSent('Demo setup runs only on Solana Devnet.') }
  }
  if (connectedAddress === config.delegate) {
    return {
      code: 'TRANSACTION_FAILED',
      message: notSent('The connected wallet is the demo delegate, so it cannot approve itself.'),
    }
  }
  return null
}

/** The connected wallet's associated token account for the demo mint on the standard SPL Token program. */
export async function findDemoTokenAccount(owner: Address, mint: Address): Promise<Address> {
  const [tokenAccount] = await findAssociatedTokenPda({ owner, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS })
  return tokenAccount
}

/**
 * The one instruction demo setup ever sends: SPL Token ApproveChecked (discriminator 13) for exactly 500 tokens with
 * 6 decimals. The owner is the transaction fee payer and so signs the transaction.
 */
export function buildDemoApproveInstruction(target: DemoApproveTarget) {
  return getApproveCheckedInstruction({
    source: target.tokenAccount,
    mint: target.mint,
    delegate: target.delegate,
    owner: target.owner,
    amount: DEMO_APPROVE_AMOUNT_RAW,
    decimals: DEMO_APPROVE_DECIMALS,
  })
}

async function readAccount(rpc: DemoApproveRpc, address: Address) {
  try {
    const { value } = await rpc.getAccountInfo(address, { commitment: 'confirmed', encoding: 'base64' }).send()
    return value ? { address, programOwner: value.owner, data: decodeBase64(getBase64Encoder(), value.data[0]) } : null
  } catch (cause) {
    throw new GuardRailError('RPC_UNAVAILABLE', 'Could not read Devnet. Check your connection and try again.', {
      cause,
    })
  }
}

/**
 * Check on Devnet that the approve can do exactly what the panel describes: the RPC is Devnet, the demo mint has 6
 * decimals, and the wallet's demo token account exists, is active, and has no delegate yet. Demo setup never replaces
 * an existing delegate.
 */
export async function assertDemoApproveReady(rpc: DemoApproveRpc, target: DemoApproveTarget): Promise<void> {
  let genesisHash: string
  try {
    genesisHash = await rpc.getGenesisHash().send()
  } catch (cause) {
    throw new GuardRailError('RPC_UNAVAILABLE', 'Could not read Devnet. Check your connection and try again.', {
      cause,
    })
  }
  if (genesisHash !== DEVNET_GENESIS_HASH) {
    throw new GuardRailError('TRANSACTION_FAILED', notSent('The configured RPC is not Solana Devnet.'))
  }

  const decimals = parseMintDecimals(await readAccount(rpc, target.mint))
  if (decimals !== DEMO_APPROVE_DECIMALS) {
    throw new GuardRailError(
      'TOKEN_ACCOUNT_PARSE_FAILED',
      notSent('The demo mint is not a standard SPL Token mint with 6 decimals on Devnet.'),
    )
  }

  const raw = await readAccount(rpc, target.tokenAccount)
  if (!raw) {
    throw new GuardRailError(
      'TOKEN_ACCOUNT_PARSE_FAILED',
      notSent('This wallet has no token account for the demo mint on Devnet. Run the demo fixture setup first.'),
    )
  }
  const parsed = parseTokenAccount(raw, target.owner)
  if (parsed.kind === 'invalid') {
    throw new GuardRailError(
      'TOKEN_ACCOUNT_PARSE_FAILED',
      notSent(`The demo token account could not be read (${parsed.reason}).`),
    )
  }
  if (parsed.kind === 'delegate') {
    throw new GuardRailError(
      'TRANSACTION_FAILED',
      notSent('The demo token account already has a delegate. Scan to review it; demo setup does not replace it.'),
    )
  }
  const token = getTokenDecoder().decode(raw.data)
  if (token.mint !== target.mint) {
    throw new GuardRailError('TOKEN_ACCOUNT_PARSE_FAILED', notSent('The demo token account is for a different mint.'))
  }
  if (token.state !== AccountState.Initialized) {
    throw new GuardRailError(
      'TRANSACTION_FAILED',
      notSent('The demo token account is frozen, so approve is rejected on-chain.'),
    )
  }
}

/**
 * Approve the demo delegate through the connected wallet: preconditions, fresh Devnet checks, then a single transaction
 * containing only the ApproveChecked instruction. Resolves with the signature the wallet returned, which proves
 * submission only. Wallet rejection is SIGNATURE_REJECTED, a normal outcome.
 */
export async function submitDemoApprove(params: {
  config: DemoSetupConfig
  connectedAddress: string | undefined
  chain: string
  rpc: DemoApproveRpc
  sendInstructions: SendInstructions
}): Promise<{ signature: Signature; target: DemoApproveTarget }> {
  const { config, connectedAddress, chain, rpc, sendInstructions } = params
  const precondition = demoApprovePreconditionError(config, connectedAddress, chain)
  if (precondition) {
    throw new GuardRailError(precondition.code, precondition.message)
  }
  // Type narrowing only; demoApprovePreconditionError already rejected both cases.
  if (config.status !== 'enabled' || !connectedAddress) {
    throw new GuardRailError('TRANSACTION_FAILED', notSent('Demo setup is unavailable.'))
  }
  const owner = connectedAddress as Address
  const target: DemoApproveTarget = {
    owner,
    tokenAccount: await findDemoTokenAccount(owner, config.mint),
    mint: config.mint,
    delegate: config.delegate,
  }
  await assertDemoApproveReady(rpc, target)

  let rawSignature: string
  try {
    rawSignature = await sendInstructions([buildDemoApproveInstruction(target)])
  } catch (cause) {
    if (isWalletRejection(cause)) {
      throw new GuardRailError('SIGNATURE_REJECTED', 'The wallet did not approve the demo setup. Nothing was sent.', {
        cause,
      })
    }
    throw new GuardRailError(
      'TRANSACTION_FAILED',
      'The wallet could not complete the demo approve transaction. Scan to see the current state.',
      { cause },
    )
  }
  try {
    return { signature: toSignature(rawSignature), target }
  } catch (cause) {
    throw new GuardRailError(
      'TRANSACTION_FAILED',
      'The wallet returned a transaction signature GuardRail could not read. Scan to see the current state.',
      { cause },
    )
  }
}

/**
 * Confirm a submitted demo approve and re-read the exact token account. Verified only if the signature confirmed
 * without error AND the account (read at or after the confirmation slot) now has exactly the demo delegate for exactly
 * 500 tokens. Read-only. Never throws.
 */
export async function confirmAndVerifyDemoApprove(
  rpc: DemoApproveRpc,
  target: DemoApproveTarget,
  signature: string,
  options: ConfirmOptions = {},
): Promise<DemoApproveOutcome> {
  try {
    const confirmation = await confirmSignature(rpc, toSignature(signature), options)
    if (confirmation.status === 'failed') {
      return {
        status: 'transaction-failed',
        error: {
          code: 'TRANSACTION_FAILED',
          message: 'The demo approve transaction failed on Devnet; nothing changed.',
        },
      }
    }
    if (confirmation.status === 'unconfirmed') {
      return {
        status: 'not-verified',
        error: {
          code: 'VERIFICATION_FAILED',
          message: 'The demo approve was not confirmed on Devnet in time. It may still land; scan again in a moment.',
        },
      }
    }
    const fetched = await fetchTokenAccount(rpc, target.tokenAccount, target.owner, confirmation.slot)
    if (
      fetched.kind === 'delegate' &&
      fetched.candidate.delegate === target.delegate &&
      fetched.candidate.mint === target.mint &&
      fetched.candidate.delegatedAmount === DEMO_APPROVE_AMOUNT_RAW
    ) {
      return { status: 'verified', slot: confirmation.slot }
    }
    return {
      status: 'not-verified',
      error: {
        code: 'VERIFICATION_FAILED',
        message:
          'The transaction was confirmed, but the token account does not show the expected 500-token delegate yet. Scan again in a moment.',
      },
    }
  } catch (error) {
    return {
      status: 'not-verified',
      error: {
        code: error instanceof GuardRailError ? error.code : 'RPC_UNAVAILABLE',
        message:
          error instanceof GuardRailError
            ? error.message
            : 'Could not confirm the transaction on Devnet. Check your connection and scan again.',
      },
    }
  }
}
