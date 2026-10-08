/**
 * Read-only check of the wallet-owned Devnet fixture recorded in .local/fixture/wallet-fixture.json.
 * Sends no transactions and reads no secret key.
 *
 *   --expect=ready     pass only if the token account has no delegate yet (before the in-app approve / after revoke)
 *   --expect=approved  pass only if the demo delegate holds exactly 500 tokens, also confirmed by GuardRail's scanner
 *   (default)          pass if either of the above holds
 *
 * Run: npm run fixture:wallet:verify [-- --expect=approved]
 */
import { assertDevnet, createDevnetRpc, describe, FixtureError, loadEnv, relative } from './lib/fixture'
import {
  inspectWalletFixture,
  printWalletFixture,
  printWalletFixtureReport,
  readWalletMetadata,
  WALLET_FIXTURE_PATH,
} from './lib/wallet-fixture'

function readExpectation(): 'ready' | 'approved' | 'any' {
  const arg = process.argv.slice(2).find((a) => a.startsWith('--expect='))
  const value = arg?.slice('--expect='.length) ?? 'any'
  if (value !== 'ready' && value !== 'approved' && value !== 'any') {
    throw new FixtureError(`Unknown --expect=${value}; use ready, approved or any.`)
  }
  return value
}

async function main(): Promise<void> {
  loadEnv()
  const expectation = readExpectation()
  const meta = readWalletMetadata()
  if (!meta) {
    throw new FixtureError(
      `No wallet fixture metadata at ${relative(WALLET_FIXTURE_PATH)}. ` +
        'Run FIXTURE_WALLET_OWNER=<wallet address> npm run fixture:wallet:create first.',
    )
  }
  const { rpc, label } = createDevnetRpc()
  console.log(`RPC: ${label}`)
  const genesisHash = await assertDevnet(rpc)
  if (genesisHash !== meta.genesisHash) {
    throw new FixtureError('Wallet fixture metadata was recorded on a different cluster.')
  }

  const report = await inspectWalletFixture(rpc, meta)
  printWalletFixture(meta)
  printWalletFixtureReport(report)

  if (report.status === 'problem') {
    throw new FixtureError(`VERIFICATION_FAILED:\n${report.problems.map((p) => `  - ${p}`).join('\n')}`)
  }
  if (expectation !== 'any' && report.status !== expectation) {
    throw new FixtureError(`VERIFICATION_FAILED: expected state "${expectation}", found "${report.status}".`)
  }
  console.log(
    report.status === 'approved'
      ? '\nVERIFIED: the demo delegate holds an active approval for exactly 500 tokens on Solana Devnet.'
      : '\nVERIFIED: the wallet token account exists on Solana Devnet with no delegate (ready for the in-app approve).',
  )
}

main().catch((error: unknown) => {
  console.error(`\nfixture:wallet:verify failed.\n${error instanceof FixtureError ? error.message : describe(error)}`)
  process.exitCode = 1
})
