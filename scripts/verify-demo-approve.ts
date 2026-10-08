/**
 * Deterministic checks for the Devnet demo setup approve path. No network, no device, no signing.
 * Covers the EXPO_PUBLIC_DEMO_SETUP gate, the exact ApproveChecked instruction (500 tokens, 6 decimals), how
 * wallet-ui's Kit compiles it, every pre-signing refusal, wallet cancellation, and post-approve verification.
 *
 * Run: npm run verify:demo-approve
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import {
  AccountRole,
  getAddressEncoder,
  getBase58Decoder,
  getProgramDerivedAddress,
  type Address,
  type Blockhash,
  type Instruction,
} from '@solana/kit'
import { AccountState, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token'
import {
  assertDemoApproveReady,
  buildDemoApproveInstruction,
  confirmAndVerifyDemoApprove,
  DEMO_APPROVE_AMOUNT_RAW,
  DEMO_APPROVE_DECIMALS,
  demoApprovePreconditionError,
  DEVNET_GENESIS_HASH,
  findDemoTokenAccount,
  parseDemoSetupConfig,
  submitDemoApprove,
  type DemoApproveRpc,
  type DemoApproveTarget,
  type DemoSetupConfig,
} from '../src/solana/demoApprove'
import { GuardRailError } from '../src/types/errors'
import { DEVNET_GENESIS_HASH as FIXTURE_DEVNET_GENESIS_HASH } from './lib/fixture'
import { addr, mintAccountBytes, tokenAccountBytes, type TokenLayout } from './lib/token-bytes'

const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PE1qXd5n6a5AeT2'
const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL' as Address
const MAINNET_GENESIS_HASH = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'
const WALLET = addr(1)
const MINT = addr(3)
const DELEGATE = addr(4)
const SIGNATURE = getBase58Decoder().decode(new Uint8Array(64).fill(7))
const ROOT = process.cwd()

const ENABLED: DemoSetupConfig = { status: 'enabled', mint: MINT, delegate: DELEGATE }

const tests: [string, () => void | Promise<void>][] = []
const test = (name: string, fn: () => void | Promise<void>) => tests.push([name, fn])

let tokenAccountAddress: Address
async function target(): Promise<DemoApproveTarget> {
  tokenAccountAddress ??= await findDemoTokenAccount(WALLET, MINT)
  return { owner: WALLET, tokenAccount: tokenAccountAddress, mint: MINT, delegate: DELEGATE }
}

// ---- gate ----
test('demo setup is disabled unless EXPO_PUBLIC_DEMO_SETUP is exactly 1', () => {
  const values = { mint: MINT, delegate: DELEGATE }
  for (const setup of [undefined, '', '0', 'true', 'yes', '11', 'on']) {
    assert.deepEqual(parseDemoSetupConfig({ ...values, setup }), { status: 'disabled' }, String(setup))
  }
  assert.deepEqual(parseDemoSetupConfig({}), { status: 'disabled' }, 'a normal build sets nothing')
  assert.deepEqual(parseDemoSetupConfig({ ...values, setup: '1' }), ENABLED)
  assert.deepEqual(parseDemoSetupConfig({ setup: ' 1 ', mint: ` ${MINT}`, delegate: `${DELEGATE} ` }), ENABLED)
})

test('an enabled gate with missing, invalid or identical addresses is invalid, never enabled', () => {
  const cases: [string, { mint?: string; delegate?: string }][] = [
    ['no mint', { delegate: DELEGATE }],
    ['no delegate', { mint: MINT }],
    ['bad mint', { mint: 'not-an-address', delegate: DELEGATE }],
    ['bad delegate', { mint: MINT, delegate: '0OIl' }],
    ['identical', { mint: MINT, delegate: MINT }],
  ]
  for (const [name, env] of cases) {
    assert.equal(parseDemoSetupConfig({ setup: '1', ...env }).status, 'invalid', name)
  }
})

test('the app reads the gate with literal EXPO_PUBLIC_* access and renders nothing when it is disabled', () => {
  const config = readFileSync(path.join(ROOT, 'constants', 'app-config.ts'), 'utf8')
  for (const name of ['EXPO_PUBLIC_DEMO_SETUP', 'EXPO_PUBLIC_DEMO_MINT', 'EXPO_PUBLIC_DEMO_DELEGATE']) {
    assert.ok(config.includes(`process.env.${name}`), name)
  }
  const panel = readFileSync(path.join(ROOT, 'src', 'components', 'DemoSetupPanel.tsx'), 'utf8')
  assert.match(panel, /if \(demoSetupConfig\.status === 'disabled'\) \{\s*return null\s*\}/)
})

test('the in-app Devnet genesis hash matches the fixture scripts', () => {
  assert.equal(DEVNET_GENESIS_HASH, FIXTURE_DEVNET_GENESIS_HASH)
})

// ---- instruction ----
test('the approve amount is exactly 500 tokens at 6 decimals', () => {
  assert.equal(DEMO_APPROVE_DECIMALS, 6)
  assert.equal(DEMO_APPROVE_AMOUNT_RAW, 500_000_000n)
})

test("the token account is the wallet's associated token account for the demo mint", async () => {
  const [expected] = await getProgramDerivedAddress({
    programAddress: ATA_PROGRAM,
    seeds: [WALLET, TOKEN_PROGRAM_ADDRESS, MINT].map((a) => getAddressEncoder().encode(a)),
  })
  assert.equal(await findDemoTokenAccount(WALLET, MINT), expected)
})

test('the instruction is SPL Token ApproveChecked for exactly 500 tokens with 6 decimals and nothing else', async () => {
  const t = await target()
  const instruction = buildDemoApproveInstruction(t)
  assert.equal(instruction.programAddress, TOKEN_PROGRAM_ADDRESS)
  // discriminator 13, amount u64 LE 500_000_000 (0x1DCD6500), decimals u8 6
  assert.deepEqual(Array.from(instruction.data), [13, 0x00, 0x65, 0xcd, 0x1d, 0, 0, 0, 0, 6])
  assert.deepEqual(
    instruction.accounts.map((a) => a.address),
    [t.tokenAccount, MINT, DELEGATE, WALLET],
  )
  assert.equal(instruction.accounts[0].role, AccountRole.WRITABLE)
  assert.equal(instruction.accounts[1].role, AccountRole.READONLY)
  assert.equal(instruction.accounts[2].role, AccountRole.READONLY)
  assert.ok([AccountRole.READONLY, AccountRole.READONLY_SIGNER].includes(instruction.accounts[3].role))
})

test("wallet-ui's Kit compiles the approve into a one-instruction message signed only by the owner", async () => {
  const walletRequire = createRequire(require.resolve('@wallet-ui/react-native-kit'))
  const kit = walletRequire('@solana/kit') as typeof import('@solana/kit')
  const t = await target()
  const lifetime = { blockhash: addr(9) as unknown as Blockhash, lastValidBlockHeight: 100n }
  const message = kit.pipe(
    kit.createTransactionMessage({ version: 0 }),
    (m) => kit.appendTransactionMessageInstructions([buildDemoApproveInstruction(t)], m),
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
  assert.equal(compiled.staticAccounts[0], WALLET, 'the owner is the only signer and fee payer')
  assert.equal(compiled.instructions.length, 1, 'exactly one instruction')
  const [ix] = compiled.instructions
  assert.equal(compiled.staticAccounts[ix.programAddressIndex], TOKEN_PROGRAM_ADDRESS)
  const accounts = (ix.accountIndices ?? []).map((index) => compiled.staticAccounts[index])
  assert.deepEqual(accounts, [t.tokenAccount, MINT, DELEGATE, WALLET])
  assert.equal(compiled.staticAccounts.length, 5, 'owner, token account, mint, delegate, token program only')
})

// ---- fake RPC ----
interface Call {
  method: string
  args: unknown[]
}
const b64 = (data: Uint8Array) => Buffer.from(data).toString('base64')
const rpcAccount = (data: Uint8Array, owner: string = TOKEN_PROGRAM_ADDRESS) => ({
  context: { slot: 100n },
  value: { data: [b64(data), 'base64'], executable: false, lamports: 2_039_280n, owner, space: BigInt(data.length) },
})
const missing = { context: { slot: 100n }, value: null }
const READY_LAYOUT: TokenLayout = { delegateSeed: null, delegatedAmount: 0n }
const tokenResponse = (layout: TokenLayout = READY_LAYOUT, owner?: string) =>
  rpcAccount(tokenAccountBytes(layout), owner)
const mintResponse = (decimals = 6, owner?: string) => rpcAccount(mintAccountBytes({ decimals }), owner)
const APPROVED = tokenResponse({ delegateSeed: 4, delegatedAmount: DEMO_APPROVE_AMOUNT_RAW })
const status = (overrides: Record<string, unknown> = {}) => ({
  context: { slot: 100n },
  value: [{ slot: 99n, confirmations: null, err: null, confirmationStatus: 'confirmed', ...overrides }],
})

function fakeRpc(handlers: {
  getGenesisHash?: () => unknown
  mint?: () => unknown
  token?: () => unknown
  getSignatureStatuses?: () => unknown
}) {
  const calls: Call[] = []
  const record =
    (method: string, handler: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) => {
      calls.push({ method, args })
      return { send: async () => handler(...args) }
    }
  const rpc = {
    getGenesisHash: record('getGenesisHash', handlers.getGenesisHash ?? (() => DEVNET_GENESIS_HASH)),
    getAccountInfo: record('getAccountInfo', (address) =>
      address === MINT ? (handlers.mint ?? (() => mintResponse()))() : (handlers.token ?? (() => tokenResponse()))(),
    ),
    getSignatureStatuses: record('getSignatureStatuses', handlers.getSignatureStatuses ?? (() => status())),
  } as unknown as DemoApproveRpc
  return { rpc, calls }
}

function fakeClock() {
  let t = 0
  return { now: () => t, sleep: async (ms: number) => void (t += ms) }
}

function mwaError(name: string, code: unknown): Error {
  return Object.assign(new Error(`mwa ${String(code)}`), { name, code })
}

async function submit(
  rpc: DemoApproveRpc,
  overrides: Partial<Parameters<typeof submitDemoApprove>[0]> = {},
): Promise<{ sent: Instruction[][]; result: Promise<unknown> }> {
  const sent: Instruction[][] = []
  const result = submitDemoApprove({
    config: ENABLED,
    connectedAddress: WALLET,
    chain: 'solana:devnet',
    rpc,
    sendInstructions: async (instructions) => {
      sent.push(instructions)
      return SIGNATURE
    },
    ...overrides,
  })
  return { sent, result }
}

const code = (expected: string) => (e: unknown) => e instanceof GuardRailError && e.code === expected

// ---- preconditions ----
test('preconditions refuse a disabled gate, no wallet, a non-Devnet chain, or the delegate as owner', () => {
  const cases: [string, DemoSetupConfig, string | undefined, string, string][] = [
    ['gate disabled', { status: 'disabled' }, WALLET, 'solana:devnet', 'TRANSACTION_FAILED'],
    ['gate invalid', { status: 'invalid', reason: 'x' }, WALLET, 'solana:devnet', 'TRANSACTION_FAILED'],
    ['no wallet', ENABLED, undefined, 'solana:devnet', 'WALLET_NOT_CONNECTED'],
    ['mainnet chain', ENABLED, WALLET, 'solana:mainnet', 'TRANSACTION_FAILED'],
    ['wallet is the delegate', ENABLED, DELEGATE, 'solana:devnet', 'TRANSACTION_FAILED'],
  ]
  for (const [name, config, connected, chain, expected] of cases) {
    assert.equal(demoApprovePreconditionError(config, connected, chain)?.code, expected, name)
  }
  assert.equal(demoApprovePreconditionError(ENABLED, WALLET, 'solana:devnet'), null)
})

test('failed preconditions never reach the RPC or the wallet', async () => {
  const cases: Partial<Parameters<typeof submitDemoApprove>[0]>[] = [
    { config: { status: 'disabled' } },
    { connectedAddress: undefined },
    { chain: 'solana:mainnet' },
    { connectedAddress: DELEGATE },
  ]
  for (const overrides of cases) {
    const { rpc, calls } = fakeRpc({})
    const { sent, result } = await submit(rpc, overrides)
    await assert.rejects(result, (e) => e instanceof GuardRailError)
    assert.equal(calls.length, 0, JSON.stringify(overrides))
    assert.equal(sent.length, 0)
  }
})

// ---- submit ----
test('submitDemoApprove checks Devnet, mint and token account, then sends exactly one ApproveChecked', async () => {
  const { rpc, calls } = fakeRpc({})
  const { sent, result } = await submit(rpc)
  const { signature, target: sentTarget } = (await result) as { signature: string; target: DemoApproveTarget }
  assert.equal(signature, SIGNATURE)
  assert.deepEqual(sentTarget, await target())
  assert.equal(sent.length, 1, 'one wallet request')
  assert.equal(sent[0].length, 1, 'one instruction')
  assert.deepEqual(sent[0][0], buildDemoApproveInstruction(await target()))
  assert.deepEqual(
    calls.map((c) => [c.method, c.args[0]]),
    [
      ['getGenesisHash', undefined],
      ['getAccountInfo', MINT],
      ['getAccountInfo', tokenAccountAddress],
    ],
  )
})

test('nothing is sent unless Devnet, the mint and the token account all match', async () => {
  const cases: [string, Parameters<typeof fakeRpc>[0], string][] = [
    ['mainnet genesis hash', { getGenesisHash: () => MAINNET_GENESIS_HASH }, 'TRANSACTION_FAILED'],
    ['mint has 9 decimals', { mint: () => mintResponse(9) }, 'TOKEN_ACCOUNT_PARSE_FAILED'],
    ['mint missing', { mint: () => missing }, 'TOKEN_ACCOUNT_PARSE_FAILED'],
    ['mint on Token-2022', { mint: () => mintResponse(6, TOKEN_2022_PROGRAM) }, 'TOKEN_ACCOUNT_PARSE_FAILED'],
    ['token account missing', { token: () => missing }, 'TOKEN_ACCOUNT_PARSE_FAILED'],
    ['already has a delegate', { token: () => APPROVED }, 'TRANSACTION_FAILED'],
    ['other delegate', { token: () => tokenResponse({ delegateSeed: 8 }) }, 'TRANSACTION_FAILED'],
    [
      'different owner',
      { token: () => tokenResponse({ ...READY_LAYOUT, ownerSeed: 2 }) },
      'TOKEN_ACCOUNT_PARSE_FAILED',
    ],
    ['different mint', { token: () => tokenResponse({ ...READY_LAYOUT, mintSeed: 9 }) }, 'TOKEN_ACCOUNT_PARSE_FAILED'],
    ['frozen', { token: () => tokenResponse({ ...READY_LAYOUT, state: AccountState.Frozen }) }, 'TRANSACTION_FAILED'],
    [
      'Token-2022 account',
      { token: () => tokenResponse(READY_LAYOUT, TOKEN_2022_PROGRAM) },
      'TOKEN_ACCOUNT_PARSE_FAILED',
    ],
  ]
  for (const [name, handlers, expected] of cases) {
    const { rpc } = fakeRpc(handlers)
    const { sent, result } = await submit(rpc)
    await assert.rejects(result, code(expected), name)
    assert.equal(sent.length, 0, `${name}: nothing sent`)
  }
})

test('an RPC failure before signing is RPC_UNAVAILABLE and nothing is sent', async () => {
  const down = () => {
    throw new Error('fetch failed')
  }
  for (const handlers of [{ getGenesisHash: down }, { mint: down }, { token: down }]) {
    const { rpc } = fakeRpc(handlers)
    const { sent, result } = await submit(rpc)
    await assert.rejects(result, code('RPC_UNAVAILABLE'))
    assert.equal(sent.length, 0)
  }
})

test('wallet cancellation is SIGNATURE_REJECTED; other wallet failures are TRANSACTION_FAILED', async () => {
  const { rpc } = fakeRpc({})
  const reject = async (): Promise<string> => {
    throw mwaError('SolanaMobileWalletAdapterProtocolError', -3)
  }
  await assert.rejects((await submit(rpc, { sendInstructions: reject })).result, code('SIGNATURE_REJECTED'))
  const fail = async (): Promise<string> => {
    throw new Error('no wallet')
  }
  await assert.rejects((await submit(rpc, { sendInstructions: fail })).result, code('TRANSACTION_FAILED'))
  await assert.rejects(
    (await submit(rpc, { sendInstructions: async () => 'not a signature' })).result,
    code('TRANSACTION_FAILED'),
  )
})

test('assertDemoApproveReady passes for the expected ready state', async () => {
  const { rpc } = fakeRpc({})
  await assert.doesNotReject(assertDemoApproveReady(rpc, await target()))
})

// ---- confirm + verify ----
test('success requires confirmation and a refetch showing exactly the demo delegate for exactly 500 tokens', async () => {
  const { rpc, calls } = fakeRpc({ token: () => APPROVED })
  const outcome = await confirmAndVerifyDemoApprove(rpc, await target(), SIGNATURE, fakeClock())
  assert.deepEqual(outcome, { status: 'verified', slot: 99n })
  assert.deepEqual(
    calls.map((c) => c.method),
    ['getSignatureStatuses', 'getAccountInfo'],
  )
  assert.deepEqual(calls[1].args, [
    tokenAccountAddress,
    { commitment: 'confirmed', encoding: 'base64', minContextSlot: 99n },
  ])
})

test('a confirmed transaction without the exact expected delegate is not success', async () => {
  const states: [string, unknown][] = [
    ['no delegate', tokenResponse()],
    ['other delegate', tokenResponse({ delegateSeed: 8, delegatedAmount: DEMO_APPROVE_AMOUNT_RAW })],
    ['wrong amount', tokenResponse({ delegateSeed: 4, delegatedAmount: 500n })],
    ['missing', missing],
  ]
  for (const [name, response] of states) {
    const { rpc } = fakeRpc({ token: () => response })
    const outcome = await confirmAndVerifyDemoApprove(rpc, await target(), SIGNATURE, fakeClock())
    assert.equal(outcome.status, 'not-verified', name)
  }
})

test('a failed or unconfirmed transaction is never success', async () => {
  const failing = fakeRpc({ token: () => APPROVED, getSignatureStatuses: () => status({ err: { Custom: 1 } }) })
  const failed = await confirmAndVerifyDemoApprove(failing.rpc, await target(), SIGNATURE, fakeClock())
  assert.equal(failed.status, 'transaction-failed')

  const pending = { context: { slot: 100n }, value: [null] }
  const never = fakeRpc({ token: () => APPROVED, getSignatureStatuses: () => pending })
  const clock = { ...fakeClock(), timeoutMs: 3_000 }
  const unconfirmed = await confirmAndVerifyDemoApprove(never.rpc, await target(), SIGNATURE, clock)
  assert.equal(unconfirmed.status === 'not-verified' && unconfirmed.error.code, 'VERIFICATION_FAILED')
  assert.ok(never.calls.every((c) => c.method === 'getSignatureStatuses'))
})

test('messages use factual language only', async () => {
  const messages: string[] = []
  const collect = (e: unknown) => (e instanceof GuardRailError ? messages.push(e.message) : undefined)
  for (const handlers of [
    { getGenesisHash: () => MAINNET_GENESIS_HASH },
    { token: () => APPROVED },
    { token: () => missing },
  ]) {
    const { rpc } = fakeRpc(handlers)
    await (await submit(rpc)).result.catch(collect)
  }
  const { rpc } = fakeRpc({ token: () => tokenResponse() })
  const outcome = await confirmAndVerifyDemoApprove(rpc, await target(), SIGNATURE, fakeClock())
  if (outcome.status !== 'verified') messages.push(outcome.error.message)
  const invalid = parseDemoSetupConfig({ setup: '1' })
  if (invalid.status === 'invalid') messages.push(invalid.reason)
  assert.ok(messages.length >= 5)
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
