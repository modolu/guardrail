import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { AddressChip } from '@/src/components/AddressChip'
import { delegatedAmountSummary } from '@/src/constants/explanations'
import { colors, radius, sharedStyles, spacing } from '@/src/constants/theme'
import type { PermissionFinding } from '@/src/types/permission'

export function PermissionCard({ finding }: { finding: PermissionFinding }) {
  const router = useRouter()

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>ACTIVE DELEGATE</Text>
        {finding.revocable ? null : <Text style={styles.viewOnly}>View only</Text>}
      </View>
      <Text style={styles.summary}>{delegatedAmountSummary(finding)}</Text>
      <Row label="Delegate">
        <AddressChip address={finding.delegate} />
      </Row>
      <Row label="Token mint">
        <AddressChip address={finding.mint} />
      </Row>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Review delegate permission for token account ${finding.tokenAccount}`}
        onPress={() => router.push({ pathname: '/permission/[id]', params: { id: finding.id } })}
        style={({ pressed }) => [sharedStyles.secondaryButton, styles.review, pressed && sharedStyles.pressed]}
      >
        <Text style={sharedStyles.secondaryButtonText}>Review</Text>
      </Pressable>
    </View>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
  },
  viewOnly: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  summary: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '600',
    lineHeight: 23,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  label: {
    color: colors.textMuted,
    fontSize: 13,
  },
  review: {
    marginTop: spacing.xs,
  },
})
