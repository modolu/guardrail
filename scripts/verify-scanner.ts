/**
 * Deterministic checks for the SPL Token delegate scanner. No network, no device.
 * Fixtures are hand-built byte layouts of the SPL Token Account (165 bytes) and Mint (82 bytes),
 * independent of the decoder under test.
 *
 * Run: npm run verify:scanner
 */
import assert from 'node:assert/strict'
import { getAddressDecoder, type Address } from '@solana/kit'
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token'
import {
  buildFinding,
  parseMintDecimals,
  parseTokenAccount,
  scanPermissions,
  type PermissionScanRpc,
  type RawAccount,
} from '../src/solana/scanPermissions'
import {
  delegatedAmountSummary,
  PERMISSION_EXPLANATIONS,
  REVOKE_UNAVAILABLE_REASONS,
} from '../src/constants/explanations'
import { GuardRailError } from '../src/types/errors'
import { formatRawAmount, parseRawAmount } from '../src/utils/amounts'

const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PE1qXd5n6a5AeT2'
const U64_MAX = (1n << 64n) - 1n

function addr(seed: number): Address {
  return getAddressDecoder().decode(new Uint8Array(32).fill(seed))
}
const WALLET = addr(1)
const OTHER_OWNER = addr(2)
const MINT = addr(3)
const DELEGATE = addr(4)
const TOKEN_ACCOUNT = addr(5)

function addressBytes(seed: number): Uint8Array {
  return new Uint8Array(32).fill(seed)
}

interface TokenLayout {
  mintSeed?: number
  ownerSeed?: number
  amount?: bigint
  delegateSeed?: number | null
  delegateTag?: number
  state?: number
  delegatedAmount?: bigint
}

// SPL Token Account: mint(32) owner(32) amount(u64) delegate(COption<Pubkey>) state(u8)
// is_native(COption<u64>) delegated_amount(u64) close_authority(COption<Pubkey>) = 165 bytes.
function tokenAccountBytes(layout: TokenLayout = {}): Uint8Array {
  const data = new Uint8Array(165)
  const view = new DataView(data.buffer)
  data.set(addressBytes(layout.mintSeed ?? 3), 0)
  data.set(addressBytes(layout.ownerSeed ?? 1), 32)
  view.setBigUint64(64, layout.amount ?? 1_000_000_000n, true)
  const delegateSeed = layout.delegateSeed === undefined ? 4 : layout.delegateSeed
  view.setUint32(72, layout.delegateTag ?? (delegateSeed === null ? 0 : 1), true)
  if (delegateSeed !== null) data.set(addressBytes(delegateSeed), 76)
  data[108] = layout.state ?? 1
  view.setUint32(109, 0, true) // is_native: None
  view.setBigUint64(121, layout.delegatedAmount ?? 250_500_000n, true)
  view.setUint32(129, 0, true) // close_authority: None
  return data
}

// SPL Token Mint: mint_authority(COption<Pubkey>) supply(u64) decimals(u8) is_initialized(bool)
// freeze_authority(COption<Pubkey>) = 82 bytes.
function mintBytes(decimals: number, initialized = true): Uint8Array {
  const data = new Uint8Array(82)
  const view = new DataView(data.buffer)
  view.setUint32(0, 0, true)
  view.setBigUint64(36, 1_000_000_000_000n, true)
  data[44] = decimals
  data[45] = initialized ? 1 : 0
  view.setUint32(46, 0, true)
  return data
}

function raw(
  data: Uint8Array,
  programOwner: string = TOKEN_PROGRAM_ADDRESS,
  address: string = TOKEN_ACCOUNT,
): RawAccount {
  return { address, programOwner, data }
}

const tests: [string, () => void | Promise<void>][] = []
const test = (name: string, fn: () => void | Promise<void>) => tests.push([name, fn])

