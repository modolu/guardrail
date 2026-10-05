import { skipToken, useQuery } from '@tanstack/react-query'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import type { RevokeAttempt } from '@/src/types/revoke'

export function revokeAttemptQueryKey(owner: string, id: string) {
  return ['revoke-attempt', 'solana:devnet', owner, id] as const
}

/**
 * The submitted revoke for `id`, as recorded by useRevokeSubmission. Read-only cache lookup; never triggers any RPC
 * call. Only attempts recorded for the connected wallet are returned.
 */
export function useRevokeAttempt(id: string | undefined): RevokeAttempt | undefined {
  const { account } = useMobileWallet()
  const { data } = useQuery<RevokeAttempt>({
    queryKey: revokeAttemptQueryKey(account?.address ?? '', id ?? ''),
    queryFn: skipToken,
    staleTime: Infinity,
    gcTime: Infinity,
  })
  return account && data?.finding.owner === account.address ? data : undefined
}
