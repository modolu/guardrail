/**
 * Shorten a base58 address for display, e.g. "7xKX…9fQa".
 * Returns the input unchanged when it is already short enough.
 */
export function shortenAddress(address: string, chars = 4): string {
  if (chars < 1 || address.length <= chars * 2 + 1) {
    return address
  }
  return `${address.slice(0, chars)}…${address.slice(-chars)}`
}
