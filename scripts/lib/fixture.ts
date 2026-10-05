/**
 * Shared helpers for the Devnet demo fixture scripts (Node only, never bundled into the app).
 *
 * Files under .local/fixture/ (gitignored):
 * - owner-keypair.json / delegate-keypair.json: SECRET. Solana CLI format (64-byte JSON array). Never printed.
 * - fixture.json: public metadata only (addresses, amounts, signatures).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  appendTransactionMessageInstructions,
  assertIsTransactionWithBlockhashLifetime,
  createKeyPairSignerFromBytes,
  createKeyPairSignerFromPrivateKeyBytes,
  createSolanaRpc,
  createTransactionMessage,
  devnet,
  getAddressEncoder,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  isSome,
  lamports,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type KeyPairSigner,
  type Signature,
  type SolanaRpcApi,
  type Rpc,
} from '@solana/kit'
import { fetchMaybeToken, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token'
import { scanPermissions } from '../../src/solana/scanPermissions'
import type { PermissionFinding } from '../../src/types/permission'
import { formatRawAmount } from '../../src/utils/amounts'

export const DEFAULT_DEVNET_RPC_URL = 'https://api.devnet.solana.com'
// Genesis hash of Solana Devnet. Every run checks the RPC against it, so an override can never point at mainnet.
export const DEVNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'

export const FIXTURE_DIR = path.resolve(process.cwd(), '.local', 'fixture')
export const OWNER_KEY_PATH = path.join(FIXTURE_DIR, 'owner-keypair.json')
export const DELEGATE_KEY_PATH = path.join(FIXTURE_DIR, 'delegate-keypair.json')
export const METADATA_PATH = path.join(FIXTURE_DIR, 'fixture.json')

export const DEMO_DECIMALS = 6
const UNIT = 10n ** BigInt(DEMO_DECIMALS)
export const MINT_AMOUNT_RAW = 1000n * UNIT
export const DELEGATED_AMOUNT_RAW = 500n * UNIT

const COMMITMENT = 'confirmed'

export type DevnetRpc = Rpc<SolanaRpcApi>

export interface FixtureMetadata {
  version: 1
  cluster: 'devnet'
  genesisHash: string
  owner: string
  delegate: string
  mint: string
  tokenAccount: string
  tokenProgram: string
  decimals: number
  mintedAmountRaw: string
  delegatedAmountRaw: string
  signatures: {
    airdrops: string[]
    setup: string
    approve: string
  }
  createdAt: string
  updatedAt: string
}

export class FixtureError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'FixtureError'
  }
}

// ---------- environment / RPC ----------

/** Load .env (if present) so EXPO_PUBLIC_SOLANA_RPC_URL applies to scripts the same way it applies to the app. */
export function loadEnv(): void {
  const envPath = path.resolve(process.cwd(), '.env')
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath)
  }
}

export function createDevnetRpc(): { rpc: DevnetRpc; label: string } {
  const override = process.env.EXPO_PUBLIC_SOLANA_RPC_URL?.trim()
  const url = override || DEFAULT_DEVNET_RPC_URL
  // Do not print the URL itself: a custom endpoint may embed an API key.
  const label =
    url === DEFAULT_DEVNET_RPC_URL ? DEFAULT_DEVNET_RPC_URL : 'custom endpoint from EXPO_PUBLIC_SOLANA_RPC_URL'
  return { rpc: createSolanaRpc(devnet(url)), label }
}

/** Refuse to continue unless the RPC is Solana Devnet. */
export async function assertDevnet(rpc: DevnetRpc): Promise<string> {
  let genesisHash: string
  try {
    genesisHash = await rpc.getGenesisHash().send()
  } catch (cause) {
    throw new FixtureError('RPC_UNAVAILABLE: could not reach the Devnet RPC (getGenesisHash failed).', { cause })
  }
  if (genesisHash !== DEVNET_GENESIS_HASH) {
    throw new FixtureError(
      `Refusing to run: RPC genesis hash ${genesisHash} is not Solana Devnet (${DEVNET_GENESIS_HASH}).`,
    )
  }
  return genesisHash
}

// ---------- keys ----------

