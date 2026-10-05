/**
 * Read-only check of the Devnet demo fixture recorded in .local/fixture/fixture.json.
 * Refetches the exact token account and runs GuardRail's scanner against the fixture owner; sends no transactions
 * and does not read any secret key.
 *
 * Exit code 0 only if the delegate and exact delegated amount are present on-chain.
 * Run: npm run fixture:verify
 */
import {
  assertDevnet,
  createDevnetRpc,
  describe,
  FixtureError,
  loadEnv,
  METADATA_PATH,
  printFixture,
  readMetadata,
  relative,
  verifyFixture,
} from './lib/fixture'

async function main(): Promise<void> {
  loadEnv()
  const meta = readMetadata()
  if (!meta) {
    throw new FixtureError(`No fixture metadata at ${relative(METADATA_PATH)}. Run npm run fixture:create first.`)
  }
  const { rpc, label } = createDevnetRpc()
  console.log(`RPC: ${label}`)
  const genesisHash = await assertDevnet(rpc)
  if (genesisHash !== meta.genesisHash) {
    throw new FixtureError('Fixture metadata was recorded on a different cluster.')
  }

  const report = await verifyFixture(rpc, meta)
  printFixture(meta)
  console.log('')
  console.log(`Direct read of ${meta.tokenAccount}:`)
  console.log(`  exists: ${report.state.tokenAccountExists}`)
  if (report.state.tokenAccountExists) {
    console.log(`  balance raw: ${String(report.state.amount)}`)
    console.log(`  delegate: ${report.state.delegate ?? 'none'}`)
    console.log(`  delegated amount raw: ${String(report.state.delegatedAmount)}`)
  }
  console.log(`GuardRail scanner (slot ${report.contextSlot}, ${report.scannedAccountCount} token account(s) scanned):`)
  if (report.finding) {
    const f = report.finding
    console.log(`  finding: ${f.type} ${f.explanationCode} revocable=${f.revocable}`)
    console.log(`  delegate: ${f.delegate}`)
    console.log(`  delegated: ${f.delegatedAmountDisplay} (raw ${f.delegatedAmountRaw}, decimals ${f.decimals})`)
  } else {
    console.log('  no finding for the fixture token account')
  }

  if (!report.ok) {
    throw new FixtureError(
      `VERIFICATION_FAILED:\n${report.problems.map((p) => `  - ${p}`).join('\n')}\n` +
        'If the delegate was revoked (e.g. after a revoke demo), run npm run fixture:create to re-approve it.',
    )
  }
  console.log('\nVERIFIED: delegate and exact delegated amount are present on Solana Devnet.')
}

main().catch((error: unknown) => {
  console.error(`\nfixture:verify failed.\n${error instanceof FixtureError ? error.message : describe(error)}`)
  process.exitCode = 1
})
