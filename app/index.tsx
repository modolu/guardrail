import { useCallback, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { Address } from '@solana/kit'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { DemoSetupPanel } from '@/src/components/DemoSetupPanel'
import { EmptyState } from '@/src/components/EmptyState'
import { ErrorState } from '@/src/components/ErrorState'
import { PermissionCard } from '@/src/components/PermissionCard'
import { ScanButton } from '@/src/components/ScanButton'
import { WalletHeader } from '@/src/components/WalletHeader'
import { colors, sharedStyles, spacing } from '@/src/constants/theme'
import { usePermissionScan } from '@/src/hooks/usePermissionScan'
import type { PermissionScanResult } from '@/src/types/permission'

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
          Review which addresses are approved as delegates on your SPL Token accounts, and revoke them if you wish.
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
  address: Address
  label?: string
  networkLabel: string
  disconnect: () => Promise<void>
}) {
  const { state: scan, scan: handleScan } = usePermissionScan(address)
  const [disconnecting, setDisconnecting] = useState(false)

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
      <DemoSetupPanel onApproved={handleScan} />
      <ScanButton onPress={handleScan} scanning={scan.status === 'scanning'} />
      {scan.status === 'results' ? <ScanResults result={scan.result} /> : null}
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

function ScanResults({ result }: { result: PermissionScanResult }) {
  const skippedNote =
    result.skippedAccountCount > 0
      ? `${result.skippedAccountCount} account${result.skippedAccountCount === 1 ? '' : 's'} could not be read and ${result.skippedAccountCount === 1 ? 'was' : 'were'} not included.`
      : null

  if (result.findings.length === 0) {
    return (
      <View style={styles.results}>
        <EmptyState
          title="No supported active delegates"
          message="In the latest scan, none of this wallet's standard SPL Token accounts on Devnet had an active delegate. Other authority types, other token programs and other networks are not checked."
        />
        {skippedNote ? <Text style={styles.note}>{skippedNote}</Text> : null}
      </View>
    )
  }

  return (
    <View style={styles.results}>
      <Text style={styles.summary}>
        {result.findings.length} active delegate{result.findings.length === 1 ? '' : 's'} across{' '}
        {result.scannedAccountCount} SPL Token account{result.scannedAccountCount === 1 ? '' : 's'}
      </Text>
      {result.findings.map((finding) => (
        <PermissionCard key={finding.id} finding={finding} />
      ))}
      {skippedNote ? <Text style={styles.note}>{skippedNote}</Text> : null}
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
  results: {
    gap: spacing.md,
  },
  summary: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  subheading: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
})
