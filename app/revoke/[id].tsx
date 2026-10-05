import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { AddressField } from '@/src/components/AddressField'
import { AmountRow } from '@/src/components/AmountRow'
import { EmptyState } from '@/src/components/EmptyState'
import { ErrorState } from '@/src/components/ErrorState'
import { colors, radius, sharedStyles, spacing } from '@/src/constants/theme'
import { usePermissionFinding } from '@/src/hooks/usePermissionFinding'
import { useRevokeSubmission } from '@/src/hooks/useRevokeSubmission'
import { revokePreconditionError } from '@/src/solana/revoke'
import type { PermissionFinding } from '@/src/types/permission'

const LOOKUP_MESSAGES = {
  'wallet-not-connected': {
    title: 'Wallet not connected',
    message: 'Connect your wallet and scan again to review this permission.',
  },
  'not-scanned': {
    title: 'No scan available',
    message: 'Scan your wallet from the home screen to review its delegate permissions.',
  },
  'not-found': {
    title: 'Permission not in the latest scan',
    message: 'This token account is not in the latest scan of the connected wallet. Scan again to refresh.',
  },
} as const

export default function RevokeReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const lookup = usePermissionFinding(id)
  const { account } = useMobileWallet()

  if (lookup.status !== 'found') {
    return <Unavailable {...LOOKUP_MESSAGES[lookup.status]} />
  }
  // Same checks the transaction builder enforces; shown here so an unsupported revoke never reaches the wallet.
  const blocked = revokePreconditionError(lookup.finding, account?.address)
  if (blocked) {
    return <Unavailable title="Revoke not available" message={blocked.message} code={blocked.code} />
  }
  return <RevokeReview finding={lookup.finding} />
}

function Unavailable({ title, message, code }: { title: string; message: string; code?: string }) {
  const router = useRouter()
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <EmptyState title={title} message={message} />
      {code ? <Text style={styles.footnote}>{code}</Text> : null}
      <Pressable
        accessibilityRole="button"
        onPress={() => router.dismissTo('/')}
        style={({ pressed }) => [sharedStyles.secondaryButton, pressed && sharedStyles.pressed]}
      >
        <Text style={sharedStyles.secondaryButtonText}>Back to scan</Text>
      </Pressable>
    </ScrollView>
  )
}

function RevokeReview({ finding }: { finding: PermissionFinding }) {
  const router = useRouter()
  const { state, submit } = useRevokeSubmission(finding)
  const waiting = state.status === 'awaiting-wallet'

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.section}>
        <Text style={styles.eyebrow}>REVIEW BEFORE YOU APPROVE</Text>
        <Text style={styles.title}>Remove this delegate</Text>
        <Text style={styles.body}>Nothing is sent until you approve in your wallet.</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>What will change</Text>
        <AddressField label="Token account" address={finding.tokenAccount} />
        <AddressField label="Delegate that will be removed" address={finding.delegate} />
        <AmountRow
          label="Delegated amount that will be set to 0"
          display={finding.delegatedAmountDisplay}
          raw={finding.delegatedAmountRaw}
          decimals={finding.decimals}
        />
        <Text style={styles.body}>Afterwards this address can no longer move tokens from this account.</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>What stays the same</Text>
        <Text style={styles.body}>No tokens are moved. Your balance and other accounts are not changed.</Text>
        <Text style={styles.body}>One instruction only: SPL Token Revoke for this token account.</Text>
        <AddressField label="Approving wallet (token account owner)" address={finding.owner} />
        <Text style={styles.footnote}>The network fee is paid in Devnet SOL from this wallet.</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>What happens next</Text>
        <Text style={styles.body}>1. Your wallet asks you to approve.</Text>
        <Text style={styles.body}>2. GuardRail waits for Devnet to confirm the transaction.</Text>
        <Text style={styles.body}>3. GuardRail re-reads this token account and checks the delegate is gone.</Text>
        <Text style={styles.footnote}>Success is shown only after that check passes.</Text>
      </View>

      {state.status === 'cancelled' ? (
        <Text style={styles.body} accessibilityRole="alert">
          The wallet did not approve the revoke. Nothing was sent. You can try again.
        </Text>
      ) : null}
      {state.status === 'error' ? (
        <ErrorState title="Revoke not completed" message={state.error.message} code={state.error.code} />
      ) : null}

      <View style={styles.section}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ busy: waiting, disabled: waiting }}
          disabled={waiting}
          onPress={submit}
          style={({ pressed }) => [sharedStyles.primaryButton, (pressed || waiting) && sharedStyles.pressed]}
        >
          <Text style={sharedStyles.primaryButtonText}>{waiting ? 'Waiting for wallet…' : 'Approve in wallet'}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={waiting}
          onPress={() => (router.canGoBack() ? router.back() : router.dismissTo('/'))}
          style={({ pressed }) => [sharedStyles.secondaryButton, pressed && sharedStyles.pressed]}
        >
          <Text style={sharedStyles.secondaryButtonText}>Cancel</Text>
        </Pressable>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.lg,
    padding: spacing.md,
  },
  section: {
    gap: spacing.sm,
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
  },
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 28,
  },
  body: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 21,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  footnote: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
})
