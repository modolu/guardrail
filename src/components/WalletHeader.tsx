import { Pressable, StyleSheet, Text, View } from 'react-native'
import { AddressChip } from '@/src/components/AddressChip'
import { colors, radius, sharedStyles, spacing } from '@/src/constants/theme'

export function WalletHeader({
  address,
  label,
  networkLabel,
  onDisconnect,
  disconnecting = false,
}: {
  address: string
  label?: string
  networkLabel: string
  onDisconnect: () => void
  disconnecting?: boolean
}) {
  return (
    <View style={styles.container}>
      <View style={styles.identity}>
        {label ? (
          <Text style={styles.label} numberOfLines={1}>
            {label}
          </Text>
        ) : null}
        <View style={styles.row}>
          <AddressChip address={address} />
          <View style={styles.badge} accessibilityLabel={`Network ${networkLabel}`}>
            <Text style={styles.badgeText}>{networkLabel}</Text>
          </View>
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        disabled={disconnecting}
        onPress={onDisconnect}
        style={({ pressed }) => [sharedStyles.secondaryButton, (pressed || disconnecting) && sharedStyles.pressed]}
      >
        <Text style={sharedStyles.secondaryButtonText}>{disconnecting ? 'Disconnecting…' : 'Disconnect'}</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  identity: {
    flexShrink: 1,
    gap: spacing.sm,
  },
  label: {
    color: colors.textMuted,
    fontSize: 13,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  badge: {
    borderColor: colors.devnet,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: {
    color: colors.devnet,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
})
