/**
 * Hand-built byte layout of an SPL Token Account (165 bytes), independent of the decoder under test.
 * Used by scripts/verify-revoke.ts and scripts/verify-demo-approve.ts.
 */
import { getAddressDecoder, type Address } from '@solana/kit'

export function addr(seed: number): Address {
  return getAddressDecoder().decode(new Uint8Array(32).fill(seed))
}

export interface TokenLayout {
  mintSeed?: number
  ownerSeed?: number
  amount?: bigint
  delegateSeed?: number | null
  state?: number
  delegatedAmount?: bigint
}

// SPL Token Account: mint(32) owner(32) amount(u64) delegate(COption<Pubkey>) state(u8)
// is_native(COption<u64>) delegated_amount(u64) close_authority(COption<Pubkey>) = 165 bytes.
export function tokenAccountBytes(layout: TokenLayout = {}): Uint8Array {
  const data = new Uint8Array(165)
  const view = new DataView(data.buffer)
  data.set(new Uint8Array(32).fill(layout.mintSeed ?? 3), 0)
  data.set(new Uint8Array(32).fill(layout.ownerSeed ?? 1), 32)
  view.setBigUint64(64, layout.amount ?? 1_000_000_000n, true)
  const delegateSeed = layout.delegateSeed === undefined ? 4 : layout.delegateSeed
  view.setUint32(72, delegateSeed === null ? 0 : 1, true)
  if (delegateSeed !== null) data.set(new Uint8Array(32).fill(delegateSeed), 76)
  data[108] = layout.state ?? 1
  view.setUint32(109, 0, true) // is_native: None
  view.setBigUint64(121, layout.delegatedAmount ?? 250_500_000n, true)
  view.setUint32(129, 0, true) // close_authority: None
  return data
}

// SPL Token Mint: mint_authority(COption<Pubkey>) supply(u64) decimals(u8) is_initialized(bool)
// freeze_authority(COption<Pubkey>) = 82 bytes.
export function mintAccountBytes(layout: { decimals?: number; isInitialized?: boolean } = {}): Uint8Array {
  const data = new Uint8Array(82)
  const view = new DataView(data.buffer)
  view.setUint32(0, 1, true)
  data.set(new Uint8Array(32).fill(6), 4)
  view.setBigUint64(36, 1_000_000_000n, true)
  data[44] = layout.decimals ?? 6
  data[45] = layout.isInitialized === false ? 0 : 1
  view.setUint32(46, 0, true) // freeze_authority: None
  return data
}
