import { Linking, Pressable, StyleSheet, Text } from 'react-native'
import { colors, sharedStyles } from '@/src/constants/theme'
import { explorerTransactionUrl } from '@/src/utils/explorer'

/** Opens the transaction on Solana Explorer (Devnet cluster). Renders nothing if the signature is not plausible. */
export function ExplorerLink({ signature }: { signature: string }) {
  const url = explorerTransactionUrl(signature)
  if (!url) {
    return null
  }
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel="View this transaction on Solana Explorer, Devnet"
      onPress={() => {
        // Opening a browser is best-effort; a failure here must never affect the revoke result.
        Linking.openURL(url).catch(() => undefined)
      }}
      style={({ pressed }) => [sharedStyles.secondaryButton, pressed && sharedStyles.pressed]}
    >
      <Text style={styles.text}>View on Solana Explorer (Devnet)</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  text: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: '500',
  },
})
