/**
 * Deterministic end-to-end check of the GuardRail core flow against an in-memory fake Devnet ledger:
 * scan -> PermissionFinding -> revoke preconditions -> fresh re-check -> wallet signs one Revoke -> confirmation ->
 * re-read of the exact token account -> rescan. No network, no device, no signing keys.
 *
 * The fake wallet compiles what it is given with the @solana/kit copy bundled in @wallet-ui/react-native-kit (the one
 * the real `sendTransactions` uses), refuses anything that is not a single SPL Token Revoke signed only by the owner,
 * and applies Revoke to the ledger bytes itself, independent of GuardRail's parser.
 *
 * Run: npm run verify:flow
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { getBase58Decoder, type Blockhash, type Instruction } from '@solana/kit'
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token'
import { PERMISSION_EXPLANATIONS } from '../src/constants/explanations'
import { confirmAndVerifyRevoke, revokePreconditionError, submitRevoke, type RevokeRpc } from '../src/solana/revoke'
import { scanPermissions, type PermissionScanRpc } from '../src/solana/scanPermissions'
import { GuardRailError } from '../src/types/errors'
import { addr, tokenAccountBytes } from './lib/token-bytes'

const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PE1qXd5n6a5AeT2'
const WALLET = addr(1)
const MINT = addr(3)
const DELEGATE = addr(4)
const DELEGATED_ACCOUNT = addr(5)
const PLAIN_ACCOUNT = addr(6)
const TOKEN_2022_ACCOUNT = addr(7)
const OTHER_DELEGATE = addr(8)

// Same shape as the Devnet fixture (docs/DEMO.md): 6 decimals, 1000 tokens, 500 delegated.
const DECIMALS = 6
const BALANCE = 1_000_000_000n
const DELEGATED = 500_000_000n

// SPL Token Mint: mint_authority(COption<Pubkey>) supply(u64) decimals(u8) is_initialized(bool)
// freeze_authority(COption<Pubkey>) = 82 bytes.
function mintBytes(decimals: number): Uint8Array {
  const data = new Uint8Array(82)
  const view = new DataView(data.buffer)
  view.setUint32(0, 0, true)
  view.setBigUint64(36, BALANCE, true)
  data[44] = decimals
  data[45] = 1
  view.setUint32(46, 0, true)
  return data
}

const b64 = (data: Uint8Array) => Buffer.from(data).toString('base64')
const bytesEqual = (a: Uint8Array, b: Uint8Array) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0

interface LedgerAccount {
  programOwner: string
  data: Uint8Array
}

type TxStatus = { slot: bigint; err: unknown; polls: number }

/** In-memory ledger with just enough RPC surface for scan, revoke and verification. */
function createLedger() {
  let slot = 1000n
  const accounts = new Map<string, LedgerAccount>([
    [MINT, { programOwner: TOKEN_PROGRAM_ADDRESS, data: mintBytes(DECIMALS) }],
    [
      DELEGATED_ACCOUNT,
      {
        programOwner: TOKEN_PROGRAM_ADDRESS,
        data: tokenAccountBytes({ amount: BALANCE, delegateSeed: 4, delegatedAmount: DELEGATED }),
      },
    ],
    [
      PLAIN_ACCOUNT,
      { programOwner: TOKEN_PROGRAM_ADDRESS, data: tokenAccountBytes({ delegateSeed: null, delegatedAmount: 0n }) },
    ],
    // Same layout under Token-2022: the scanner must not even request it.
    [TOKEN_2022_ACCOUNT, { programOwner: TOKEN_2022_PROGRAM, data: tokenAccountBytes() }],
  ])
  const statuses = new Map<string, TxStatus>()
  const writes: string[] = []

  const rpcAccount = (account: LedgerAccount) => ({
    data: [b64(account.data), 'base64'],
    executable: false,
    lamports: 2_039_280n,
    owner: account.programOwner,
    space: BigInt(account.data.length),
  })
  const requireSlot = (options: { minContextSlot?: bigint } | undefined) => {
    if (options?.minContextSlot !== undefined && options.minContextSlot > slot) {
      throw new Error('Minimum context slot has not been reached')
    }
  }
  const call =
    <A extends unknown[]>(handler: (...args: A) => unknown) =>
    (...args: A) => ({ send: async () => handler(...args) })

  const rpc = {
    getTokenAccountsByOwner: call((owner: string, filter: { programId: string }) => ({
      context: { slot },
      value: [...accounts]
        .filter(
          ([, a]) =>
            a.programOwner === filter.programId &&
            a.data.length === 165 &&
            getBase58Decoder().decode(a.data.subarray(32, 64)) === owner,
        )
        .map(([pubkey, a]) => ({ pubkey, account: rpcAccount(a) })),
    })),
    getMultipleAccounts: call((addresses: string[], options?: { minContextSlot?: bigint }) => {
      requireSlot(options)
      return {
        context: { slot },
        value: addresses.map((a) => (accounts.has(a) ? rpcAccount(accounts.get(a)!) : null)),
      }
    }),
    getAccountInfo: call((address: string, options?: { minContextSlot?: bigint }) => {
      requireSlot(options)
      const account = accounts.get(address)
      return { context: { slot }, value: account ? rpcAccount(account) : null }
    }),
    // Each signature is 'processed' on its first poll and 'confirmed' afterwards, like a real cluster catching up.
    getSignatureStatuses: call((signatures: string[]) => ({
      context: { slot },
      value: signatures.map((s) => {
        const tx = statuses.get(s)
        if (!tx) return null
        tx.polls += 1
        return {
          slot: tx.slot,
          confirmations: null,
          err: tx.err,
          confirmationStatus: tx.polls > 1 ? 'confirmed' : 'processed',
        }
      }),
    })),
  }

  return {
    scanRpc: rpc as unknown as PermissionScanRpc,
    revokeRpc: rpc as unknown as RevokeRpc,
    accounts,
    statuses,
    writes,
    get slot() {
      return slot
    },
    advance() {
      slot += 1n
      return slot
    },
  }
}