/**
 * Load a dev-only keypair from `filePath`, or create one if the file does not exist.
 * Stored in Solana CLI format (JSON array of 64 bytes: 32-byte secret seed + 32-byte public key), mode 0600.
 */
export async function loadOrCreateKeypair(filePath: string): Promise<{ signer: KeyPairSigner; created: boolean }> {
  if (existsSync(filePath)) {
    let bytes: Uint8Array
    try {
      const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'))
      if (!Array.isArray(parsed) || parsed.length !== 64 || !parsed.every(isByte)) {
        throw new Error('expected a JSON array of 64 bytes')
      }
      bytes = Uint8Array.from(parsed)
    } catch (cause) {
      // Never echo the file contents: they are secret.
      throw new FixtureError(`Key file ${relative(filePath)} is not a valid 64-byte Solana keypair.`, { cause })
    }
    try {
      return { signer: await createKeyPairSignerFromBytes(bytes), created: false }
    } catch (cause) {
      throw new FixtureError(`Key file ${relative(filePath)} does not contain a consistent keypair.`, { cause })
    }
  }

  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 })
  const seed = crypto.getRandomValues(new Uint8Array(32))
  const signer = await createKeyPairSignerFromPrivateKeyBytes(seed)
  const keypairBytes = new Uint8Array(64)
  keypairBytes.set(seed, 0)
  keypairBytes.set(getAddressEncoder().encode(signer.address), 32)
  // 'wx' fails rather than overwrite an existing key.
  writeFileSync(filePath, JSON.stringify(Array.from(keypairBytes)), { mode: 0o600, flag: 'wx' })
  keypairBytes.fill(0)
  seed.fill(0)
  return { signer, created: true }
}

function isByte(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 255
}

// ---------- metadata ----------

export function readMetadata(): FixtureMetadata | null {
  if (!existsSync(METADATA_PATH)) {
    return null
  }
  let parsed: Partial<FixtureMetadata>
  try {
    parsed = JSON.parse(readFileSync(METADATA_PATH, 'utf8'))
  } catch (cause) {
    throw new FixtureError(`${relative(METADATA_PATH)} is not valid JSON. Delete it to recreate the fixture.`, {
      cause,
    })
  }
  const required = ['owner', 'delegate', 'mint', 'tokenAccount', 'genesisHash'] as const
  if (parsed.version !== 1 || parsed.cluster !== 'devnet' || required.some((k) => typeof parsed[k] !== 'string')) {
    throw new FixtureError(`${relative(METADATA_PATH)} has an unexpected shape. Delete it to recreate the fixture.`)
  }
  return parsed as FixtureMetadata
}

export function writeMetadata(metadata: FixtureMetadata): void {
  mkdirSync(FIXTURE_DIR, { recursive: true, mode: 0o700 })
  const tmp = `${METADATA_PATH}.tmp`
  writeFileSync(tmp, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o644 })
  renameSync(tmp, METADATA_PATH)
}

// ---------- transactions ----------

/** Build, sign, send, and wait for `confirmed`. Throws unless the transaction landed without error. */
export async function sendAndConfirm(
  rpc: DevnetRpc,
  feePayer: KeyPairSigner,
  instructions: Instruction[],
): Promise<Signature> {
  const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: COMMITMENT }).send()
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  )
  const transaction = await signTransactionMessageWithSigners(message)
  assertIsTransactionWithBlockhashLifetime(transaction)
  const signature = getSignatureFromTransaction(transaction)

  try {
    await rpc
      .sendTransaction(getBase64EncodedWireTransaction(transaction), {
        encoding: 'base64',
        preflightCommitment: COMMITMENT,
      })
      .send()
  } catch (cause) {
    throw new FixtureError(`TRANSACTION_FAILED: sendTransaction rejected ${signature}: ${describe(cause)}`, { cause })
  }

  await waitForSignature(rpc, signature, {
    lastValidBlockHeight: transaction.lifetimeConstraint.lastValidBlockHeight,
  })
  return signature
}

