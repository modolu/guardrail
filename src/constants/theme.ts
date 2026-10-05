import { StyleSheet } from 'react-native'

// Calm, high-contrast dark palette. Avoid alarmist red-heavy styling.
export const colors = {
  background: '#0E1116',
  surface: '#161B22',
  surfaceRaised: '#1F2630',
  border: '#2A323D',
  text: '#E6EAF0',
  textMuted: '#9AA4B2',
  accent: '#7AA7FF',
  accentText: '#0E1116',
  devnet: '#C9B26B',
  error: '#E0A96D',
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
}

export const radius = {
  sm: 6,
  md: 10,
  pill: 999,
}

export const sharedStyles = StyleSheet.create({
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: spacing.lg,
  },
  primaryButtonText: {
    color: colors.accentText,
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  secondaryButtonText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '500',
  },
  pressed: {
    opacity: 0.7,
  },
})