type Ledger = ReturnType<typeof createLedger>

/**
 * Fake MWA wallet. Compiles with wallet-ui's Kit exactly as `sendTransactions` would, enforces that the message is a
 * single SPL Token Revoke signed only by the owner, then applies Revoke semantics to the ledger bytes.
 */
function createWallet(ledger: Ledger, options: { decline?: boolean; failOnChain?: boolean } = {}) {
  const walletRequire = createRequire(require.resolve('@wallet-ui/react-native-kit'))
  const kit = walletRequire('@solana/kit') as typeof import('@solana/kit')
  let requests = 0
  let counter = 0

  const sendInstructions = async (instructions: Instruction[]): Promise<string> => {
    requests += 1
    if (options.decline) {
      throw Object.assign(new Error('User declined'), { name: 'SolanaMobileWalletAdapterProtocolError', code: -3 })
    }
    const message = kit.pipe(
      kit.createTransactionMessage({ version: 0 }),
      (m) => kit.appendTransactionMessageInstructions(instructions, m),
      (m) => kit.setTransactionMessageFeePayer(WALLET, m),
      (m) =>
        kit.setTransactionMessageLifetimeUsingBlockhash(
          { blockhash: addr(9) as unknown as Blockhash, lastValidBlockHeight: 100n },
          m,
        ),
    )
    const compiled = kit.compileTransactionMessage(message) as unknown as {
      header: { numSignerAccounts: number }
      staticAccounts: string[]
      instructions: { programAddressIndex: number; accountIndices?: number[]; data?: Uint8Array }[]
    }
    assert.equal(compiled.header.numSignerAccounts, 1, 'wallet: exactly one signer')
    assert.equal(compiled.staticAccounts[0], WALLET, 'wallet: owner is the only signer')
    assert.equal(compiled.instructions.length, 1, 'wallet: exactly one instruction')
    const [ix] = compiled.instructions
    const [source, owner, ...extra] = (ix.accountIndices ?? []).map((i) => compiled.staticAccounts[i])
    assert.equal(compiled.staticAccounts[ix.programAddressIndex], TOKEN_PROGRAM_ADDRESS, 'wallet: SPL Token program')
    assert.deepEqual(Array.from(ix.data ?? []), [5], 'wallet: Revoke discriminator only')
    assert.equal(extra.length, 0, 'wallet: no extra accounts')

    counter += 1
    const signature = getBase58Decoder().decode(new Uint8Array(64).fill(counter))
    const landedSlot = ledger.advance()
    ledger.statuses.set(signature, { slot: landedSlot, err: null, polls: 0 })
    if (options.failOnChain) {
      ledger.statuses.get(signature)!.err = { InstructionError: [0, { Custom: 0 }] }
      return signature
    }

    // SPL Token process_revoke, re-implemented on raw bytes: source must be an initialized (not frozen) account
    // owned by the signer; delegate becomes None and delegated_amount 0. Nothing else changes.
    const account = ledger.accounts.get(source)
    assert.ok(account && account.programOwner === TOKEN_PROGRAM_ADDRESS, 'ledger: source is an SPL Token account')
    assert.equal(getBase58Decoder().decode(account.data.subarray(32, 64)), owner, 'ledger: owner matches')
    assert.equal(owner, compiled.staticAccounts[0], 'ledger: owner signed')
    assert.equal(account.data[108], 1, 'ledger: account initialized and not frozen')
    const next = new Uint8Array(account.data)
    next.fill(0, 72, 108) // delegate: COption tag + pubkey
    new DataView(next.buffer).setBigUint64(121, 0n, true) // delegated_amount
    ledger.accounts.set(source, { ...account, data: next })
    ledger.writes.push(source)
    return signature
  }

  return {
    sendInstructions,
    get requests() {
      return requests
    },
  }
}

