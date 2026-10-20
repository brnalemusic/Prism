import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../state/settings'
import { radius, spacing, type as typography } from '../theme/tokens'
import { PrimaryButton } from './Buttons'
import { PrismMark } from './PrismMark'
import { PressableScale } from './PressableScale'

interface EmptyChatsProps {
  onCreate: () => void
  onBrowsePrompts: () => void
  onStarter: (prompt: string) => void
}

const STARTERS = ['Plan my week', 'Debug this code', 'Explain like I am new']

export function EmptyChats({
  onCreate,
  onBrowsePrompts,
  onStarter
}: EmptyChatsProps): React.JSX.Element {
  const theme = useTheme()

  return (
    <View style={styles.root}>
      <View
        style={[styles.markTile, { backgroundColor: theme.surface, borderColor: theme.border }]}
      >
        <PrismMark size={54} glow />
      </View>
      <Text style={[styles.eyebrow, { color: theme.accent }]}>PRISM MOBILE</Text>
      <Text style={[styles.title, { color: theme.text }]}>A copilot that fits in your hand.</Text>
      <Text style={[styles.body, { color: theme.textSecondary }]}>
        One conversation, on the go. Your keys stay on the device and nothing is routed through a
        Prism server.
      </Text>

      <PrimaryButton
        label="Start a conversation"
        icon="add"
        onPress={onCreate}
        style={styles.cta}
      />

      <View style={styles.chips}>
        {STARTERS.map((starter) => (
          <PressableScale
            key={starter}
            onPress={() => onStarter(starter)}
            haptic="selection"
            accessibilityRole="button"
            accessibilityLabel={starter}
            style={[styles.chip, { backgroundColor: theme.surface, borderColor: theme.border }]}
          >
            <Text style={[styles.chipLabel, { color: theme.textSecondary }]}>{starter}</Text>
          </PressableScale>
        ))}
      </View>

      <PressableScale
        onPress={onBrowsePrompts}
        haptic="selection"
        accessibilityRole="button"
        accessibilityLabel="Browse the prompt library"
        style={styles.link}
      >
        <Text style={[styles.linkLabel, { color: theme.accent }]}>Browse the prompt library</Text>
      </PressableScale>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xl,
    alignItems: 'flex-start',
    gap: spacing.md
  },
  markTile: {
    width: 84,
    height: 84,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm
  },
  eyebrow: {
    ...typography.micro,
    letterSpacing: 1.6
  },
  title: {
    ...typography.display,
    fontSize: 30,
    lineHeight: 35
  },
  body: {
    ...typography.callout,
    maxWidth: 320
  },
  cta: {
    alignSelf: 'stretch',
    marginTop: spacing.sm
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs
  },
  chip: {
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: 8
  },
  chipLabel: {
    ...typography.caption,
    fontWeight: '600'
  },
  link: {
    paddingVertical: spacing.xs
  },
  linkLabel: {
    ...typography.caption,
    fontWeight: '600'
  }
})
