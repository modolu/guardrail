import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import 'react-native-reanimated'
import { AppProviders } from '@/components/app-providers'
import { colors } from '@/src/constants/theme'

export default function RootLayout() {
  return (
    <AppProviders>
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: colors.background },
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerShadowVisible: false,
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="permission/[id]" options={{ title: 'Review permission' }} />
        <Stack.Screen name="revoke/[id]" options={{ title: 'Revoke access' }} />
        {/* No way back into the review screen once a transaction has been submitted. */}
        <Stack.Screen
          name="result/[id]"
          options={{ title: 'Revoke result', headerBackVisible: false, gestureEnabled: false }}
        />
      </Stack>
      <StatusBar style="light" />
    </AppProviders>
  )
}