// ---- amounts ----
test('formatRawAmount uses integer math', () => {
  assert.equal(formatRawAmount(0n, 0), '0')
  assert.equal(formatRawAmount(0n, 6), '0')
  assert.equal(formatRawAmount(1_234_500n, 6), '1.2345')
  assert.equal(formatRawAmount(1_000_000n, 6), '1')
  assert.equal(formatRawAmount(1n, 9), '0.000000001')
  assert.equal(formatRawAmount(123_456_789n, 2), '1,234,567.89')
  assert.equal(formatRawAmount(U64_MAX, 0), '18,446,744,073,709,551,615')
  assert.equal(formatRawAmount(U64_MAX, 9), '18,446,744,073.709551615')
  assert.throws(() => formatRawAmount(-1n, 0), RangeError)
  assert.throws(() => formatRawAmount(1n, 256), RangeError)
  assert.throws(() => formatRawAmount(1n, 1.5), RangeError)
})

test('parseRawAmount accepts only u64 decimal strings', () => {
  assert.equal(parseRawAmount('0'), 0n)
  assert.equal(parseRawAmount('18446744073709551615'), U64_MAX)
  assert.equal(parseRawAmount('18446744073709551616'), null)
  for (const bad of ['', '-1', '1.5', '1e6', ' 1', '0x10']) assert.equal(parseRawAmount(bad), null, bad)
})

// ---- token account parsing ----
test('active delegate is detected with exact raw amount', () => {
  const result = parseTokenAccount(raw(tokenAccountBytes({ delegatedAmount: U64_MAX })), WALLET)
  assert.equal(result.kind, 'delegate')
  if (result.kind !== 'delegate') return
  assert.deepEqual(result.candidate, {
    tokenAccount: TOKEN_ACCOUNT,
    mint: MINT,
    owner: WALLET,
    delegate: DELEGATE,
    delegatedAmount: U64_MAX,
    state: 1,
  })
})

test('account without delegate is not a finding', () => {
  assert.deepEqual(parseTokenAccount(raw(tokenAccountBytes({ delegateSeed: null })), WALLET), { kind: 'no-delegate' })
})

test('frozen account with delegate is a candidate in frozen state', () => {
  const result = parseTokenAccount(raw(tokenAccountBytes({ state: 2 })), WALLET)
  assert.equal(result.kind === 'delegate' && result.candidate.state, 2)
})

test('malformed or foreign accounts are invalid, never findings', () => {
  const cases: [string, RawAccount][] = [
    ['Token-2022 program owner', raw(tokenAccountBytes(), TOKEN_2022_PROGRAM)],
    ['short data', raw(tokenAccountBytes().slice(0, 164))],
    ['long data (extensions)', raw(new Uint8Array(170))],
    ['empty data', raw(new Uint8Array(0))],
    ['uninitialized state', raw(tokenAccountBytes({ state: 0 }))],
    ['unknown state byte', raw(tokenAccountBytes({ state: 3 }))],
    ['corrupt delegate tag', raw(tokenAccountBytes({ delegateTag: 2 }))],
    ['owner is not the wallet', raw(tokenAccountBytes({ ownerSeed: 2 }))],
  ]
  for (const [name, account] of cases) {
    assert.equal(parseTokenAccount(account, WALLET).kind, 'invalid', name)
  }
  assert.notEqual(parseTokenAccount(raw(tokenAccountBytes({ ownerSeed: 2 })), OTHER_OWNER).kind, 'invalid')
})

// ---- mint parsing ----
test('mint decimals are read only from initialized SPL Token mints', () => {
  assert.equal(parseMintDecimals(raw(mintBytes(6))), 6)
  assert.equal(parseMintDecimals(raw(mintBytes(0))), 0)
  assert.equal(parseMintDecimals(raw(mintBytes(6, false))), null)
  assert.equal(parseMintDecimals(raw(mintBytes(6), TOKEN_2022_PROGRAM)), null)
  assert.equal(parseMintDecimals(raw(mintBytes(6).slice(0, 81))), null)
  assert.equal(parseMintDecimals(null), null)
})

// ---- findings ----
function candidate(overrides: Partial<{ delegatedAmount: bigint; state: 1 | 2 }> = {}) {
  return {
    tokenAccount: TOKEN_ACCOUNT,
    mint: MINT,
    owner: WALLET,
    delegate: DELEGATE,
    delegatedAmount: 250_500_000n,
    state: 1 as const,
    ...overrides,
  }
}