/** Poll signature status (HTTP only, no websocket) until confirmed, failed, expired, or timed out. */
export async function waitForSignature(
  rpc: DevnetRpc,
  signature: Signature,
  options: { lastValidBlockHeight?: bigint; timeoutMs?: number } = {},
): Promise<void> {
  const deadline = Date.now() + (options.timeoutMs ?? 90_000)
  while (Date.now() < deadline) {
    const { value } = await rpc.getSignatureStatuses([signature]).send()
    const status = value[0]
    if (status?.err) {
      throw new FixtureError(`TRANSACTION_FAILED: ${signature} failed on-chain: ${stringify(status.err)}`)
    }
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
      return
    }
    if (options.lastValidBlockHeight !== undefined) {
      const blockHeight = await rpc.getBlockHeight({ commitment: COMMITMENT }).send()
      if (blockHeight > options.lastValidBlockHeight) {
        throw new FixtureError(`TRANSACTION_FAILED: ${signature} expired before confirmation (blockhash too old).`)
      }
    }
    await sleep(1_000)
  }
  throw new FixtureError(`TRANSACTION_FAILED: timed out waiting for ${signature} to confirm.`)
}

// ---------- funding ----------

export const MIN_OWNER_BALANCE = lamports(50_000_000n) // 0.05 SOL: mint + token account rent and fees, with margin.
const AIRDROP_AMOUNT = lamports(1_000_000_000n) // 1 SOL
const AIRDROP_ATTEMPTS = 3

/**
 * Ensure `owner` holds at least MIN_OWNER_BALANCE via the public Devnet faucet (requestAirdrop).
 * Retries with backoff; on persistent failure throws a FixtureError explaining how to fund manually.
 */
export async function ensureFunded(rpc: DevnetRpc, owner: Address, log: (line: string) => void): Promise<string[]> {
  const balance = (await rpc.getBalance(owner, { commitment: COMMITMENT }).send()).value
  log(`Owner balance: ${formatRawAmount(balance, 9)} SOL`)
  if (balance >= MIN_OWNER_BALANCE) {
    return []
  }

  const errors: string[] = []
  for (let attempt = 1; attempt <= AIRDROP_ATTEMPTS; attempt += 1) {
    log(`Requesting Devnet airdrop of 1 SOL (attempt ${attempt}/${AIRDROP_ATTEMPTS})...`)
    try {
      const signature = await rpc.requestAirdrop(owner, AIRDROP_AMOUNT, { commitment: COMMITMENT }).send()
      await waitForSignature(rpc, signature, { timeoutMs: 60_000 })
      const after = (await rpc.getBalance(owner, { commitment: COMMITMENT }).send()).value
      log(`Airdrop confirmed: ${signature} (balance now ${formatRawAmount(after, 9)} SOL)`)
      if (after >= MIN_OWNER_BALANCE) {
        return [signature]
      }
      errors.push(`attempt ${attempt}: confirmed but balance is still below 0.05 SOL`)
    } catch (cause) {
      errors.push(`attempt ${attempt}: ${describe(cause)}`)
    }
    if (attempt < AIRDROP_ATTEMPTS) {
      const waitMs = 5_000 * attempt
      log(`Airdrop failed; retrying in ${waitMs / 1000}s.`)
      await sleep(waitMs)
    }
  }
  throw new FixtureError(
    [
      `Devnet airdrop failed after ${AIRDROP_ATTEMPTS} attempts. The public faucet is probably rate-limited.`,
      ...errors.map((e) => `  - ${e}`),
      `Fund the fixture owner manually, then rerun npm run fixture:create:`,
      `  owner: ${owner}`,
      `  https://faucet.solana.com (select Devnet), or wait and retry later.`,
      `Needs at least ${formatRawAmount(MIN_OWNER_BALANCE, 9)} SOL. Nothing was created on-chain.`,
    ].join('\n'),
  )
}

// ---------- verification ----------

export interface FixtureState {
  tokenAccountExists: boolean
  owner?: string
  mint?: string
  amount?: bigint
  delegate?: string | null
  delegatedAmount?: bigint
  programAddress?: string
}

/** Read the fixture token account directly by address. */
export async function readFixtureTokenAccount(rpc: DevnetRpc, tokenAccount: Address): Promise<FixtureState> {
  const account = await fetchMaybeToken(rpc, tokenAccount, { commitment: COMMITMENT })
  if (!account.exists) {
    return { tokenAccountExists: false }
  }
  return {
    tokenAccountExists: true,
    programAddress: account.programAddress,
    owner: account.data.owner,
    mint: account.data.mint,
    amount: account.data.amount,
    delegate: isSome(account.data.delegate) ? account.data.delegate.value : null,
    delegatedAmount: account.data.delegatedAmount,
  }
}

