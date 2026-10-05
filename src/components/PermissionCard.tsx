import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { AddressChip } from '@/src/components/AddressChip'
import { PERMISSION_EXPLANATIONS } from '@/src/constants/explanations'
import { colors, radius, spacing } from '@/src/constants/theme'
import type { PermissionFinding } from '@/src/types/permission'

// Basic finding card; Task 6 polishes layout and adds navigation to detail/revoke.
export function PermissionCard({ finding }: { finding: PermissionFinding }) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>Token delegate</Text>
        <Text style={[styles.status, !finding.revocable && styles.statusViewOnly]}>
          {finding.revocable ? 'Revocable' : 'View only'}
        </Text>
      </View>
      <Row label="Delegate">
        <AddressChip address={finding.delegate} />
      </Row>
      <Row label="Mint">
        <AddressChip address={finding.mint} />
      </Row>
      <Row label="Delegated amount">
        <Text style={styles.amount}>{finding.delegatedAmountDisplay}</Text>
      </Row>
      <Text style={styles.explanation}>{PERMISSION_EXPLANATIONS[finding.explanationCode]}</Text>
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
  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  status: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '600',
  },
  statusViewOnly: {
    color: colors.textMuted,
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
  amount: {
    color: colors.text,
    fontFamily: 'monospace',
    fontSize: 14,
    flexShrink: 1,
    textAlign: 'right',
  },
  explanation: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: spacing.xs,
  },
})
