const U64_MAX = (1n << 64n) - 1n
const MAX_DECIMALS = 255 // u8 mint decimals

/** Parse a raw u64 token amount from a decimal string. Returns null for anything that is not a plain u64 integer. */
export function parseRawAmount(value: string): bigint | null {
  if (!/^\d+$/.test(value)) {
    return null
  }
  const amount = BigInt(value)
  return amount <= U64_MAX ? amount : null
}

export function isValidDecimals(decimals: number): boolean {
  return Number.isInteger(decimals) && decimals >= 0 && decimals <= MAX_DECIMALS
}

/**
 * Format a raw base-unit amount using only integer math, e.g. (1234500n, 6) -> "1.2345".
 * Trailing fractional zeros are trimmed; the integer part is grouped with commas.
 */
export function formatRawAmount(raw: bigint, decimals: number): string {
  if (raw < 0n) {
    throw new RangeError('Token amounts cannot be negative')
  }
  if (!isValidDecimals(decimals)) {
    throw new RangeError(`Invalid token decimals: ${decimals}`)
  }
  const digits = raw.toString()
  if (decimals === 0) {
    return groupThousands(digits)
  }
  const padded = digits.padStart(decimals + 1, '0')
  const whole = padded.slice(0, padded.length - decimals)
  const fraction = padded.slice(padded.length - decimals).replace(/0+$/, '')
  return fraction ? `${groupThousands(whole)}.${fraction}` : groupThousands(whole)
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}