const tests: [string, () => Promise<void>][] = []
const test = (name: string, fn: () => Promise<void>) => tests.push([name, fn])

const instantClock = () => {
  let t = 0
  return { now: () => t, sleep: async (ms: number) => void (t += ms) }
}

test('scan -> finding -> revoke -> confirm -> verify -> rescan, end to end', async () => {
  const ledger = createLedger()
  const untouched = new Map([...ledger.accounts].filter(([a]) => a !== DELEGATED_ACCOUNT))
  const before = ledger.accounts.get(DELEGATED_ACCOUNT)!.data

  const scan = await scanPermissions(ledger.scanRpc, WALLET)
  assert.equal(scan.scannedAccountCount, 2, 'only standard SPL Token accounts are scanned')
  assert.equal(scan.skippedAccountCount, 0)
  assert.equal(scan.findings.length, 1)
  const [finding] = scan.findings
  assert.deepEqual(finding, {
    id: DELEGATED_ACCOUNT,
    type: 'SPL_TOKEN_DELEGATE',
    tokenAccount: DELEGATED_ACCOUNT,
    mint: MINT,
    owner: WALLET,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    delegate: DELEGATE,
    delegatedAmountRaw: '500000000',
    decimals: 6,
    delegatedAmountDisplay: '500',
    revocable: true,
    explanationCode: 'SPL_TOKEN_DELEGATE_ACTIVE',
  })
  assert.match(PERMISSION_EXPLANATIONS[finding.explanationCode], /transfer or burn up to the delegated amount/)
  assert.equal(revokePreconditionError(finding, WALLET), null)

  const wallet = createWallet(ledger)
  const { signature } = await submitRevoke({
    finding,
    connectedAddress: WALLET,
    rpc: ledger.revokeRpc,
    sendInstructions: wallet.sendInstructions,
  })
  assert.equal(wallet.requests, 1, 'one wallet request')
  assert.deepEqual(ledger.writes, [DELEGATED_ACCOUNT], 'only the reviewed token account was written')

  const outcome = await confirmAndVerifyRevoke(ledger.revokeRpc, finding, signature, instantClock())
  assert.deepEqual(outcome, { status: 'verified', slot: ledger.statuses.get(signature)!.slot })

  // Revoke changed only the delegate fields of that account: balance, mint, owner, state are as before.
  const after = ledger.accounts.get(DELEGATED_ACCOUNT)!.data
  assert.ok(bytesEqual(after.subarray(0, 72), before.subarray(0, 72)), 'mint, owner, amount unchanged')
  assert.ok(bytesEqual(after.subarray(108, 121), before.subarray(108, 121)), 'state, is_native unchanged')
  assert.ok(bytesEqual(after.subarray(129), before.subarray(129)), 'close authority unchanged')
  for (const [address, account] of untouched) {
    assert.equal(ledger.accounts.get(address), account, `${address} untouched`)
  }

  const rescan = await scanPermissions(ledger.scanRpc, WALLET)
  assert.equal(rescan.findings.length, 0, 'the delegate is gone on rescan')
  assert.equal(rescan.scannedAccountCount, 2)
})

