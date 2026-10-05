import { StyleSheet, Text, View } from 'react-native'
import { colors, spacing } from '@/src/constants/theme'

export function AddressField({ label, address }: { label: string; address: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.address} selectable accessibilityLabel={`${label} ${address}`}>
        {address}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  field: {
    gap: spacing.xs,
  },
  label: {
    color: colors.textMuted,
    fontSize: 13,
  },
  address: {
    color: colors.text,
    fontFamily: 'monospace',
    fontSize: 14,
    lineHeight: 20,
  },
})
