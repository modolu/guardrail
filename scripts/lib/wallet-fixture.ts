/**
 * Helpers for the wallet-owned Devnet fixture (Node only, never bundled into the app).
 *
 * Unlike fixture.json, the token account here belongs to a real Android wallet (FIXTURE_WALLET_OWNER), whose key never
 * leaves the wallet. The Mac side only pays for and creates the mint and the wallet's token account, and mints demo
 * tokens. The delegate approval is signed later by the wallet itself, in the app's Devnet demo setup panel.
 *
 * Files under .local/fixture/ (gitignored):
 * - owner-keypair.json: SECRET. Reused here as the payer and mint authority. Never printed.
 * - delegate-keypair.json: SECRET. Only its public address is used, as the demo delegate. Never printed.
 * - wallet-fixture.json: public metadata only (addresses, amounts, signatures).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { isAddress, lamports, type Address } from '@solana/kit'
import { fetchMaybeMint, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token'
import { DEMO_APPROVE_AMOUNT_RAW, DEMO_APPROVE_DECIMALS } from '../../src/solana/demoApprove'
import { scanPermissions } from '../../src/solana/scanPermissions'
import type { PermissionFinding } from '../../src/types/permission'
import { formatRawAmount } from '../../src/utils/amounts'
import {
  explorerUrl,
  FIXTURE_DIR,
  FixtureError,
  MINT_AMOUNT_RAW,
  readFixtureTokenAccount,
  relative,
  type DevnetRpc,
  type FixtureState,
} from './fixture'

export const WALLET_FIXTURE_PATH = path.join(FIXTURE_DIR, 'wallet-fixture.json')

// The wallet pays the fees for the in-app approve and revoke. Top it up from the payer if it is below this.
export const MIN_WALLET_FEE_BALANCE = lamports(5_000_000n) // 0.005 SOL
export const WALLET_FEE_TOP_UP = lamports(10_000_000n) // 0.01 SOL

export interface WalletFixtureMetadata {
  version: 1
  kind: 'wallet-owned'
  cluster: 'devnet'
  genesisHash: string
  walletOwner: string
  payer: string
  mintAuthority: string
  delegate: string
  mint: string
  tokenAccount: string
  tokenProgram: string
  decimals: number
  mintedAmountRaw: string
  approveAmountRaw: string
  signatures: {
    airdrops: string[]
    setup: string
    feeTopUps: string[]
  }
  createdAt: string
  updatedAt: string
}

/** FIXTURE_WALLET_OWNER: the public address of the Android test wallet. Required; no private key is ever needed. */
export function readWalletOwnerEnv(): Address {
  const value = process.env.FIXTURE_WALLET_OWNER?.trim() ?? ''
  if (!value) {
    throw new FixtureError(
      'Set FIXTURE_WALLET_OWNER to the public address of the Android test wallet, e.g.\n' +
        '  FIXTURE_WALLET_OWNER=<wallet address> npm run fixture:wallet:create',
    )
  }
  if (!isAddress(value)) {
    throw new FixtureError(`FIXTURE_WALLET_OWNER is not a valid Solana address: ${value}`)
  }
  return value
}

export function readWalletMetadata(): WalletFixtureMetadata | null {
  if (!existsSync(WALLET_FIXTURE_PATH)) {
    return null
  }
  let parsed: Partial<WalletFixtureMetadata>
  try {
    parsed = JSON.parse(readFileSync(WALLET_FIXTURE_PATH, 'utf8'))
  } catch (cause) {
    throw new FixtureError(`${relative(WALLET_FIXTURE_PATH)} is not valid JSON. Delete it to recreate the fixture.`, {
      cause,
    })
  }
  const required = ['walletOwner', 'payer', 'delegate', 'mint', 'tokenAccount', 'genesisHash'] as const
  if (
    parsed.version !== 1 ||
    parsed.kind !== 'wallet-owned' ||
    parsed.cluster !== 'devnet' ||
    required.some((k) => typeof parsed[k] !== 'string')
  ) {
    throw new FixtureError(`${relative(WALLET_FIXTURE_PATH)} has an unexpected shape. Delete it to recreate it.`)
  }
  return parsed as WalletFixtureMetadata
}

export function writeWalletMetadata(metadata: WalletFixtureMetadata): void {
  mkdirSync(FIXTURE_DIR, { recursive: true, mode: 0o700 })
  const tmp = `${WALLET_FIXTURE_PATH}.tmp`
  writeFileSync(tmp, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o644 })
  renameSync(tmp, WALLET_FIXTURE_PATH)
}

export type WalletFixtureStatus = 'ready' | 'approved' | 'problem'

export interface WalletFixtureReport {
  /** ready: no delegate yet (approve in the app). approved: exactly the demo delegate for exactly 500 tokens. */
  status: WalletFixtureStatus
  problems: string[]
  state: FixtureState
  walletBalance: bigint
  finding: PermissionFinding | null
}

/**
 * Read-only check of the wallet-owned fixture: the exact token account (direct read), the mint, and, once approved,
 * GuardRail's own scanner must agree with the metadata.
 */
