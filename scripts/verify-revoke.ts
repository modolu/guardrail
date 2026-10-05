/**
 * Deterministic checks for the SPL Token delegate revoke flow. No network, no device, no signing.
 * Covers revoke preconditions, the exact instruction, how wallet-ui's Kit compiles it, wallet cancellation,
 * confirmation, and post-revoke verification (including retry), all against a fake RPC.
 *
 * Run: npm run verify:revoke
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { AccountRole, getBase58Decoder, type Blockhash, type Instruction, type Signature } from '@solana/kit'
import { AccountState, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token'
import { REVOKE_UNAVAILABLE_REASONS } from '../src/constants/explanations'
import {
  assertRevokePreconditions,
  buildRevokeInstruction,
  confirmAndVerifyRevoke,
  confirmSignature,
  isWalletRejection,
  revokePreconditionError,
  submitRevoke,
  type RevokeRpc,
} from '../src/solana/revoke'
import { buildFinding } from '../src/solana/scanPermissions'
import { GuardRailError } from '../src/types/errors'
import type { PermissionFinding } from '../src/types/permission'
import { explorerTransactionUrl } from '../src/utils/explorer'
import { addr, tokenAccountBytes, type TokenLayout } from './lib/token-bytes'

const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PE1qXd5n6a5AeT2'
const WALLET = addr(1)
const OTHER_WALLET = addr(2)
const MINT = addr(3)
const DELEGATE = addr(4)
const TOKEN_ACCOUNT = addr(5)
const SIGNATURE = getBase58Decoder().decode(new Uint8Array(64).fill(7))

type Candidate = Parameters<typeof buildFinding>[0]

const candidate = (overrides: Partial<Candidate> = {}): Candidate => ({
  tokenAccount: TOKEN_ACCOUNT,
  mint: MINT,
  owner: WALLET,
  delegate: DELEGATE,
  delegatedAmount: 250_500_000n,
  state: AccountState.Initialized,
  ...overrides,
})

function finding(overrides: Partial<PermissionFinding> = {}): PermissionFinding {
  return { ...buildFinding(candidate(), 6), ...overrides }
}

const tests: [string, () => void | Promise<void>][] = []
const test = (name: string, fn: () => void | Promise<void>) => tests.push([name, fn])

// ---- preconditions ----
test('a revocable delegate owned by the connected wallet passes preconditions', () => {
  assert.equal(revokePreconditionError(finding(), WALLET), null)
  assert.doesNotThrow(() => assertRevokePreconditions(finding(), WALLET))
})

test('zero-amount delegates are revocable', () => {
  const zero = buildFinding(candidate({ delegatedAmount: 0n }), 6)
  assert.equal(revokePreconditionError(zero, WALLET), null)
})

test('preconditions reject everything GuardRail must not mutate', () => {
  const frozen = buildFinding(candidate({ state: AccountState.Frozen }), 6)
  const unreadableMint = buildFinding(candidate(), null)
  const cases: [string, PermissionFinding, string | undefined, string][] = [
    ['wallet not connected', finding(), undefined, 'WALLET_NOT_CONNECTED'],
    ['connected wallet is not the owner', finding(), OTHER_WALLET, 'UNSUPPORTED_AUTHORITY'],
    ['Token-2022 program', finding({ tokenProgram: TOKEN_2022_PROGRAM }), WALLET, 'UNSUPPORTED_AUTHORITY'],
    ['unknown permission type', finding({ type: 'OTHER' as never }), WALLET, 'UNSUPPORTED_AUTHORITY'],
    ['not marked revocable', finding({ revocable: false }), WALLET, 'REVOKE_NOT_SUPPORTED'],
    ['frozen account', frozen, WALLET, 'REVOKE_NOT_SUPPORTED'],
    ['unreadable mint', unreadableMint, WALLET, 'REVOKE_NOT_SUPPORTED'],
    ['frozen code with a forged revocable flag', { ...frozen, revocable: true }, WALLET, 'REVOKE_NOT_SUPPORTED'],
    ['bad token account address', finding({ tokenAccount: 'not-an-address' }), WALLET, 'TOKEN_ACCOUNT_PARSE_FAILED'],
    ['invalid delegate address', finding({ delegate: '123' }), WALLET, 'TOKEN_ACCOUNT_PARSE_FAILED'],
    ['non-integer delegated amount', finding({ delegatedAmountRaw: '1.5' }), WALLET, 'TOKEN_ACCOUNT_PARSE_FAILED'],
  ]
  for (const [name, input, connected, code] of cases) {
    assert.equal(revokePreconditionError(input, connected)?.code, code, name)
    assert.throws(
      () => assertRevokePreconditions(input, connected),
      (e) => e instanceof GuardRailError && e.code === code,
      name,
    )
  }
})

test('revoke is offered exactly for the explanation codes whose unavailable reason is null', () => {
  for (const [code, reason] of Object.entries(REVOKE_UNAVAILABLE_REASONS)) {
    const input = finding({ explanationCode: code as PermissionFinding['explanationCode'], revocable: true })
    assert.equal(revokePreconditionError(input, WALLET) === null, reason === null, code)
  }
})

// ---- instruction ----
test('the revoke instruction is the standard SPL Token Revoke and nothing else', () => {
  const instruction = buildRevokeInstruction(finding())
  assert.equal(instruction.programAddress, TOKEN_PROGRAM_ADDRESS)
  assert.deepEqual(Array.from(instruction.data), [5]) // Revoke discriminator, no arguments
  assert.equal(instruction.accounts.length, 2)
  assert.equal(instruction.accounts[0].address, TOKEN_ACCOUNT)
  assert.equal(instruction.accounts[0].role, AccountRole.WRITABLE)
  assert.equal(instruction.accounts[1].address, WALLET)
  // The owner is a signer through being the fee payer; the instruction meta must at least never be writable.
  assert.ok([AccountRole.READONLY, AccountRole.READONLY_SIGNER].includes(instruction.accounts[1].role))
})

// wallet-ui compiles the instruction with its own bundled @solana/kit (7.x) and the owner as fee payer. Resolve that
// exact copy the way wallet-ui does, then check the compiled message the wallet would be asked to sign.
test("wallet-ui's Kit compiles the revoke into a one-instruction message signed only by the owner", () => {
  const walletRequire = createRequire(require.resolve('@wallet-ui/react-native-kit'))
  console.log(`     (wallet-ui Kit resolved from ${walletRequire.resolve('@solana/kit')})`)
  const kit = walletRequire('@solana/kit') as typeof import('@solana/kit')

  const instruction = buildRevokeInstruction(finding())
  const lifetime = { blockhash: addr(9) as unknown as Blockhash, lastValidBlockHeight: 100n }
  const message = kit.pipe(
    kit.createTransactionMessage({ version: 0 }),
    (m) => kit.appendTransactionMessageInstructions([instruction], m),
    (m) => kit.setTransactionMessageFeePayer(WALLET, m),
    (m) => kit.setTransactionMessageLifetimeUsingBlockhash(lifetime, m),
  )
  const compiled = kit.compileTransactionMessage(message) as unknown as {
    header: { numSignerAccounts: number; numReadonlySignerAccounts: number }
    staticAccounts: string[]
    instructions: { programAddressIndex: number; accountIndices?: number[]; data?: Uint8Array }[]
  }

  assert.equal(compiled.header.numSignerAccounts, 1, 'exactly one signer')
  assert.equal(compiled.header.numReadonlySignerAccounts, 0)
  assert.equal(compiled.staticAccounts[0], WALLET, 'the owner is the first signer and fee payer')
  assert.equal(compiled.instructions.length, 1, 'exactly one instruction')
  const [ix] = compiled.instructions
  assert.equal(compiled.staticAccounts[ix.programAddressIndex], TOKEN_PROGRAM_ADDRESS)
  const instructionAccounts = (ix.accountIndices ?? []).map((index) => compiled.staticAccounts[index])
  assert.deepEqual(instructionAccounts, [TOKEN_ACCOUNT, WALLET])
  assert.deepEqual(Array.from(ix.data ?? []), [5])
  assert.equal(compiled.staticAccounts.length, 3, 'owner, token account, token program and nothing else')
})

// ---- wallet error classification ----
function mwaError(name: string, code: unknown): Error {
  return Object.assign(new Error(`mwa ${String(code)}`), { name, code })
}
const PROTOCOL = 'SolanaMobileWalletAdapterProtocolError'
const SESSION = 'SolanaMobileWalletAdapterError'

test('wallet cancellation is recognised, including through wrapped errors', () => {
  assert.equal(isWalletRejection(mwaError(PROTOCOL, -3)), true, 'ERROR_NOT_SIGNED')
  assert.equal(isWalletRejection(mwaError(PROTOCOL, -1)), true, 'ERROR_AUTHORIZATION_FAILED')
  assert.equal(isWalletRejection(mwaError(SESSION, 'ERROR_SESSION_CLOSED')), true)
  assert.equal(isWalletRejection(mwaError(SESSION, 'ERROR_ASSOCIATION_CANCELLED')), true)
  assert.equal(isWalletRejection(new Error('wrapped', { cause: mwaError(PROTOCOL, -3) })), true)
})

test('other wallet failures are not treated as cancellation', () => {
  assert.equal(isWalletRejection(mwaError(PROTOCOL, -4)), false, 'ERROR_NOT_SUBMITTED')
  assert.equal(isWalletRejection(mwaError(SESSION, 'ERROR_WALLET_NOT_FOUND')), false)
  assert.equal(isWalletRejection(mwaError('Error', -3)), false, 'code alone is not enough')
  for (const value of [new Error('boom'), 'string', null, undefined, 42]) {
    assert.equal(isWalletRejection(value), false)
  }
})

// ---- fake RPC ----
interface Call {
  method: string
  args: unknown[]
}
const b64 = (data: Uint8Array) => Buffer.from(data).toString('base64')
const tokenRpcAccount = (data: Uint8Array, owner: string = TOKEN_PROGRAM_ADDRESS) => ({
  data: [b64(data), 'base64'],
  executable: false,
  lamports: 2_039_280n,
  owner,
  space: BigInt(data.length),
})
const accountResponse = (account: ReturnType<typeof tokenRpcAccount> | null, slot = 100n) => ({
  context: { slot },
  value: account,
})
const tokenResponse = (layout: TokenLayout = {}, programOwner: string = TOKEN_PROGRAM_ADDRESS) =>
  accountResponse(tokenRpcAccount(tokenAccountBytes(layout), programOwner))
const status = (overrides: Record<string, unknown> = {}) => ({
  context: { slot: 100n },
  value: [{ slot: 99n, confirmations: null, err: null, confirmationStatus: 'confirmed', ...overrides }],
})
const pending = { context: { slot: 100n }, value: [null] }

function fakeRpc(handlers: {
  getAccountInfo?: (...args: unknown[]) => unknown
  getSignatureStatuses?: (...args: unknown[]) => unknown
}) {
  const calls: Call[] = []
  const rpc = Object.fromEntries(
    Object.entries(handlers).map(([method, handler]) => [
      method,
      (...args: unknown[]) => {
        calls.push({ method, args })
        return { send: async () => handler(...args) }
      },
    ]),
  ) as unknown as RevokeRpc
  return { rpc, calls }
}

// A clock that only moves when the code sleeps, so timeouts are deterministic and instant.
function fakeClock() {
  let t = 0
  return { now: () => t, sleep: async (ms: number) => void (t += ms) }
}

const DELEGATED = tokenResponse()
const REVOKED = tokenResponse({ delegateSeed: null, delegatedAmount: 0n })

// ---- submitRevoke ----
test('submitRevoke sends exactly one transaction with exactly the revoke instruction', async () => {
  const { rpc, calls } = fakeRpc({ getAccountInfo: () => DELEGATED })
  const sent: Instruction[][] = []
  const result = await submitRevoke({
    finding: finding(),
    connectedAddress: WALLET,
    rpc,
    sendInstructions: async (instructions) => {
      sent.push(instructions)
      return SIGNATURE
    },
  })
  assert.equal(result.signature, SIGNATURE)
  assert.equal(sent.length, 1, 'one wallet request')
  assert.equal(sent[0].length, 1, 'one instruction')
  assert.deepEqual(sent[0][0], buildRevokeInstruction(finding()))
  assert.deepEqual(calls[0], {
    method: 'getAccountInfo',
    args: [TOKEN_ACCOUNT, { commitment: 'confirmed', encoding: 'base64' }],
  })
})

test('wallet cancellation is SIGNATURE_REJECTED and nothing else happens', async () => {
  const { rpc } = fakeRpc({ getAccountInfo: () => DELEGATED })
  await assert.rejects(
    submitRevoke({
      finding: finding(),
      connectedAddress: WALLET,
      rpc,
      sendInstructions: async () => {
        throw mwaError(PROTOCOL, -3)
      },
    }),
    (e) => e instanceof GuardRailError && e.code === 'SIGNATURE_REJECTED',
  )
})

test('other wallet failures and unreadable signatures are TRANSACTION_FAILED', async () => {
  const { rpc } = fakeRpc({ getAccountInfo: () => DELEGATED })
  const run = (sendInstructions: () => Promise<string>) =>
    submitRevoke({ finding: finding(), connectedAddress: WALLET, rpc, sendInstructions })
  const failed = (e: unknown) => e instanceof GuardRailError && e.code === 'TRANSACTION_FAILED'
  const noWallet = async (): Promise<string> => {
    throw new Error('no wallet')
  }
  await assert.rejects(run(noWallet), failed)
  await assert.rejects(
    run(async () => 'not a signature'),
    failed,
  )
  await assert.rejects(
    run(async () => ''),
    failed,
  )
})

test('failed preconditions never reach the RPC or the wallet', async () => {
  const { rpc, calls } = fakeRpc({ getAccountInfo: () => DELEGATED })
  let sends = 0
  const sendInstructions = async () => {
    sends += 1
    return SIGNATURE
  }
  const attempt = (input: PermissionFinding, connectedAddress: string | undefined) =>
    submitRevoke({ finding: input, connectedAddress, rpc, sendInstructions })
  await assert.rejects(attempt(finding(), OTHER_WALLET))
  await assert.rejects(attempt(finding(), undefined))
  await assert.rejects(attempt(finding({ revocable: false }), WALLET))
  assert.equal(sends, 0)
  assert.equal(calls.length, 0)
})

test('submitRevoke refuses when the on-chain account no longer matches the reviewed finding', async () => {
  const cases: [string, unknown, string][] = [
    ['delegate already removed', REVOKED, 'REVOKE_NOT_SUPPORTED'],
    ['different delegate', tokenResponse({ delegateSeed: 8 }), 'REVOKE_NOT_SUPPORTED'],
    ['different delegated amount', tokenResponse({ delegatedAmount: 1n }), 'REVOKE_NOT_SUPPORTED'],
    ['different mint', tokenResponse({ mintSeed: 9 }), 'REVOKE_NOT_SUPPORTED'],
    ['account now frozen', tokenResponse({ state: AccountState.Frozen }), 'REVOKE_NOT_SUPPORTED'],
    ['account missing', accountResponse(null), 'REVOKE_NOT_SUPPORTED'],
    ['account owner changed', tokenResponse({ ownerSeed: 2 }), 'TOKEN_ACCOUNT_PARSE_FAILED'],
    ['account moved to Token-2022', tokenResponse({}, TOKEN_2022_PROGRAM), 'TOKEN_ACCOUNT_PARSE_FAILED'],
  ]
  for (const [name, response, code] of cases) {
    const { rpc } = fakeRpc({ getAccountInfo: () => response })
    let sends = 0
    await assert.rejects(
      submitRevoke({
        finding: finding(),
        connectedAddress: WALLET,
        rpc,
        sendInstructions: async () => {
          sends += 1
          return SIGNATURE
        },
      }),
      (e) => e instanceof GuardRailError && e.code === code,
      name,
    )
    assert.equal(sends, 0, `${name}: nothing sent`)
  }
})

test('an RPC failure before signing is RPC_UNAVAILABLE and nothing is sent', async () => {
  const { rpc } = fakeRpc({
    getAccountInfo: () => {
      throw new Error('fetch failed')
    },
  })
  await assert.rejects(
    submitRevoke({ finding: finding(), connectedAddress: WALLET, rpc, sendInstructions: async () => SIGNATURE }),
    (e) => e instanceof GuardRailError && e.code === 'RPC_UNAVAILABLE',
  )
})

// ---- confirmation ----
test('confirmSignature waits through pending and processed until confirmed', async () => {
  const responses = [pending, status({ confirmationStatus: 'processed' }), status({ confirmationStatus: 'finalized' })]
  const { rpc, calls } = fakeRpc({ getSignatureStatuses: () => responses.shift() })
  const result = await confirmSignature(rpc, SIGNATURE as Signature, fakeClock())
  assert.deepEqual(result, { status: 'confirmed', slot: 99n })
  assert.equal(calls.length, 3)
  assert.deepEqual(calls[0].args, [[SIGNATURE], { searchTransactionHistory: true }])
})

test('confirmSignature reports on-chain failure and timeout', async () => {
  const failing = fakeRpc({ getSignatureStatuses: () => status({ err: { InstructionError: [0, 'Custom'] } }) })
  const failed = await confirmSignature(failing.rpc, SIGNATURE as Signature, fakeClock())
  assert.deepEqual(failed, { status: 'failed' })

  const never = fakeRpc({ getSignatureStatuses: () => pending })
  const clock = fakeClock()
  const timedOut = await confirmSignature(never.rpc, SIGNATURE as Signature, { ...clock, timeoutMs: 5_000 })
  assert.deepEqual(timedOut, { status: 'unconfirmed' })
  assert.ok(clock.now() >= 5_000)
})

// ---- confirm + verify ----
test('success is reported only after confirmation and a refetch showing no delegate', async () => {
  const { rpc, calls } = fakeRpc({ getSignatureStatuses: () => status(), getAccountInfo: () => REVOKED })
  const outcome = await confirmAndVerifyRevoke(rpc, finding(), SIGNATURE, fakeClock())
  assert.deepEqual(outcome, { status: 'verified', slot: 99n })
  assert.deepEqual(
    calls.map((c) => c.method),
    ['getSignatureStatuses', 'getAccountInfo'],
    'confirmation first, then exactly one refetch',
  )
  const expectedOptions = { commitment: 'confirmed', encoding: 'base64', minContextSlot: 99n }
  assert.deepEqual(calls[1].args, [TOKEN_ACCOUNT, expectedOptions])
})

test('a confirmed transaction with the delegate still present is not success, and retrying can recover', async () => {
  let accountReads = 0
  const { rpc, calls } = fakeRpc({
    getSignatureStatuses: () => status(),
    getAccountInfo: () => (++accountReads === 1 ? DELEGATED : REVOKED),
  })
  const first = await confirmAndVerifyRevoke(rpc, finding(), SIGNATURE, fakeClock())
  assert.equal(first.status, 'not-verified')
  assert.equal(first.status === 'not-verified' && first.error.code, 'VERIFICATION_FAILED')

  const retry = await confirmAndVerifyRevoke(rpc, finding(), SIGNATURE, fakeClock())
  assert.equal(retry.status, 'verified')
  const readOnly = ['getSignatureStatuses', 'getAccountInfo']
  assert.ok(
    calls.every((c) => readOnly.includes(c.method)),
    'retry only reads',
  )
})

test('an unconfirmed transaction is not success and does not read the account', async () => {
  const { rpc, calls } = fakeRpc({ getSignatureStatuses: () => pending, getAccountInfo: () => REVOKED })
  const outcome = await confirmAndVerifyRevoke(rpc, finding(), SIGNATURE, { ...fakeClock(), timeoutMs: 3_000 })
  assert.equal(outcome.status, 'not-verified')
  assert.equal(outcome.status === 'not-verified' && outcome.error.code, 'VERIFICATION_FAILED')
  assert.ok(calls.every((c) => c.method === 'getSignatureStatuses'))
})

test('a transaction that failed on-chain is TRANSACTION_FAILED', async () => {
  const { rpc, calls } = fakeRpc({
    getSignatureStatuses: () => status({ err: { InstructionError: [0, 'Custom'] } }),
    getAccountInfo: () => REVOKED,
  })
  const outcome = await confirmAndVerifyRevoke(rpc, finding(), SIGNATURE, fakeClock())
  assert.equal(outcome.status, 'transaction-failed')
  assert.equal(outcome.status === 'transaction-failed' && outcome.error.code, 'TRANSACTION_FAILED')
  assert.equal(calls.length, 1, 'no refetch is needed to know it failed')
})

test('RPC trouble during confirmation or refetch is a retryable not-verified outcome', async () => {
  const down = () => {
    throw new Error('fetch failed')
  }
  const statusDown = fakeRpc({ getSignatureStatuses: down, getAccountInfo: () => REVOKED })
  const a = await confirmAndVerifyRevoke(statusDown.rpc, finding(), SIGNATURE, fakeClock())
  assert.equal(a.status === 'not-verified' && a.error.code, 'RPC_UNAVAILABLE')

  const readDown = fakeRpc({ getSignatureStatuses: () => status(), getAccountInfo: down })
  const b = await confirmAndVerifyRevoke(readDown.rpc, finding(), SIGNATURE, fakeClock())
  assert.equal(b.status === 'not-verified' && b.error.code, 'RPC_UNAVAILABLE')
})

test('a missing or unreadable account after confirmation is never reported as success', async () => {
  const missing = fakeRpc({ getSignatureStatuses: () => status(), getAccountInfo: () => accountResponse(null) })
  const a = await confirmAndVerifyRevoke(missing.rpc, finding(), SIGNATURE, fakeClock())
  assert.equal(a.status === 'not-verified' && a.error.code, 'VERIFICATION_FAILED')

  const foreignAccount = tokenResponse({ delegateSeed: null }, TOKEN_2022_PROGRAM)
  const foreign = fakeRpc({ getSignatureStatuses: () => status(), getAccountInfo: () => foreignAccount })
  const b = await confirmAndVerifyRevoke(foreign.rpc, finding(), SIGNATURE, fakeClock())
  assert.equal(b.status === 'not-verified' && b.error.code, 'TOKEN_ACCOUNT_PARSE_FAILED')
})

test('a different delegate set after the transaction is still not success', async () => {
  const other = tokenResponse({ delegateSeed: 8 })
  const { rpc } = fakeRpc({ getSignatureStatuses: () => status(), getAccountInfo: () => other })
  const outcome = await confirmAndVerifyRevoke(rpc, finding(), SIGNATURE, fakeClock())
  assert.equal(outcome.status, 'not-verified')
})

// ---- explorer + copy ----
test('explorer links are Devnet-only and reject malformed signatures', () => {
  assert.equal(explorerTransactionUrl(SIGNATURE), `https://explorer.solana.com/tx/${SIGNATURE}?cluster=devnet`)
  const malformed = ['', `${SIGNATURE}/../x`, `${SIGNATURE}?cluster=mainnet-beta`, ` ${SIGNATURE}`, '0'.repeat(88)]
  for (const bad of malformed) {
    assert.equal(explorerTransactionUrl(bad), null, bad)
  }
})

test('error messages use factual language only', async () => {
  const messages: string[] = []
  const collect = (e: unknown) => (e instanceof GuardRailError ? messages.push(e.message) : undefined)
  const staleStates = [REVOKED, accountResponse(null), tokenResponse({ state: AccountState.Frozen })]
  for (const response of staleStates) {
    const { rpc } = fakeRpc({ getAccountInfo: () => response })
    const sendInstructions = async () => SIGNATURE
    await submitRevoke({ finding: finding(), connectedAddress: WALLET, rpc, sendInstructions }).catch(collect)
  }
  for (const input of [finding({ revocable: false }), finding({ tokenProgram: TOKEN_2022_PROGRAM })]) {
    const error = revokePreconditionError(input, WALLET)
    if (error) messages.push(error.message)
  }
  const { rpc } = fakeRpc({ getSignatureStatuses: () => pending })
  const outcome = await confirmAndVerifyRevoke(rpc, finding(), SIGNATURE, { ...fakeClock(), timeoutMs: 1 })
  if (outcome.status !== 'verified') messages.push(outcome.error.message)
  assert.ok(messages.length >= 6)
  for (const word of ['malicious', 'dangerous', 'scam', 'compromised', 'safe', 'risk']) {
    assert.ok(!messages.some((m) => new RegExp(`\\b${word}`, 'i').test(m)), word)
  }
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
