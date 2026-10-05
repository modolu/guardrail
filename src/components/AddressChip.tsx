import { StyleSheet, Text, View } from 'react-native'
import { colors, radius, spacing } from '@/src/constants/theme'
import { shortenAddress } from '@/src/utils/address'

export function AddressChip({ address, chars = 4 }: { address: string; chars?: number }) {
  return (
    <View style={styles.chip} accessibilityLabel={`Address ${address}`}>
      <Text style={styles.text}>{shortenAddress(address, chars)}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
  },
  text: {
    color: colors.text,
    fontFamily: 'monospace',
    fontSize: 14,
  },
})
