import { StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../state/settings'
import { radius, spacing, type as typography } from '../theme/tokens'
import type { IconName } from './Buttons'
import { PressableScale } from './PressableScale'
import { PrismMark } from './PrismMark'

interface ChatWelcomeProps {
  hasProviders: boolean
  onSuggestion: (prompt: string) => void
  onSetup: () => void
}

interface Suggestion {
  icon: IconName
  label: string
  prompt: string
}

const SUGGESTIONS: Suggestion[] = [
  {
    icon: 'bulb-outline',
    label: 'Explain a tricky idea',
    prompt:
      'Explain a tricky idea to me in plain language. Use one analogy and three key points:\n\n'
  },
  {
    icon: 'mail-outline',
    label: 'Draft a reply',
    prompt: 'Draft a short, warm reply to this message:\n\n'
  },
  {
    icon: 'bug-outline',
    label: 'Debug some code',
    prompt: 'Find the bug in this code, explain the cause, and give the smallest fix:\n\n```\n\n```'
  },
  {
    icon: 'calendar-outline',
    label: 'Plan something',
    prompt: 'Help me plan this. Ask what matters most, then propose a realistic plan:\n\n'
  }
]

function greetingFor(hour: number): string {
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

/**
 * The home screen is a new conversation, not a dashboard: a greeting, four
 * quiet starting points and the composer below. History lives in the drawer.
 */
export function ChatWelcome({
  hasProviders,
  onSuggestion,
  onSetup
}: ChatWelcomeProps): React.JSX.Element {
  const theme = useTheme()

  return (
    <View style={styles.root}>
      <View style={styles.intro}>
        <PrismMark size={38} glow />
        <Text style={[styles.greeting, { color: theme.textMuted }]}>
          {greetingFor(new Date().getHours())}
        </Text>
        <Text style={[styles.title, { color: theme.text }]}>What’s on your mind?</Text>
        <Text style={[styles.body, { color: theme.textSecondary }]}>
          Ask anything. Prism answers with your own provider, and your keys stay on this device.
        </Text>
      </View>

      {hasProviders ? (
        <View style={styles.grid}>
          {SUGGESTIONS.map((suggestion) => (
            <PressableScale
              key={suggestion.label}
              onPress={() => onSuggestion(suggestion.prompt)}
              haptic="selection"
              accessibilityRole="button"
              accessibilityLabel={suggestion.label}
              style={[
                styles.suggestion,
                { backgroundColor: theme.surface, borderColor: theme.border }
              ]}
            >
              <Ionicons name={suggestion.icon} size={19} color={theme.accent} />
              <Text style={[styles.suggestionLabel, { color: theme.textSecondary }]}>
                {suggestion.label}
              </Text>
            </PressableScale>
          ))}
        </View>
      ) : (
        <PressableScale
          onPress={onSetup}
          haptic="light"
          accessibilityRole="button"
          accessibilityLabel="Add an API key"
          style={[
            styles.setup,
            { backgroundColor: `${theme.accent}12`, borderColor: `${theme.accent}3D` }
          ]}
        >
          <View style={[styles.setupIcon, { backgroundColor: `${theme.accent}24` }]}>
            <Ionicons name="key-outline" size={18} color={theme.accent} />
          </View>
          <View style={styles.setupText}>
            <Text style={[styles.setupTitle, { color: theme.text }]}>Add an API key to start</Text>
            <Text style={[styles.setupBody, { color: theme.textSecondary }]}>
              Prism talks to your provider directly. Nothing is routed through a Prism server.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
        </PressableScale>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: spacing.xxl
  },
  intro: {
    alignItems: 'center',
    gap: spacing.sm
  },
  greeting: {
    ...typography.callout,
    fontSize: 14,
    marginTop: spacing.sm
  },
  title: {
    ...typography.display,
    fontSize: 30,
    lineHeight: 36,
    textAlign: 'center'
  },
  body: {
    ...typography.callout,
    fontSize: 14.5,
    lineHeight: 21,
    textAlign: 'center',
    maxWidth: 300
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm
  },
  suggestion: {
    flexGrow: 1,
    flexBasis: '46%',
    minHeight: 82,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    justifyContent: 'space-between',
    gap: spacing.md
  },
  suggestionLabel: {
    ...typography.callout,
    fontSize: 14.5,
    lineHeight: 19,
    fontWeight: '600'
  },
  setup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md
  },
  setupIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center'
  },
  setupText: {
    flex: 1,
    gap: 2
  },
  setupTitle: {
    ...typography.callout,
    fontWeight: '700',
    fontSize: 14.5
  },
  setupBody: {
    ...typography.caption,
    fontSize: 12.5,
    lineHeight: 17
  }
})
