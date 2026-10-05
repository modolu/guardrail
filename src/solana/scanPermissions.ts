import {
  getBase64Encoder,
  isSome,
  type Address,
  type GetMultipleAccountsApi,
  type GetTokenAccountsByOwnerApi,
  type Rpc,
} from '@solana/kit'
import {
  AccountState,
  getMintDecoder,
  getMintSize,
  getTokenDecoder,
  getTokenSize,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token'
// Relative imports (not `@/`) so this module can also be compiled and run under plain Node by scripts/verify-scanner.ts.
import { GuardRailError } from '../types/errors'
import type { PermissionExplanationCode, PermissionFinding, PermissionScanResult } from '../types/permission'
import { formatRawAmount } from '../utils/amounts'

export type PermissionScanRpc = Rpc<GetTokenAccountsByOwnerApi & GetMultipleAccountsApi>

/** An account as returned by the RPC, reduced to what the parsers need. */
export interface RawAccount {
  address: string
  /** Program that owns the account (RPC `account.owner`). */
  programOwner: string
  data: Uint8Array
}

/** A token account that has a delegate set. Decimals are resolved separately from the mint. */
export interface DelegateCandidate {
  tokenAccount: string
  mint: string
  owner: string
  delegate: string
  delegatedAmount: bigint
  state: AccountState.Initialized | AccountState.Frozen
}

export type TokenAccountParseResult =
  { kind: 'delegate'; candidate: DelegateCandidate } | { kind: 'no-delegate' } | { kind: 'invalid'; reason: string }

// getMultipleAccounts accepts at most 100 addresses per request.
const MAX_ACCOUNTS_PER_REQUEST = 100
const COMMITMENT = 'confirmed'

/**
 * Parse a standard SPL Token account and report whether it has a delegate.
 * Anything that is not an exactly-sized, initialized/frozen SPL Token account owned by `walletOwner`
 * is reported as invalid and must never become a finding.
 */
export function parseTokenAccount(account: RawAccount, walletOwner: string): TokenAccountParseResult {
  if (account.programOwner !== TOKEN_PROGRAM_ADDRESS) {
    return { kind: 'invalid', reason: 'not owned by the SPL Token program' }
  }
  if (account.data.length !== getTokenSize()) {
    return { kind: 'invalid', reason: `unexpected data length ${account.data.length}` }
  }
  // COption tags are u32 0 (None) or 1 (Some). Check them on the raw bytes so a corrupt tag is never read as "Some".
  if (!isValidCOptionTag(account.data, DELEGATE_TAG_OFFSET)) {
    return { kind: 'invalid', reason: 'malformed delegate option tag' }
  }
  let token
  try {
    token = getTokenDecoder().decode(account.data)
  } catch {
    return { kind: 'invalid', reason: 'token account data could not be decoded' }
  }
  if (token.owner !== walletOwner) {
    return { kind: 'invalid', reason: 'token account owner does not match the connected wallet' }
  }
  if (token.state !== AccountState.Initialized && token.state !== AccountState.Frozen) {
    return { kind: 'invalid', reason: 'token account is not initialized' }
  }
  if (!isSome(token.delegate)) {
    return { kind: 'no-delegate' }
  }
  return {
    kind: 'delegate',
    candidate: {
      tokenAccount: account.address,
      mint: token.mint,
      owner: token.owner,
      delegate: token.delegate.value,
      delegatedAmount: token.delegatedAmount,
      state: token.state,
    },
  }
}

// SPL Token account layout: mint(32) owner(32) amount(8) delegate COption<Pubkey>(4 + 32) ...
const DELEGATE_TAG_OFFSET = 72

function isValidCOptionTag(data: Uint8Array, offset: number): boolean {
  const tag = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset, true)
  return tag === 0 || tag === 1
}

/** Return mint decimals if `account` is an initialized standard SPL Token mint, otherwise null. */
export function parseMintDecimals(account: RawAccount | null): number | null {
  if (!account || account.programOwner !== TOKEN_PROGRAM_ADDRESS || account.data.length !== getMintSize()) {
    return null
  }
  try {
    const mint = getMintDecoder().decode(account.data)
    return mint.isInitialized ? mint.decimals : null
  } catch {
    return null
  }
}

