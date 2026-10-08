/**
 * Create (or reuse) a Devnet demo token account owned by a real Android wallet, for the in-app demo approve:
 * local payer -> SPL Token mint (6 decimals, payer is mint authority) -> the wallet's associated token account
 * -> mint 1000 tokens -> top up the wallet with a little Devnet SOL for fees if needed -> print the app env values.
 *
 * It sends NO approval: the wallet signs ApproveChecked itself in the app's Devnet demo setup panel. The wallet's
 * private key is never needed. Devnet only. Local keys stay in .local/fixture/ and are never printed.
 * Run: FIXTURE_WALLET_OWNER=<wallet address> npm run fixture:wallet:create
 */
import { generateKeyPairSigner, type Address, type KeyPairSigner } from '@solana/kit'
import { getCreateAccountInstruction, getTransferSolInstruction } from '@solana-program/system'
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getInitializeMint2Instruction,
  getMintSize,
  getMintToCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token'
import { DEMO_APPROVE_AMOUNT_RAW, DEMO_APPROVE_DECIMALS } from '../src/solana/demoApprove'
import { formatRawAmount } from '../src/utils/amounts'
import {
  assertDevnet,
  createDevnetRpc,
  DELEGATE_KEY_PATH,
  describe,
  ensureFunded,
  explorerUrl,
  FixtureError,
  loadEnv,
  loadOrCreateKeypair,
  MINT_AMOUNT_RAW,
  OWNER_KEY_PATH,
  readFixtureTokenAccount,
  relative,
  sendAndConfirm,
  type DevnetRpc,
} from './lib/fixture'
import {
  inspectWalletFixture,
  MIN_WALLET_FEE_BALANCE,
  printWalletFixture,
  printWalletFixtureReport,
  readWalletMetadata,
  readWalletOwnerEnv,
  WALLET_FEE_TOP_UP,
  WALLET_FIXTURE_PATH,
  writeWalletMetadata,
  type WalletFixtureMetadata,
} from './lib/wallet-fixture'

const log = (line: string) => console.log(line)
const RERUN = 'npm run fixture:wallet:create'

async function main(): Promise<void> {
  loadEnv()
  const walletOwner = readWalletOwnerEnv()
  const { rpc, label } = createDevnetRpc()
  log(`RPC: ${label}`)
  const genesisHash = await assertDevnet(rpc)
  log('Cluster check: Solana Devnet (genesis hash matches)')

  const payer = await loadOrCreateKeypair(OWNER_KEY_PATH)
  const delegate = await loadOrCreateKeypair(DELEGATE_KEY_PATH)
  log(`${payer.created ? 'Created' : 'Loaded'} payer key ${relative(OWNER_KEY_PATH)} -> ${payer.signer.address}`)
  log(`Demo delegate (public address only): ${delegate.signer.address}`)
  log(`Wallet owner (FIXTURE_WALLET_OWNER): ${walletOwner}`)
  if (walletOwner === payer.signer.address || walletOwner === delegate.signer.address) {
    throw new FixtureError('FIXTURE_WALLET_OWNER must be the Android wallet, not a local fixture key.')
  }

  const existing = readWalletMetadata()
  let meta: WalletFixtureMetadata
  if (existing && (await tryReuse(rpc, existing, walletOwner, payer.signer, delegate.signer.address, genesisHash))) {
    meta = existing
  } else {
    meta = await createWalletFixture(rpc, walletOwner, payer.signer, delegate.signer.address, genesisHash)
  }

  await topUpWalletFees(rpc, meta, payer.signer)

  log('\nChecking on-chain state (read-only)...')
  const report = await inspectWalletFixture(rpc, meta)
  printWalletFixture(meta, log)
  printWalletFixtureReport(report, log)
  if (report.status === 'problem') {
    throw new FixtureError(`VERIFICATION_FAILED:\n${report.problems.map((p) => `  - ${p}`).join('\n')}`)
  }
  if (report.status === 'approved') {
    log(`\nAPPROVED: the wallet has already approved the demo delegate for exactly 500 tokens.`)
  } else {
    log('\nREADY: token account exists with no delegate. Approve in the app (Devnet demo setup), then run')
    log('  npm run fixture:wallet:verify -- --expect=approved')
  }
}

