import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors, radius, sharedStyles, spacing } from '@/src/constants/theme'

export function ErrorState({
  title,
  message,
  code,
  onRetry,
}: {
  title: string
  message: string
  code?: string
  onRetry?: () => void
}) {
  return (
    <View style={styles.container} accessibilityRole="alert">
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      {code ? <Text style={styles.code}>{code}</Text> : null}
      {onRetry ? (
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={({ pressed }) => [sharedStyles.secondaryButton, styles.retry, pressed && sharedStyles.pressed]}
        >
          <Text style={sharedStyles.secondaryButtonText}>Try again</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderColor: colors.error,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  message: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  code: {
    color: colors.error,
    fontFamily: 'monospace',
    fontSize: 12,
  },
  retry: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
  },
})
