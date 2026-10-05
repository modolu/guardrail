import { useCallback } from 'react'
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query'
import { permissionScanQueryKey } from '@/src/hooks/usePermissionScan'
import { devnetRpc } from '@/src/solana/rpc'
import { confirmAndVerifyRevoke } from '@/src/solana/revoke'
import type { PermissionScanResult } from '@/src/types/permission'
import type { RevokeAttempt, RevokeOutcome } from '@/src/types/revoke'

export type RevokeVerificationState = { status: 'verifying' } | { status: 'done'; outcome: RevokeOutcome }

/**
 * Confirm the submitted revoke on Devnet and re-read the exact token account. Runs once when `attempt` is first seen
 * and again only when `retry` is called. Retrying is read-only: it never sends another transaction.
 */
export function useRevokeVerification(attempt: RevokeAttempt | undefined): {
  state: RevokeVerificationState
  retry: () => void
} {
  const queryClient = useQueryClient()
  const { data, isFetching, refetch } = useQuery<RevokeOutcome>({
    queryKey: ['revoke-verification', 'solana:devnet', attempt?.finding.owner ?? '', attempt?.signature ?? ''],
    queryFn: attempt
      ? async () => {
          const outcome = await confirmAndVerifyRevoke(devnetRpc, attempt.finding, attempt.signature)
          if (outcome.status === 'verified') {
            dropFindingFromScan(queryClient, attempt)
          }
          return outcome
        }
      : skipToken,
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
  })

  const retry = useCallback(() => {
    void refetch()
  }, [refetch])

  return { state: isFetching || !data ? { status: 'verifying' } : { status: 'done', outcome: data }, retry }
}

// The delegate is verified gone on-chain, so the cached scan should stop listing it. Removing exactly this finding
// avoids a full rescan; every other finding stays as scanned.
function dropFindingFromScan(queryClient: ReturnType<typeof useQueryClient>, attempt: RevokeAttempt) {
  queryClient.setQueryData<PermissionScanResult>(permissionScanQueryKey(attempt.finding.owner), (scan) =>
    scan ? { ...scan, findings: scan.findings.filter((finding) => finding.id !== attempt.finding.id) } : scan,
  )
}