async function tryReuse(
  rpc: DevnetRpc,
  meta: WalletFixtureMetadata,
  walletOwner: Address,
  payer: KeyPairSigner,
  delegate: Address,
  genesisHash: string,
): Promise<boolean> {
  if (
    meta.genesisHash !== genesisHash ||
    meta.walletOwner !== walletOwner ||
    meta.payer !== payer.address ||
    meta.delegate !== delegate
  ) {
    throw new FixtureError(
      `${relative(WALLET_FIXTURE_PATH)} was recorded for a different wallet, key or cluster. ` +
        'Delete it to create a new wallet fixture.',
    )
  }
  log(`\nFound existing wallet fixture metadata; checking token account ${meta.tokenAccount}...`)
  const state = await readFixtureTokenAccount(rpc, meta.tokenAccount as Address)
  if (!state.tokenAccountExists) {
    log('Recorded token account no longer exists on Devnet; creating a new wallet fixture.')
    return false
  }
  if (state.programAddress !== TOKEN_PROGRAM_ADDRESS || state.owner !== walletOwner || state.mint !== meta.mint) {
    throw new FixtureError(
      `Wallet fixture token account exists but is not the expected account. Delete ${relative(WALLET_FIXTURE_PATH)}.`,
    )
  }
  log('Existing wallet fixture found; reusing it (no setup transaction sent).')
  return true
}

async function createWalletFixture(
  rpc: DevnetRpc,
  walletOwner: Address,
  payer: KeyPairSigner,
  delegate: Address,
  genesisHash: string,
): Promise<WalletFixtureMetadata> {
  log('\nCreating a new wallet-owned Devnet fixture.')
  const airdrops = await ensureFunded(rpc, payer.address, log, { role: 'payer', rerun: RERUN })

  // Fresh mint key each time. Mint authority is the payer, so this key is not needed after creation and is not stored.
  const mint = await generateKeyPairSigner()
  const [tokenAccount] = await findAssociatedTokenPda({
    owner: walletOwner,
    mint: mint.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  })
  const mintSpace = BigInt(getMintSize())
  const mintRent = await rpc.getMinimumBalanceForRentExemption(mintSpace, { commitment: 'confirmed' }).send()

  log(`Creating mint ${mint.address}, the wallet's token account ${tokenAccount}, minting 1000 tokens...`)
  const setup = await sendAndConfirm(rpc, payer, [
    getCreateAccountInstruction({
      payer,
      newAccount: mint,
      lamports: mintRent,
      space: mintSpace,
      programAddress: TOKEN_PROGRAM_ADDRESS,
    }),
    getInitializeMint2Instruction({
      mint: mint.address,
      decimals: DEMO_APPROVE_DECIMALS,
      mintAuthority: payer.address,
    }),
    await getCreateAssociatedTokenIdempotentInstructionAsync({
      payer,
      ata: tokenAccount,
      owner: walletOwner,
      mint: mint.address,
    }),
    getMintToCheckedInstruction({
      mint: mint.address,
      token: tokenAccount,
      mintAuthority: payer,
      amount: MINT_AMOUNT_RAW,
      decimals: DEMO_APPROVE_DECIMALS,
    }),
  ])
  log(`Setup confirmed: ${setup}\n  ${explorerUrl('tx', setup)}`)

  const now = new Date().toISOString()
  const meta: WalletFixtureMetadata = {
    version: 1,
    kind: 'wallet-owned',
    cluster: 'devnet',
    genesisHash,
    walletOwner,
    payer: payer.address,
    mintAuthority: payer.address,
    delegate,
    mint: mint.address,
    tokenAccount,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    decimals: DEMO_APPROVE_DECIMALS,
    mintedAmountRaw: MINT_AMOUNT_RAW.toString(),
    approveAmountRaw: DEMO_APPROVE_AMOUNT_RAW.toString(),
    signatures: { airdrops, setup, feeTopUps: [] },
    createdAt: now,
    updatedAt: now,
  }
  writeWalletMetadata(meta)
  log(`Wrote public metadata to ${relative(WALLET_FIXTURE_PATH)}`)
  return meta
}

/** The wallet pays the in-app approve and revoke fees. Send it 0.01 Devnet SOL from the payer if it is low. */
async function topUpWalletFees(rpc: DevnetRpc, meta: WalletFixtureMetadata, payer: KeyPairSigner): Promise<void> {
  const owner = meta.walletOwner as Address
  const balance = (await rpc.getBalance(owner, { commitment: 'confirmed' }).send()).value
  if (balance >= MIN_WALLET_FEE_BALANCE) {
    return
  }
  log(`\nWallet has ${formatRawAmount(balance, 9)} SOL; sending it 0.01 Devnet SOL for transaction fees...`)
  meta.signatures.airdrops.push(...(await ensureFunded(rpc, payer.address, log, { role: 'payer', rerun: RERUN })))
  const signature = await sendAndConfirm(rpc, payer, [
    getTransferSolInstruction({ source: payer, destination: owner, amount: WALLET_FEE_TOP_UP }),
  ])
  log(`Fee top-up confirmed: ${signature}\n  ${explorerUrl('tx', signature)}`)
  meta.signatures.feeTopUps.push(signature)
  meta.updatedAt = new Date().toISOString()
  writeWalletMetadata(meta)
}

main().catch((error: unknown) => {
  console.error(`\nfixture:wallet:create failed.\n${error instanceof FixtureError ? error.message : describe(error)}`)
  process.exitCode = 1
})
