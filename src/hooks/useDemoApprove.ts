import { useCallback, useRef, useState } from 'react'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { DEMO_SETUP_ENV } from '@/constants/app-config'
import {
  confirmAndVerifyDemoApprove,
  parseDemoSetupConfig,
  submitDemoApprove,
  type DemoSetupConfig,
} from '@/src/solana/demoApprove'
import type { SendInstructions } from '@/src/solana/revoke'
import { devnetRpc } from '@/src/solana/rpc'
import { GuardRailError, toAppError, type AppError } from '@/src/types/errors'

export const demoSetupConfig: DemoSetupConfig = parseDemoSetupConfig(DEMO_SETUP_ENV)

export type DemoApproveState =
  | { status: 'idle' }
  | { status: 'awaiting-wallet' }
  | { status: 'confirming'; signature: string }
  | { status: 'verified'; signature: string }
  /** The wallet or user declined. A normal outcome: nothing was sent. */
  | { status: 'cancelled' }
  | { status: 'error'; error: AppError; signature?: string }

/**
 * Devnet demo setup: ask the connected wallet to sign the fixed 500-token ApproveChecked, confirm it, verify the exact
 * token account, then call `onVerified` (the home screen rescans). Only used when demo setup is enabled.
 */
export function useDemoApprove(onVerified: () => void): { state: DemoApproveState; approve: () => void } {
  const { account, chain, sendTransactions } = useMobileWallet()
  const [state, setState] = useState<DemoApproveState>({ status: 'idle' })
  const inFlight = useRef(false)

  const approve = useCallback(() => {
    if (inFlight.current) {
      return
    }
    inFlight.current = true
    setState({ status: 'awaiting-wallet' })

    // Same Kit 6 -> wallet-ui Kit 7 cast as useRevokeSubmission; runtime shape checked by scripts/verify-demo-approve.ts.
    const sendInstructions: SendInstructions = (instructions) =>
      sendTransactions(instructions as unknown as Parameters<typeof sendTransactions>[0])

    void (async () => {
      try {
        const { signature, target } = await submitDemoApprove({
          config: demoSetupConfig,
          connectedAddress: account?.address,
          chain,
          rpc: devnetRpc,
          sendInstructions,
        })
        setState({ status: 'confirming', signature })
        const outcome = await confirmAndVerifyDemoApprove(devnetRpc, target, signature)
        if (outcome.status === 'verified') {
          setState({ status: 'verified', signature })
          onVerified()
        } else {
          setState({ status: 'error', error: outcome.error, signature })
        }
      } catch (error) {
        if (error instanceof GuardRailError && error.code === 'SIGNATURE_REJECTED') {
          setState({ status: 'cancelled' })
        } else {
          setState({
            status: 'error',
            error: toAppError(error, 'TRANSACTION_FAILED', 'The demo setup could not be completed.'),
          })
        }
      } finally {
        inFlight.current = false
      }
    })()
  }, [account?.address, chain, onVerified, sendTransactions])

  return { state, approve }
}
