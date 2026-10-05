import { StyleSheet, Text, View } from 'react-native'
import { colors, spacing } from '@/src/constants/theme'

/** Delegated amount in token units, with the exact raw base-unit value underneath. */
export function AmountRow({
  label,
  display,
  raw,
  decimals,
}: {
  label: string
  display: string
  raw: string
  decimals: number | null
}) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.amount} selectable>
        {display}
      </Text>
      <Text style={styles.raw} selectable>
        {decimals === null
          ? 'Mint decimals unknown; shown in base units'
          : `${raw} base units · ${decimals} decimal${decimals === 1 ? '' : 's'}`}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  label: {
    color: colors.textMuted,
    fontSize: 13,
  },
  amount: {
    color: colors.text,
    fontFamily: 'monospace',
    fontSize: 20,
    fontWeight: '600',
  },
  raw: {
    color: colors.textMuted,
    fontFamily: 'monospace',
    fontSize: 12,
  },
})
