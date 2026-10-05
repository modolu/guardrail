/**
 * Create (or reuse) a real Solana Devnet fixture with an active SPL Token delegate:
 * owner key -> Devnet SOL -> SPL Token mint (6 decimals) -> owner's associated token account -> mint 1000 tokens
 * -> approve delegate for 500 tokens -> refetch and verify, including through GuardRail's scanner.
 *
 * Devnet only. Secret keys live in .local/fixture/ (gitignored) and are never printed.
 * Run: npm run fixture:create
 */
import { generateKeyPairSigner, type Address, type KeyPairSigner } from '@solana/kit'
import { getCreateAccountInstruction } from '@solana-program/system'
import {
  findAssociatedTokenPda,
  getApproveCheckedInstruction,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getInitializeMint2Instruction,
  getMintSize,
  getMintToCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token'
import {
  assertDevnet,
  createDevnetRpc,
  DELEGATE_KEY_PATH,
  DELEGATED_AMOUNT_RAW,
  DEMO_DECIMALS,
  describe,
  ensureFunded,
  explorerUrl,
  FixtureError,
  loadEnv,
  loadOrCreateKeypair,
  METADATA_PATH,
  MINT_AMOUNT_RAW,
  OWNER_KEY_PATH,
  printFixture,
  readFixtureTokenAccount,
  readMetadata,
  relative,
  sendAndConfirm,
  verifyFixture,
  writeMetadata,
  type DevnetRpc,
  type FixtureMetadata,
} from './lib/fixture'

const log = (line: string) => console.log(line)

async function main(): Promise<void> {
  loadEnv()
  const { rpc, label } = createDevnetRpc()
  log(`RPC: ${label}`)
  const genesisHash = await assertDevnet(rpc)
  log('Cluster check: Solana Devnet (genesis hash matches)')

  const owner = await loadOrCreateKeypair(OWNER_KEY_PATH)
  const delegate = await loadOrCreateKeypair(DELEGATE_KEY_PATH)
  log(`${owner.created ? 'Created' : 'Loaded'} owner key ${relative(OWNER_KEY_PATH)} -> ${owner.signer.address}`)
  log(
    `${delegate.created ? 'Created' : 'Loaded'} delegate key ${relative(DELEGATE_KEY_PATH)} -> ${delegate.signer.address}`,
  )
  if (owner.signer.address === delegate.signer.address) {
    throw new FixtureError('Owner and delegate keys are identical. Delete .local/fixture/delegate-keypair.json.')
  }

  const existing = readMetadata()
  let meta: FixtureMetadata
  if (existing && (await tryReuse(rpc, existing, owner.signer, delegate.signer.address, genesisHash))) {
    meta = existing
  } else {
    meta = await createFixture(rpc, owner.signer, delegate.signer.address, genesisHash)
  }

  log('\nVerifying on-chain state (direct token account read + GuardRail scanner)...')
  const report = await verifyFixture(rpc, meta)
  printFixture(meta, log)
  if (!report.ok) {
    throw new FixtureError(`VERIFICATION_FAILED:\n${report.problems.map((p) => `  - ${p}`).join('\n')}`)
  }
  log(`\nVERIFIED at slot ${report.contextSlot}: delegate ${meta.delegate} holds an active approval for`)
  log(`${report.finding?.delegatedAmountDisplay} tokens on ${meta.tokenAccount} (balance 1000).`)
}

/**
 * Returns true if the recorded fixture is still usable (re-approving the delegate if the approval was revoked or
 * changed, e.g. after a revoke demo). Returns false if the fixture no longer exists on-chain and must be recreated.
 */
async function tryReuse(
  rpc: DevnetRpc,
  meta: FixtureMetadata,
  owner: KeyPairSigner,
  delegate: Address,
  genesisHash: string,
): Promise<boolean> {
  if (meta.genesisHash !== genesisHash || meta.owner !== owner.address || meta.delegate !== delegate) {
    throw new FixtureError(
      `${relative(METADATA_PATH)} does not match the current keys/cluster. Delete it to create a new fixture.`,
    )
  }
  log(`\nFound existing fixture metadata; checking token account ${meta.tokenAccount}...`)
  const state = await readFixtureTokenAccount(rpc, meta.tokenAccount as Address)
  if (!state.tokenAccountExists) {
    log('Recorded token account no longer exists on Devnet; creating a new fixture.')
    return false
  }
  if (
    state.programAddress !== TOKEN_PROGRAM_ADDRESS ||
    state.owner !== meta.owner ||
    state.mint !== meta.mint ||
    state.amount !== MINT_AMOUNT_RAW
  ) {
    throw new FixtureError(
      `Fixture token account exists but is not in the expected state (balance raw ${String(state.amount)}, ` +
        `expected ${MINT_AMOUNT_RAW}). Delete ${relative(METADATA_PATH)} to create a fresh mint and token account.`,
    )
  }
  if (state.delegate === meta.delegate && state.delegatedAmount === DELEGATED_AMOUNT_RAW) {
    log('Existing fixture is valid; reusing it (no transactions sent).')
    return true
  }

  log(
    `Delegate approval is not in the expected state (delegate ${state.delegate ?? 'none'}, ` +
      `raw amount ${String(state.delegatedAmount)}); re-approving ${meta.delegate} for 500 tokens.`,
  )
  meta.signatures.approve = await approve(rpc, owner, meta)
  meta.updatedAt = new Date().toISOString()
  writeMetadata(meta)
  return true
}

async function createFixture(
  rpc: DevnetRpc,
  owner: KeyPairSigner,
  delegate: Address,
  genesisHash: string,
): Promise<FixtureMetadata> {
  log('\nCreating a new Devnet fixture.')
  const airdrops = await ensureFunded(rpc, owner.address, log)

  // Fresh mint key each time. Mint authority is the owner, so this key is not needed after creation and is not stored.
  const mint = await generateKeyPairSigner()
  const [tokenAccount] = await findAssociatedTokenPda({
    owner: owner.address,
    mint: mint.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  })
  const mintSpace = BigInt(getMintSize())
  const mintRent = await rpc.getMinimumBalanceForRentExemption(mintSpace, { commitment: 'confirmed' }).send()

  log(`Creating mint ${mint.address}, token account ${tokenAccount}, minting 1000 tokens...`)
  const setup = await sendAndConfirm(rpc, owner, [
    getCreateAccountInstruction({
      payer: owner,
      newAccount: mint,
      lamports: mintRent,
      space: mintSpace,
      programAddress: TOKEN_PROGRAM_ADDRESS,
    }),
    getInitializeMint2Instruction({ mint: mint.address, decimals: DEMO_DECIMALS, mintAuthority: owner.address }),
    await getCreateAssociatedTokenIdempotentInstructionAsync({
      payer: owner,
      ata: tokenAccount,
      owner: owner.address,
      mint: mint.address,
    }),
    getMintToCheckedInstruction({
      mint: mint.address,
      token: tokenAccount,
      mintAuthority: owner,
      amount: MINT_AMOUNT_RAW,
      decimals: DEMO_DECIMALS,
    }),
  ])
  log(`Setup confirmed: ${setup}\n  ${explorerUrl('tx', setup)}`)

  const now = new Date().toISOString()
  const meta: FixtureMetadata = {
    version: 1,
    cluster: 'devnet',
    genesisHash,
    owner: owner.address,
    delegate,
    mint: mint.address,
    tokenAccount,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    decimals: DEMO_DECIMALS,
    mintedAmountRaw: MINT_AMOUNT_RAW.toString(),
    delegatedAmountRaw: DELEGATED_AMOUNT_RAW.toString(),
    signatures: { airdrops, setup, approve: '' },
    createdAt: now,
    updatedAt: now,
  }
  // Persist before approving so a failed approve can be retried by rerunning without creating another mint.
  writeMetadata(meta)

  meta.signatures.approve = await approve(rpc, owner, meta)
  meta.updatedAt = new Date().toISOString()
  writeMetadata(meta)
  log(`Wrote public metadata to ${relative(METADATA_PATH)}`)
  return meta
}

async function approve(rpc: DevnetRpc, owner: KeyPairSigner, meta: FixtureMetadata): Promise<string> {
  log(`Approving delegate ${meta.delegate} for exactly 500 tokens (raw ${DELEGATED_AMOUNT_RAW})...`)
  const signature = await sendAndConfirm(rpc, owner, [
    getApproveCheckedInstruction({
      source: meta.tokenAccount as Address,
      mint: meta.mint as Address,
      delegate: meta.delegate as Address,
      owner,
      amount: DELEGATED_AMOUNT_RAW,
      decimals: DEMO_DECIMALS,
    }),
  ])
  log(`Approve confirmed: ${signature}\n  ${explorerUrl('tx', signature)}`)
  return signature
}

main().catch((error: unknown) => {
  console.error(`\nfixture:create failed.\n${error instanceof FixtureError ? error.message : describe(error)}`)
  process.exitCode = 1
})