export async function inspectWalletFixture(rpc: DevnetRpc, meta: WalletFixtureMetadata): Promise<WalletFixtureReport> {
  const problems: string[] = []
  const expect = (label: string, actual: unknown, expected: unknown) => {
    if (actual !== expected) problems.push(`${label}: expected ${String(expected)}, got ${String(actual)}`)
  }

  const mint = await fetchMaybeMint(rpc, meta.mint as Address, { commitment: 'confirmed' })
  if (!mint.exists) {
    problems.push(`mint ${meta.mint} does not exist on Devnet`)
  } else {
    expect('mint program', mint.programAddress, TOKEN_PROGRAM_ADDRESS)
    expect('mint decimals', mint.data.decimals, DEMO_APPROVE_DECIMALS)
  }

  const state = await readFixtureTokenAccount(rpc, meta.tokenAccount as Address)
  const walletBalance = (await rpc.getBalance(meta.walletOwner as Address, { commitment: 'confirmed' }).send()).value
  if (!state.tokenAccountExists) {
    problems.push(`token account ${meta.tokenAccount} does not exist on Devnet`)
    return { status: 'problem', problems, state, walletBalance, finding: null }
  }
  expect('token program', state.programAddress, TOKEN_PROGRAM_ADDRESS)
  expect('token account owner', state.owner, meta.walletOwner)
  expect('token account mint', state.mint, meta.mint)

  let status: WalletFixtureStatus = 'ready'
  let finding: PermissionFinding | null = null
  if (state.delegate) {
    status = 'approved'
    expect('delegate', state.delegate, meta.delegate)
    expect('delegated amount (raw)', state.delegatedAmount, DEMO_APPROVE_AMOUNT_RAW)
    const scan = await scanPermissions(rpc, meta.walletOwner as Address)
    finding = scan.findings.find((f) => f.tokenAccount === meta.tokenAccount) ?? null
    if (!finding) {
      problems.push('GuardRail scanner did not report a delegate finding for the wallet token account')
    } else {
      expect('scanner delegate', finding.delegate, meta.delegate)
      expect('scanner delegatedAmountRaw', finding.delegatedAmountRaw, DEMO_APPROVE_AMOUNT_RAW.toString())
      expect('scanner decimals', finding.decimals, DEMO_APPROVE_DECIMALS)
      expect('scanner revocable', finding.revocable, true)
    }
  }
  return { status: problems.length ? 'problem' : status, problems, state, walletBalance, finding }
}

export function printWalletFixture(meta: WalletFixtureMetadata, log: (line: string) => void = console.log): void {
  log('')
  log('GuardRail wallet-owned Devnet fixture (public data only)')
  log(`  cluster:           devnet`)
  log(`  wallet owner:      ${meta.walletOwner}`)
  log(`  payer / mint auth: ${meta.payer}`)
  log(`  demo delegate:     ${meta.delegate}`)
  log(`  mint:              ${meta.mint} (decimals ${meta.decimals})`)
  log(`  token account:     ${meta.tokenAccount}`)
  log(
    `  minted:            ${formatRawAmount(BigInt(meta.mintedAmountRaw), meta.decimals)} (raw ${meta.mintedAmountRaw})`,
  )
  log(
    `  in-app approve:    ${formatRawAmount(BigInt(meta.approveAmountRaw), meta.decimals)} (raw ${meta.approveAmountRaw})`,
  )
  for (const signature of meta.signatures.airdrops) log(`  airdrop tx:        ${signature}`)
  log(`  setup tx:          ${meta.signatures.setup}`)
  for (const signature of meta.signatures.feeTopUps) log(`  fee top-up tx:     ${signature}`)
  log(`  explorer:          ${explorerUrl('address', meta.tokenAccount)}`)
  log('')
  log('App build environment (public values) to enable the Devnet demo setup panel:')
  log('  EXPO_PUBLIC_DEMO_SETUP=1')
  log(`  EXPO_PUBLIC_DEMO_MINT=${meta.mint}`)
  log(`  EXPO_PUBLIC_DEMO_DELEGATE=${meta.delegate}`)
}

export function printWalletFixtureReport(report: WalletFixtureReport, log: (line: string) => void = console.log): void {
  const { state } = report
  log('')
  log(`Wallet SOL balance: ${formatRawAmount(report.walletBalance, 9)} SOL`)
  if (report.walletBalance < MIN_WALLET_FEE_BALANCE) {
    log('  note: below 0.005 SOL; the wallet may not be able to pay the approve and revoke fees.')
  }
  log(`Token account exists: ${state.tokenAccountExists}`)
  if (state.tokenAccountExists) {
    log(`  balance raw: ${String(state.amount)} (minted ${MINT_AMOUNT_RAW})`)
    log(`  delegate: ${state.delegate ?? 'none'}`)
    log(`  delegated amount raw: ${String(state.delegatedAmount)}`)
  }
  if (report.finding) {
    const f = report.finding
    log(`GuardRail scanner: ${f.type} ${f.explanationCode} revocable=${f.revocable}`)
    log(`  delegated: ${f.delegatedAmountDisplay} (raw ${f.delegatedAmountRaw}, decimals ${f.decimals})`)
  }
}
