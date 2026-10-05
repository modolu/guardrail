import { useCallback } from 'react'
import type { Address } from '@solana/kit'
import { useQuery } from '@tanstack/react-query'
import { devnetRpc } from '@/src/solana/rpc'
import { scanPermissions } from '@/src/solana/scanPermissions'
import { toAppError, type AppError } from '@/src/types/errors'
import type { PermissionScanResult } from '@/src/types/permission'

export type PermissionScanState =
  | { status: 'idle' }
  | { status: 'scanning' }
  | { status: 'error'; error: AppError }
  | { status: 'results'; result: PermissionScanResult }

export function permissionScanQueryKey(owner: string) {
  return ['permission-scan', 'solana:devnet', owner] as const
}

/** User-triggered delegate scan for `owner` on Solana Devnet. */
export function usePermissionScan(owner: Address): { state: PermissionScanState; scan: () => void } {
  const query = useQuery({
    queryKey: permissionScanQueryKey(owner),
    queryFn: () => scanPermissions(devnetRpc, owner),
    enabled: false,
    retry: false,
    staleTime: Infinity,
  })
  const { refetch } = query

  const scan = useCallback(() => {
    void refetch()
  }, [refetch])

  return { state: toScanState(query), scan }
}

function toScanState(query: {
  isFetching: boolean
  error: unknown
  data: PermissionScanResult | undefined
}): PermissionScanState {
  if (query.isFetching) {
    return { status: 'scanning' }
  }
  if (query.error) {
    return {
      status: 'error',
      error: toAppError(query.error, 'RPC_UNAVAILABLE', 'The Devnet scan did not complete. Check your connection.'),
    }
  }
  if (query.data) {
    return { status: 'results', result: query.data }
  }
  return { status: 'idle' }
}