/** Combine a delegate candidate with its mint decimals into a finding. Pure; no RPC. */
export function buildFinding(candidate: DelegateCandidate, decimals: number | null): PermissionFinding {
  const explanationCode = explain(candidate, decimals)
  const raw = candidate.delegatedAmount
  return {
    id: candidate.tokenAccount,
    type: 'SPL_TOKEN_DELEGATE',
    tokenAccount: candidate.tokenAccount,
    mint: candidate.mint,
    owner: candidate.owner,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    delegate: candidate.delegate,
    delegatedAmountRaw: raw.toString(),
    decimals,
    delegatedAmountDisplay: decimals === null ? `${raw.toString()} base units` : formatRawAmount(raw, decimals),
    revocable: explanationCode === 'SPL_TOKEN_DELEGATE_ACTIVE' || explanationCode === 'SPL_TOKEN_DELEGATE_ZERO_AMOUNT',
    explanationCode,
  }
}

function explain(candidate: DelegateCandidate, decimals: number | null): PermissionExplanationCode {
  if (candidate.state === AccountState.Frozen) {
    return 'SPL_TOKEN_DELEGATE_ACCOUNT_FROZEN'
  }
  if (decimals === null) {
    return 'SPL_TOKEN_DELEGATE_MINT_UNREADABLE'
  }
  return candidate.delegatedAmount === 0n ? 'SPL_TOKEN_DELEGATE_ZERO_AMOUNT' : 'SPL_TOKEN_DELEGATE_ACTIVE'
}

/**
 * Scan the wallet's standard SPL Token accounts for active delegates.
 * Token-2022 accounts are not requested. RPC failures throw GuardRailError(RPC_UNAVAILABLE);
 * malformed accounts are counted as skipped, never surfaced as findings.
 */
export async function scanPermissions(rpc: PermissionScanRpc, walletOwner: Address): Promise<PermissionScanResult> {
  const base64 = getBase64Encoder()

  const tokenAccounts = await sendOrThrow(
    () =>
      rpc
        .getTokenAccountsByOwner(
          walletOwner,
          { programId: TOKEN_PROGRAM_ADDRESS },
          { commitment: COMMITMENT, encoding: 'base64' },
        )
        .send(),
    'Could not load token accounts from the Devnet RPC.',
  )
  const contextSlot = tokenAccounts.context.slot

  const candidates: DelegateCandidate[] = []
  let skippedAccountCount = 0
  for (const { pubkey, account } of tokenAccounts.value) {
    const parsed = parseTokenAccount(
      { address: pubkey, programOwner: account.owner, data: decodeBase64(base64, account.data[0]) },
      walletOwner,
    )
    if (parsed.kind === 'delegate') {
      candidates.push(parsed.candidate)
    } else if (parsed.kind === 'invalid') {
      skippedAccountCount += 1
    }
  }

  const decimalsByMint = await fetchMintDecimals(rpc, [...new Set(candidates.map((c) => c.mint))], contextSlot)
  const findings = candidates
    .map((candidate) => buildFinding(candidate, decimalsByMint.get(candidate.mint) ?? null))
    .sort(compareFindings)

  return {
    findings,
    scannedAccountCount: tokenAccounts.value.length,
    skippedAccountCount,
    contextSlot,
  }
}

async function fetchMintDecimals(
  rpc: PermissionScanRpc,
  mints: string[],
  minContextSlot: bigint,
): Promise<Map<string, number | null>> {
  const base64 = getBase64Encoder()
  const result = new Map<string, number | null>()
  for (let i = 0; i < mints.length; i += MAX_ACCOUNTS_PER_REQUEST) {
    const chunk = mints.slice(i, i + MAX_ACCOUNTS_PER_REQUEST) as Address[]
    const response = await sendOrThrow(
      () => rpc.getMultipleAccounts(chunk, { commitment: COMMITMENT, encoding: 'base64', minContextSlot }).send(),
      'Could not load token mint details from the Devnet RPC.',
    )
    chunk.forEach((mint, index) => {
      const account = response.value[index]
      result.set(
        mint,
        parseMintDecimals(
          account ? { address: mint, programOwner: account.owner, data: decodeBase64(base64, account.data[0]) } : null,
        ),
      )
    })
  }
  return result
}

function decodeBase64(encoder: ReturnType<typeof getBase64Encoder>, value: string): Uint8Array {
  try {
    return new Uint8Array(encoder.encode(value))
  } catch {
    // An undecodable payload yields empty data, which the parsers reject as invalid.
    return new Uint8Array(0)
  }
}

async function sendOrThrow<T>(request: () => Promise<T>, message: string): Promise<T> {
  try {
    return await request()
  } catch (cause) {
    throw new GuardRailError('RPC_UNAVAILABLE', message, { cause })
  }
}

function compareFindings(a: PermissionFinding, b: PermissionFinding): number {
  if (a.revocable !== b.revocable) {
    return a.revocable ? -1 : 1
  }
  return a.mint.localeCompare(b.mint) || a.tokenAccount.localeCompare(b.tokenAccount)
}
