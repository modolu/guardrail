import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { AddressField } from '@/src/components/AddressField'
import { EmptyState } from '@/src/components/EmptyState'
import { ErrorState } from '@/src/components/ErrorState'
import { ExplorerLink } from '@/src/components/ExplorerLink'
import { colors, radius, sharedStyles, spacing } from '@/src/constants/theme'
import { useRevokeAttempt } from '@/src/hooks/useRevokeAttempt'
import { useRevokeVerification } from '@/src/hooks/useRevokeVerification'
import type { RevokeAttempt } from '@/src/types/revoke'

export default function RevokeResultScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const attempt = useRevokeAttempt(id)
  const router = useRouter()

  if (!attempt) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <EmptyState
          title="No revoke to show"
          message="There is no submitted revoke for this token account in this session. Scan again to see its current state."
        />
        <BackToScanButton onPress={() => router.dismissTo('/')} />
      </ScrollView>
    )
  }
  return <RevokeResult attempt={attempt} />
}

function RevokeResult({ attempt }: { attempt: RevokeAttempt }) {
  const router = useRouter()
  const { state, retry } = useRevokeVerification(attempt)
  const { finding, signature } = attempt

  if (state.status === 'verifying') {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.progress} accessibilityRole="progressbar" accessibilityLabel="Verifying revoke">
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={styles.title}>Confirming on Devnet</Text>
          <Text style={styles.centered}>The wallet submitted the transaction.</Text>
          <Text style={styles.centered}>Waiting for Devnet to confirm, then re-reading the token account.</Text>
          <Text style={styles.centered}>Success is shown only once the delegate is verified gone.</Text>
        </View>
        <ExplorerLink signature={signature} />
      </ScrollView>
    )
  }

  const { outcome } = state
  return (
    <ScrollView contentContainerStyle={styles.content}>
      {outcome.status === 'verified' ? (
        <View style={styles.section}>
          <Text style={styles.eyebrow}>VERIFIED ON DEVNET</Text>
          <Text style={styles.title}>Delegate removed</Text>
          <Text style={styles.body}>Devnet confirmed the transaction and the token account has no delegate.</Text>
          <Text style={styles.footnote}>Verified by reading the account at slot {outcome.slot.toString()}.</Text>
        </View>
      ) : null}
      {outcome.status === 'transaction-failed' ? (
        <ErrorState title="Revoke did not go through" message={outcome.error.message} code={outcome.error.code} />
      ) : null}
      {outcome.status === 'not-verified' ? (
        <>
          <ErrorState
            title="Revoke not verified yet"
            message={outcome.error.message}
            code={outcome.error.code}
            onRetry={retry}
            retryLabel="Retry verification"
          />
          <Text style={styles.footnote}>Retrying only reads Devnet again. It never sends another transaction.</Text>
        </>
      ) : null}

      <View style={styles.card}>
        <AddressField label="Token account" address={finding.tokenAccount} />
        <AddressField label="Delegate" address={finding.delegate} />
        <AddressField label="Transaction signature" address={signature} />
      </View>

      <View style={styles.section}>
        <ExplorerLink signature={signature} />
        <BackToScanButton onPress={() => router.dismissTo('/')} />
      </View>
    </ScrollView>
  )
}

function BackToScanButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [sharedStyles.secondaryButton, pressed && sharedStyles.pressed]}
    >
      <Text style={sharedStyles.secondaryButtonText}>Back to scan</Text>
    </Pressable>
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
  progress: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xl,
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
  centered: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
  },
  footnote: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
})
