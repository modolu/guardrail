import { useCallback, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { revokeAttemptQueryKey } from '@/src/hooks/useRevokeAttempt'
import { devnetRpc } from '@/src/solana/rpc'
import { submitRevoke, type SendInstructions } from '@/src/solana/revoke'
import { GuardRailError, toAppError, type AppError } from '@/src/types/errors'
import type { PermissionFinding } from '@/src/types/permission'
import type { RevokeAttempt } from '@/src/types/revoke'

export type RevokeSubmissionState =
  | { status: 'idle' }
  | { status: 'awaiting-wallet' }
  /** The wallet or user declined. A normal outcome: nothing was sent and the user can try again. */
  | { status: 'cancelled' }
  | { status: 'error'; error: AppError }

interface RevokeSubmission {
  state: RevokeSubmissionState
  submit: () => void
}

/**
 * Submit the revoke for `finding` through the connected wallet's Mobile Wallet Adapter session. On submission it
 * records the attempt and moves to the result route, which confirms on Devnet and verifies the token account.
 */
export function useRevokeSubmission(finding: PermissionFinding): RevokeSubmission {
  const { account, sendTransactions } = useMobileWallet()
  const queryClient = useQueryClient()
  const router = useRouter()
  const [state, setState] = useState<RevokeSubmissionState>({ status: 'idle' })
  const inFlight = useRef(false)

  const submit = useCallback(() => {
    if (inFlight.current) {
      return
    }
    inFlight.current = true
    setState({ status: 'awaiting-wallet' })

    // wallet-ui builds the transaction with its own @solana/kit (7.x) while the instruction comes from
    // @solana-program/token on the app's @solana/kit (6.x). The shapes match at runtime (checked by
    // scripts/verify-revoke.ts, which compiles the instruction with wallet-ui's Kit); only the nominal types differ.
    const sendInstructions: SendInstructions = (instructions) =>
      sendTransactions(instructions as unknown as Parameters<typeof sendTransactions>[0])

    void (async () => {
      try {
        const { signature } = await submitRevoke({
          finding,
          connectedAddress: account?.address,
          rpc: devnetRpc,
          sendInstructions,
        })
        const attempt: RevokeAttempt = { finding, signature }
        queryClient.setQueryData(revokeAttemptQueryKey(finding.owner, finding.id), attempt)
        router.replace({ pathname: '/result/[id]', params: { id: finding.id } })
      } catch (error) {
        if (error instanceof GuardRailError && error.code === 'SIGNATURE_REJECTED') {
          setState({ status: 'cancelled' })
        } else {
          setState({
            status: 'error',
            error: toAppError(error, 'TRANSACTION_FAILED', 'The revoke could not be completed.'),
          })
        }
      } finally {
        inFlight.current = false
      }
    })()
  }, [account?.address, finding, queryClient, router, sendTransactions])

  return { state, submit }
}
