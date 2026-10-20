import { StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useUpdates } from '../state/updates'
import { useTheme } from '../state/settings'
import { radius, spacing, type as typography } from '../theme/tokens'
import { PressableScale } from './PressableScale'

/** Only surfaces itself when there is something to do; silent otherwise. */
export function UpdateBanner(): React.JSX.Element | null {
  const theme = useTheme()
  const { status, release, progress, currentVersion, openSheet } = useUpdates()

  if (status !== 'available' && status !== 'downloading' && status !== 'installing') return null

  const percent = Math.round(progress * 100)
  const title =
    status === 'available'
      ? `Prism Mobile v${release?.version ?? ''} is ready`
      : status === 'downloading'
        ? `Downloading update… ${percent}%`
        : 'Update ready — finish installing'
  const subtitle =
    status === 'available'
      ? `You are on v${currentVersion}. Tap to see what changed.`
      : status === 'downloading'
        ? 'Keep the app open while the package downloads.'
        : 'Open the installer to complete the update.'

  return (
    <PressableScale
      onPress={openSheet}
      haptic="light"
      accessibilityRole="button"
      accessibilityLabel={title}
      style={[
        styles.root,
        { backgroundColor: `${theme.accent}14`, borderColor: `${theme.accent}44` }
      ]}
    >
      <View style={[styles.icon, { backgroundColor: `${theme.accent}24` }]}>
        <Ionicons name="cloud-download-outline" size={18} color={theme.accent} />
      </View>
      <View style={styles.text}>
        <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>{subtitle}</Text>
        {status === 'downloading' ? (
          <View style={[styles.track, { backgroundColor: theme.surface }]}>
            <View
              style={[
                styles.fill,
                { width: `${Math.max(2, percent)}%`, backgroundColor: theme.accent }
              ]}
            />
          </View>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
    </PressableScale>
  )
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md
  },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center'
  },
  text: {
    flex: 1,
    gap: 2
  },
  title: {
    ...typography.caption,
    fontWeight: '700',
    fontSize: 13
  },
  subtitle: {
    ...typography.caption,
    fontSize: 12,
    lineHeight: 16
  },
  track: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 4
  },
  fill: {
    height: '100%',
    borderRadius: 2
  }
})
