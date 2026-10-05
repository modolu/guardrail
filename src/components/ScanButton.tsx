import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { colors, sharedStyles, spacing } from '@/src/constants/theme'

export function ScanButton({ onPress, scanning }: { onPress: () => void; scanning: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy: scanning, disabled: scanning }}
      disabled={scanning}
      onPress={onPress}
      style={({ pressed }) => [sharedStyles.primaryButton, (pressed || scanning) && sharedStyles.pressed]}
    >
      {scanning ? (
        <View style={styles.row}>
          <ActivityIndicator color={colors.accentText} />
          <Text style={sharedStyles.primaryButtonText}>Scanning…</Text>
        </View>
      ) : (
        <Text style={sharedStyles.primaryButtonText}>Scan Wallet</Text>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
})
