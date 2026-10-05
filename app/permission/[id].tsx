import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { AddressField } from '@/src/components/AddressField'
import { AmountRow } from '@/src/components/AmountRow'
import { EmptyState } from '@/src/components/EmptyState'
import {
  delegatedAmountSummary,
  PERMISSION_EXPLANATIONS,
  REVOKE_UNAVAILABLE_REASONS,
} from '@/src/constants/explanations'
import { colors, radius, sharedStyles, spacing } from '@/src/constants/theme'
import { usePermissionFinding } from '@/src/hooks/usePermissionFinding'
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

export default function PermissionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const lookup = usePermissionFinding(id)
  const router = useRouter()

  if (lookup.status !== 'found') {
    const { title, message } = LOOKUP_MESSAGES[lookup.status]
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <EmptyState title={title} message={message} />
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

  return <PermissionDetail finding={lookup.finding} contextSlot={lookup.contextSlot} />
}

function PermissionDetail({ finding, contextSlot }: { finding: PermissionFinding; contextSlot: bigint }) {
  const router = useRouter()
  const unavailableReason = REVOKE_UNAVAILABLE_REASONS[finding.explanationCode]

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.section}>
        <Text style={styles.eyebrow}>ACTIVE DELEGATE</Text>
        <Text style={styles.title}>{delegatedAmountSummary(finding)}</Text>
        <Text style={styles.explanation}>{PERMISSION_EXPLANATIONS[finding.explanationCode]}</Text>
      </View>

      <View style={styles.card}>
        <AmountRow
          label="Delegated amount"
          display={finding.delegatedAmountDisplay}
          raw={finding.delegatedAmountRaw}
          decimals={finding.decimals}
        />
        <AddressField label="Delegate" address={finding.delegate} />
        <AddressField label="Token account" address={finding.tokenAccount} />
        <AddressField label="Token mint" address={finding.mint} />
        <AddressField label="Token program" address={finding.tokenProgram} />
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Revocation</Text>
        {unavailableReason === null ? (
          <Text style={styles.value}>
            Supported. Revoking removes this delegate and sets the delegated amount to 0. It requires approval in your
            wallet and changes only this token account.
          </Text>
        ) : (
          <>
            <Text style={styles.value}>Not available in GuardRail</Text>
            <Text style={styles.explanation}>{unavailableReason}</Text>
          </>
        )}
      </View>

      {finding.revocable ? (
        <View style={styles.section}>
          {/* Opens the review screen only; nothing is built or sent until the user approves there. */}
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/revoke/[id]', params: { id: finding.id } })}
            style={({ pressed }) => [sharedStyles.primaryButton, pressed && sharedStyles.pressed]}
          >
            <Text style={sharedStyles.primaryButtonText}>Review revoke</Text>
          </Pressable>
          <Text style={styles.footnote}>You will see what changes before anything is sent to your wallet.</Text>
        </View>
      ) : null}

      <Text style={styles.footnote}>
        From the latest Devnet scan (slot {contextSlot.toString()}). Scan again to refresh.
      </Text>
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
  explanation: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
  },
  label: {
    color: colors.textMuted,
    fontSize: 13,
  },
  value: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 21,
  },
  footnote: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
})
