import { Pressable, StyleSheet, Text, View } from 'react-native'
import { AddressChip } from '@/src/components/AddressChip'
import { ExplorerLink } from '@/src/components/ExplorerLink'
import { colors, radius, sharedStyles, spacing } from '@/src/constants/theme'
import { demoSetupConfig, useDemoApprove } from '@/src/hooks/useDemoApprove'

/**
 * Devnet demo setup, shown only in builds with EXPO_PUBLIC_DEMO_SETUP=1. Creates a known delegate approval on the
 * connected wallet's demo token account so the scan has something real to find. Renders nothing otherwise.
 */
export function DemoSetupPanel({ onApproved }: { onApproved: () => void }) {
  if (demoSetupConfig.status === 'disabled') {
    return null
  }
  if (demoSetupConfig.status === 'invalid') {
    return (
      <View style={styles.panel}>
        <Text style={styles.title}>Devnet demo setup</Text>
        <Text style={styles.body}>Demo setup is turned on but not configured: {demoSetupConfig.reason}</Text>
      </View>
    )
  }
  return <EnabledPanel mint={demoSetupConfig.mint} delegate={demoSetupConfig.delegate} onApproved={onApproved} />
}

function EnabledPanel({ mint, delegate, onApproved }: { mint: string; delegate: string; onApproved: () => void }) {
  const { state, approve } = useDemoApprove(onApproved)
  const busy = state.status === 'awaiting-wallet' || state.status === 'confirming'
  const done = state.status === 'verified'

  return (
    <View style={styles.panel}>
      <Text style={styles.title}>Devnet demo setup</Text>
      <Text style={styles.body}>
        Approves the demo delegate below to transfer or burn up to 500 demo tokens from your demo token account. Your
        wallet asks you to sign; nothing is sent without your approval. Devnet only.
      </Text>
      <View style={styles.row}>
        <Text style={styles.label}>Delegate</Text>
        <AddressChip address={delegate} />
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Mint</Text>
        <AddressChip address={mint} />
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Amount</Text>
        <Text style={styles.value}>500 (6 decimals)</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ busy, disabled: busy || done }}
        disabled={busy || done}
        onPress={approve}
        style={({ pressed }) => [sharedStyles.secondaryButton, (pressed || busy || done) && sharedStyles.pressed]}
      >
        <Text style={sharedStyles.secondaryButtonText}>{buttonLabel(state.status)}</Text>
      </Pressable>
      {state.status === 'verified' ? (
        <Text style={styles.body}>Approval confirmed and verified on the token account. Scanning again.</Text>
      ) : null}
      {state.status === 'cancelled' ? (
        <Text style={styles.body}>The wallet did not approve the demo setup. Nothing was sent.</Text>
      ) : null}
      {state.status === 'error' ? (
        <View style={styles.error}>
          <Text style={styles.body}>{state.error.message}</Text>
          <Text style={styles.code}>{state.error.code}</Text>
        </View>
      ) : null}
      {(state.status === 'verified' || state.status === 'error') && state.signature ? (
        <ExplorerLink signature={state.signature} />
      ) : null}
    </View>
  )
}

function buttonLabel(status: string): string {
  switch (status) {
    case 'awaiting-wallet':
      return 'Waiting for wallet…'
    case 'confirming':
      return 'Confirming on Devnet…'
    case 'verified':
      return 'Demo approval created'
    default:
      return 'Approve 500 demo tokens'
  }
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.surface,
    borderColor: colors.devnet,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  title: {
    color: colors.devnet,
    fontSize: 15,
    fontWeight: '600',
  },
  body: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  label: {
    color: colors.textMuted,
    fontSize: 14,
  },
  value: {
    color: colors.text,
    fontSize: 14,
  },
  error: {
    gap: spacing.xs,
  },
  code: {
    color: colors.error,
    fontFamily: 'monospace',
    fontSize: 12,
  },
})
