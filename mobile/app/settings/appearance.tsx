import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { ScreenBackground } from '../../src/components/ScreenBackground'
import { ScreenHeader } from '../../src/components/ScreenHeader'
import { ThemeGrid } from '../../src/components/ThemePicker'
import { useSettings, useTheme } from '../../src/state/settings'
import { spacing, type as typography } from '../../src/theme/tokens'

export default function AppearanceScreen(): React.JSX.Element {
  const theme = useTheme()
  const { themeKey } = useSettings()

  return (
    <ScreenBackground>
      <SafeAreaView style={styles.root} edges={['top']}>
        <ScreenHeader
          title="Appearance"
          subtitle="Spectral themes, tuned for phone surfaces"
          onBack={() => router.back()}
        />
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <ThemeGrid />
          <View style={styles.note}>
            <Text style={[styles.noteTitle, { color: theme.text }]}>Dark by design</Text>
            <Text style={[styles.noteBody, { color: theme.textSecondary }]}>
              Prism Mobile keeps every theme on a dark base: it saves battery on OLED panels and
              keeps long reading sessions comfortable at night. Your choice syncs with the same
              accent family used by the desktop app ({themeKey} selected).
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </ScreenBackground>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxxl,
    gap: spacing.xl
  },
  note: {
    gap: spacing.xs,
    paddingHorizontal: spacing.xs
  },
  noteTitle: {
    ...typography.headline,
    fontSize: 16
  },
  noteBody: {
    ...typography.callout,
    fontSize: 14,
    lineHeight: 21
  }
})