test('active delegate finding preserves all fields', () => {
  assert.deepEqual(buildFinding(candidate(), 6), {
    id: TOKEN_ACCOUNT,
    type: 'SPL_TOKEN_DELEGATE',
    tokenAccount: TOKEN_ACCOUNT,
    mint: MINT,
    owner: WALLET,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    delegate: DELEGATE,
    delegatedAmountRaw: '250500000',
    decimals: 6,
    delegatedAmountDisplay: '250.5',
    revocable: true,
    explanationCode: 'SPL_TOKEN_DELEGATE_ACTIVE',
  })
})

test('u64 max delegated amount survives as an exact string', () => {
  const finding = buildFinding(candidate({ delegatedAmount: U64_MAX }), 9)
  assert.equal(finding.delegatedAmountRaw, '18446744073709551615')
  assert.equal(finding.delegatedAmountDisplay, '18,446,744,073.709551615')
})

test('explanation codes and revocability', () => {
  const zero = buildFinding(candidate({ delegatedAmount: 0n }), 6)
  assert.equal(zero.explanationCode, 'SPL_TOKEN_DELEGATE_ZERO_AMOUNT')
  assert.equal(zero.revocable, true)
  const frozen = buildFinding(candidate({ state: 2 }), 6)
  assert.equal(frozen.explanationCode, 'SPL_TOKEN_DELEGATE_ACCOUNT_FROZEN')
  assert.equal(frozen.revocable, false)
  const unknownMint = buildFinding(candidate(), null)
  assert.equal(unknownMint.explanationCode, 'SPL_TOKEN_DELEGATE_MINT_UNREADABLE')
  assert.equal(unknownMint.revocable, false)
  assert.equal(unknownMint.decimals, null)
  assert.equal(unknownMint.delegatedAmountDisplay, '250500000 base units')
})

test('frozen accounts are view-only: on-chain Revoke fails with AccountFrozen', () => {
  // Mirrors `process_revoke` in solana-program/token (and p-token): the frozen check runs before the owner check,
  // so even the owner's signature cannot revoke a frozen account. Zero-amount delegates stay revocable.
  for (const delegatedAmount of [0n, 1n, U64_MAX]) {
    const finding = buildFinding(candidate({ state: 2, delegatedAmount }), 6)
    assert.equal(finding.explanationCode, 'SPL_TOKEN_DELEGATE_ACCOUNT_FROZEN')
    assert.equal(finding.revocable, false)
  }
})

test('revoke-unavailable reasons agree with finding revocability for every code', () => {
  const findings = [
    buildFinding(candidate(), 6),
    buildFinding(candidate({ delegatedAmount: 0n }), 6),
    buildFinding(candidate({ state: 2 }), 6),
    buildFinding(candidate(), null),
  ]
  assert.deepEqual(
    new Set(findings.map((f) => f.explanationCode)),
    new Set(Object.keys(PERMISSION_EXPLANATIONS)),
    'every explanation code is exercised',
  )
  for (const finding of findings) {
    const reason = REVOKE_UNAVAILABLE_REASONS[finding.explanationCode]
    assert.equal(reason === null, finding.revocable, finding.explanationCode)
  }
})

test('explanations use factual language only', () => {
  const copy = [...Object.values(PERMISSION_EXPLANATIONS), ...Object.values(REVOKE_UNAVAILABLE_REASONS)].join(' ')
  for (const word of ['malicious', 'dangerous', 'scam', 'compromised', 'safe', 'risk']) {
    assert.ok(!new RegExp(`\\b${word}`, 'i').test(copy), word)
  }
})

test('delegated amount summary is plain language', () => {
  assert.equal(delegatedAmountSummary(buildFinding(candidate(), 6)), 'Can move up to 250.5 tokens')
  assert.equal(
    delegatedAmountSummary(buildFinding(candidate({ delegatedAmount: 0n }), 6)),
    'Delegated amount is 0; cannot currently move tokens',
  )
  assert.equal(delegatedAmountSummary(buildFinding(candidate(), null)), 'Can move up to 250500000 base units')
})

