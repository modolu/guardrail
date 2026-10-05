import { skipToken, useQuery } from '@tanstack/react-query'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { permissionScanQueryKey } from '@/src/hooks/usePermissionScan'
import type { PermissionFinding, PermissionScanResult } from '@/src/types/permission'

export type PermissionFindingLookup =
  | { status: 'wallet-not-connected' }
  | { status: 'not-scanned' }
  | { status: 'not-found' }
  | { status: 'found'; finding: PermissionFinding; contextSlot: bigint }

/**
 * Read one finding from the cached scan of the connected wallet. Never triggers a scan or any RPC call;
 * a finding is only shown if it came from this wallet's own scan result.
 */
export function usePermissionFinding(id: string | undefined): PermissionFindingLookup {
  const { account } = useMobileWallet()
  const owner = account?.address
  const { data } = useQuery<PermissionScanResult>({
    queryKey: permissionScanQueryKey(owner ?? ''),
    queryFn: skipToken,
    staleTime: Infinity,
  })

  if (!owner) {
    return { status: 'wallet-not-connected' }
  }
  if (!data) {
    return { status: 'not-scanned' }
  }
  const finding = data.findings.find((f) => f.id === id && f.owner === owner)
  return finding ? { status: 'found', finding, contextSlot: data.contextSlot } : { status: 'not-found' }
}