test('wallet decline leaves the chain unchanged and the finding still present', async () => {
  const ledger = createLedger()
  const [finding] = (await scanPermissions(ledger.scanRpc, WALLET)).findings
  const wallet = createWallet(ledger, { decline: true })
  await assert.rejects(
    submitRevoke({
      finding,
      connectedAddress: WALLET,
      rpc: ledger.revokeRpc,
      sendInstructions: wallet.sendInstructions,
    }),
    (e) => e instanceof GuardRailError && e.code === 'SIGNATURE_REJECTED',
  )
  assert.deepEqual(ledger.writes, [])
  assert.equal(ledger.statuses.size, 0)
  assert.equal((await scanPermissions(ledger.scanRpc, WALLET)).findings.length, 1)
})

test('a delegate changed after the scan is never sent to the wallet', async () => {
  const ledger = createLedger()
  const [finding] = (await scanPermissions(ledger.scanRpc, WALLET)).findings
  // Someone re-approves a different delegate between scan and approval.
  const account = ledger.accounts.get(DELEGATED_ACCOUNT)!
  ledger.accounts.set(DELEGATED_ACCOUNT, {
    ...account,
    data: tokenAccountBytes({ amount: BALANCE, delegateSeed: 8, delegatedAmount: DELEGATED }),
  })
  const wallet = createWallet(ledger)
  await assert.rejects(
    submitRevoke({
      finding,
      connectedAddress: WALLET,
      rpc: ledger.revokeRpc,
      sendInstructions: wallet.sendInstructions,
    }),
    (e) => e instanceof GuardRailError && e.code === 'REVOKE_NOT_SUPPORTED',
  )
  assert.equal(wallet.requests, 0, 'the wallet was never asked')
  const [current] = (await scanPermissions(ledger.scanRpc, WALLET)).findings
  assert.equal(current.delegate, OTHER_DELEGATE)
})

test('a transaction that fails on-chain is reported as failed and the delegate remains', async () => {
  const ledger = createLedger()
  const [finding] = (await scanPermissions(ledger.scanRpc, WALLET)).findings
  const wallet = createWallet(ledger, { failOnChain: true })
  const { signature } = await submitRevoke({
    finding,
    connectedAddress: WALLET,
    rpc: ledger.revokeRpc,
    sendInstructions: wallet.sendInstructions,
  })
  const outcome = await confirmAndVerifyRevoke(ledger.revokeRpc, finding, signature, instantClock())
  assert.equal(outcome.status, 'transaction-failed')
  assert.equal((await scanPermissions(ledger.scanRpc, WALLET)).findings.length, 1)
})

test('a signature the cluster never sees is not success, and retrying stays read-only', async () => {
  const ledger = createLedger()
  const [finding] = (await scanPermissions(ledger.scanRpc, WALLET)).findings
  const unknownSignature = getBase58Decoder().decode(new Uint8Array(64).fill(99))
  const first = await confirmAndVerifyRevoke(ledger.revokeRpc, finding, unknownSignature, instantClock())
  assert.equal(first.status, 'not-verified')
  assert.equal(first.status === 'not-verified' && first.error.code, 'VERIFICATION_FAILED')
  const retry = await confirmAndVerifyRevoke(ledger.revokeRpc, finding, unknownSignature, instantClock())
  assert.equal(retry.status, 'not-verified')
  assert.deepEqual(ledger.writes, [], 'verification never writes')
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