export interface VerificationReport {
  ok: boolean
  problems: string[]
  state: FixtureState
  finding: PermissionFinding | null
  scannedAccountCount: number
  contextSlot: bigint
}

/**
 * Prove the fixture on-chain: the exact token account (direct read) and GuardRail's own scanner must both show
 * the expected delegate and exactly DELEGATED_AMOUNT_RAW, with MINT_AMOUNT_RAW in the account.
 */
export async function verifyFixture(rpc: DevnetRpc, meta: FixtureMetadata): Promise<VerificationReport> {
  const problems: string[] = []
  const expect = (label: string, actual: unknown, expected: unknown) => {
    if (actual !== expected) problems.push(`${label}: expected ${String(expected)}, got ${String(actual)}`)
  }

  const state = await readFixtureTokenAccount(rpc, meta.tokenAccount as Address)
  if (!state.tokenAccountExists) {
    problems.push(`token account ${meta.tokenAccount} does not exist on Devnet`)
  } else {
    expect('token program', state.programAddress, TOKEN_PROGRAM_ADDRESS)
    expect('token account owner', state.owner, meta.owner)
    expect('token account mint', state.mint, meta.mint)
    expect('token balance (raw)', state.amount, MINT_AMOUNT_RAW)
    expect('delegate', state.delegate, meta.delegate)
    expect('delegated amount (raw)', state.delegatedAmount, DELEGATED_AMOUNT_RAW)
  }

  const scan = await scanPermissions(rpc, meta.owner as Address)
  const finding = scan.findings.find((f) => f.tokenAccount === meta.tokenAccount) ?? null
  if (!finding) {
    problems.push('GuardRail scanner did not report a delegate finding for the fixture token account')
  } else {
    expect('scanner delegate', finding.delegate, meta.delegate)
    expect('scanner mint', finding.mint, meta.mint)
    expect('scanner delegatedAmountRaw', finding.delegatedAmountRaw, DELEGATED_AMOUNT_RAW.toString())
    expect('scanner decimals', finding.decimals, DEMO_DECIMALS)
    expect('scanner explanationCode', finding.explanationCode, 'SPL_TOKEN_DELEGATE_ACTIVE')
    expect('scanner revocable', finding.revocable, true)
  }

  return {
    ok: problems.length === 0,
    problems,
    state,
    finding,
    scannedAccountCount: scan.scannedAccountCount,
    contextSlot: scan.contextSlot,
  }
}

export function printFixture(meta: FixtureMetadata, log: (line: string) => void = console.log): void {
  log('')
  log('GuardRail Devnet fixture (public data only)')
  log(`  cluster:           devnet`)
  log(`  owner:             ${meta.owner}`)
  log(`  delegate:          ${meta.delegate}`)
  log(`  mint:              ${meta.mint} (decimals ${meta.decimals})`)
  log(`  token account:     ${meta.tokenAccount}`)
  log(`  token program:     ${meta.tokenProgram}`)
  log(
    `  minted:            ${formatRawAmount(BigInt(meta.mintedAmountRaw), meta.decimals)} (raw ${meta.mintedAmountRaw})`,
  )
  log(
    `  delegated amount:  ${formatRawAmount(BigInt(meta.delegatedAmountRaw), meta.decimals)} (raw ${meta.delegatedAmountRaw})`,
  )
  for (const signature of meta.signatures.airdrops) log(`  airdrop tx:        ${signature}`)
  log(`  setup tx:          ${meta.signatures.setup}`)
  log(`  approve tx:        ${meta.signatures.approve}`)
  log(`  explorer:          ${explorerUrl('address', meta.tokenAccount)}`)
}

export function explorerUrl(kind: 'address' | 'tx', value: string): string {
  return `https://explorer.solana.com/${kind}/${value}?cluster=devnet`
}

// ---------- misc ----------

export function relative(filePath: string): string {
  return path.relative(process.cwd(), filePath)
}

export function describe(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? ` (cause: ${error.cause.message})` : ''
    return `${error.message}${cause}`
  }
  return String(error)
}

function stringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? v.toString() : v))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
