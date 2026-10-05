import { useCallback, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { EmptyState } from '@/src/components/EmptyState'
import { ErrorState } from '@/src/components/ErrorState'
import { ScanButton } from '@/src/components/ScanButton'
import { WalletHeader } from '@/src/components/WalletHeader'
import { colors, sharedStyles, spacing } from '@/src/constants/theme'
import type { AppError } from '@/src/types/errors'

// TODO(Task 4): add a `results` state carrying PermissionFinding[] once real scanning exists.
type ScanState =
  { status: 'idle' } | { status: 'scanning' } | { status: 'empty' } | { status: 'error'; error: AppError }

// TEMPORARY UI-ONLY MOCK — Task 4 replaces this with a real SPL Token delegate scan.
// It performs no RPC calls and always reports zero findings.
async function mockScanPlaceholder(_owner: string): Promise<readonly never[]> {
  await new Promise((resolve) => setTimeout(resolve, 600))
  return []
}

function networkBadgeLabel(chain: string): string {
  return (chain.split(':')[1] ?? chain).toUpperCase()
}

export default function HomeScreen() {
  const { account, chain, connect, disconnect } = useMobileWallet()

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        {account ? (
          <ConnectedView
            key={account.address}
            address={account.address}
            label={account.label}
            networkLabel={networkBadgeLabel(chain)}
            disconnect={disconnect}
          />
        ) : (
          <DisconnectedView connect={connect} />
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

function DisconnectedView({ connect }: { connect: () => Promise<unknown> }) {
  const [connecting, setConnecting] = useState(false)
  const [connectFailed, setConnectFailed] = useState(false)

  const handleConnect = useCallback(async () => {
    setConnecting(true)
    setConnectFailed(false)
    try {
      await connect()
    } catch {
      // Wallet cancellation is a normal outcome; show a calm note instead of crashing.
      setConnectFailed(true)
    } finally {
      setConnecting(false)
    }
  }, [connect])

  return (
    <View style={styles.disconnected}>
      <View style={styles.brand}>
        <Text style={styles.brandName}>GuardRail</Text>
        <Text style={styles.brandDescription}>
          Review which addresses can move tokens from your Solana wallet, and revoke those permissions.
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ busy: connecting, disabled: connecting }}
        disabled={connecting}
        onPress={handleConnect}
        style={({ pressed }) => [sharedStyles.primaryButton, (pressed || connecting) && sharedStyles.pressed]}
      >
        <Text style={sharedStyles.primaryButtonText}>{connecting ? 'Connecting…' : 'Connect Wallet'}</Text>
      </Pressable>
      {connectFailed ? (
        <Text style={styles.note}>The wallet did not complete the connection. You can try again.</Text>
      ) : null}
    </View>
  )
}

function ConnectedView({
  address,
  label,
  networkLabel,
  disconnect,
}: {
  address: string
  label?: string
  networkLabel: string
  disconnect: () => Promise<void>
}) {
  const [scan, setScan] = useState<ScanState>({ status: 'idle' })
  const [disconnecting, setDisconnecting] = useState(false)

  const handleScan = useCallback(async () => {
    setScan({ status: 'scanning' })
    try {
      const findings = await mockScanPlaceholder(address)
      if (findings.length === 0) {
        setScan({ status: 'empty' })
      }
    } catch (e) {
      setScan({
        status: 'error',
        error: {
          code: 'RPC_UNAVAILABLE',
          message: e instanceof Error ? e.message : 'The Devnet RPC request did not complete.',
        },
      })
    }
  }, [address])

  const handleDisconnect = useCallback(async () => {
    setDisconnecting(true)
    try {
      await disconnect()
    } catch {
      setDisconnecting(false)
    }
  }, [disconnect])

  return (
    <View style={styles.connected}>
      <WalletHeader
        address={address}
        label={label}
        networkLabel={networkLabel}
        onDisconnect={handleDisconnect}
        disconnecting={disconnecting}
      />
      <View style={styles.section}>
        <Text style={styles.heading}>Review permissions</Text>
        <Text style={styles.subheading}>
          Scan your standard SPL Token accounts for active delegate approvals on Solana Devnet.
        </Text>
      </View>
      <ScanButton onPress={handleScan} scanning={scan.status === 'scanning'} />
      {scan.status === 'empty' ? (
        <EmptyState
          title="No supported active delegates"
          message="None of this wallet's standard SPL Token accounts on Devnet currently have an active delegate. Other authority types are not checked."
        />
      ) : null}
      {scan.status === 'error' ? (
        <ErrorState
          title="Scan did not complete"
          message={scan.error.message}
          code={scan.error.code}
          onRetry={handleScan}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    flexGrow: 1,
    padding: spacing.md,
  },
  disconnected: {
    flex: 1,
    gap: spacing.lg,
    justifyContent: 'center',
  },
  brand: {
    gap: spacing.sm,
  },
  brandName: {
    color: colors.text,
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  brandDescription: {
    color: colors.textMuted,
    fontSize: 16,
    lineHeight: 23,
  },
  note: {
    color: colors.textMuted,
    fontSize: 14,
  },
  connected: {
    gap: spacing.lg,
  },
  section: {
    gap: spacing.xs,
  },
  heading: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '700',
  },
  subheading: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
})