// ---- scanPermissions with a fake RPC ----
const b64 = (data: Uint8Array) => Buffer.from(data).toString('base64')
const rpcAccount = (data: Uint8Array, owner: string = TOKEN_PROGRAM_ADDRESS) => ({
  data: [b64(data), 'base64'],
  executable: false,
  lamports: 2_039_280n,
  owner,
  space: BigInt(data.length),
})

function fakeRpc(handlers: {
  getTokenAccountsByOwner: (...args: unknown[]) => unknown
  getMultipleAccounts?: (...args: unknown[]) => unknown
}) {
  const calls: { method: string; args: unknown[] }[] = []
  const rpc = Object.fromEntries(
    Object.entries(handlers).map(([method, handler]) => [
      method,
      (...args: unknown[]) => {
        calls.push({ method, args })
        return { send: async () => handler(...args) }
      },
    ]),
  ) as unknown as PermissionScanRpc
  return { rpc, calls }
}

test('scanPermissions returns only valid delegates and counts skipped accounts', async () => {
  const { rpc, calls } = fakeRpc({
    getTokenAccountsByOwner: () => ({
      context: { slot: 4242n },
      value: [
        { pubkey: addr(10), account: rpcAccount(tokenAccountBytes()) },
        { pubkey: addr(11), account: rpcAccount(tokenAccountBytes({ delegateSeed: null })) },
        { pubkey: addr(12), account: rpcAccount(new Uint8Array(170)) },
        { pubkey: addr(13), account: rpcAccount(tokenAccountBytes(), TOKEN_2022_PROGRAM) },
        { pubkey: addr(14), account: rpcAccount(tokenAccountBytes({ mintSeed: 9, state: 2 })) },
      ],
    }),
    getMultipleAccounts: (mints) => ({
      context: { slot: 4242n },
      value: (mints as Address[]).map((m) => (m === MINT ? rpcAccount(mintBytes(6)) : null)),
    }),
  })
  const result = await scanPermissions(rpc, WALLET)

  assert.equal(result.scannedAccountCount, 5)
  assert.equal(result.skippedAccountCount, 2)
  assert.equal(result.contextSlot, 4242n)
  assert.deepEqual(
    result.findings.map((f) => [f.tokenAccount, f.explanationCode, f.revocable]),
    [
      [addr(10), 'SPL_TOKEN_DELEGATE_ACTIVE', true],
      [addr(14), 'SPL_TOKEN_DELEGATE_ACCOUNT_FROZEN', false],
    ],
  )

  assert.deepEqual(calls[0], {
    method: 'getTokenAccountsByOwner',
    args: [WALLET, { programId: TOKEN_PROGRAM_ADDRESS }, { commitment: 'confirmed', encoding: 'base64' }],
  })
  assert.equal(calls[1].method, 'getMultipleAccounts')
  assert.deepEqual(new Set(calls[1].args[0] as string[]), new Set([MINT, addr(9)]))
  assert.deepEqual(calls[1].args[1], { commitment: 'confirmed', encoding: 'base64', minContextSlot: 4242n })
})

test('scanPermissions with no delegates makes no mint request', async () => {
  const { rpc, calls } = fakeRpc({
    getTokenAccountsByOwner: () => ({ context: { slot: 1n }, value: [] }),
  })
  const result = await scanPermissions(rpc, WALLET)
  assert.deepEqual(result.findings, [])
  assert.equal(calls.length, 1)
})

test('RPC failure surfaces as RPC_UNAVAILABLE', async () => {
  const { rpc } = fakeRpc({
    getTokenAccountsByOwner: () => {
      throw new Error('fetch failed')
    },
  })
  await assert.rejects(scanPermissions(rpc, WALLET), (e) => e instanceof GuardRailError && e.code === 'RPC_UNAVAILABLE')
})

async function main() {
  let failed = 0
  for (const [name, fn] of tests) {
    try {
      await fn()
      console.log(`ok   ${name}`)
    } catch (error) {
      failed += 1
      console.error(`FAIL ${name}\n${error instanceof Error ? error.stack : String(error)}`)
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`)
  process.exitCode = failed ? 1 : 0
}

void main()
