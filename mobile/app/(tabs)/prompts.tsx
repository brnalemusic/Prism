import { useMemo, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { PROMPT_CATEGORIES, STARTER_PROMPTS, type StarterPrompt } from '../../src/ai/prompts'
import { PressableScale } from '../../src/components/PressableScale'
import { ScreenBackground } from '../../src/components/ScreenBackground'
import { useSessions } from '../../src/state/sessions'
import { useSettings, useTheme } from '../../src/state/settings'
import { radius, spacing, type as typography } from '../../src/theme/tokens'

type Filter = 'All' | StarterPrompt['category']
const FILTERS: Filter[] = ['All', ...PROMPT_CATEGORIES]

export default function PromptsScreen(): React.JSX.Element {
  const theme = useTheme()
  const { defaultProviderId, defaultModelId } = useSettings()
  const { createSession } = useSessions()
  const [filter, setFilter] = useState<Filter>('All')
  const [busy, setBusy] = useState(false)

  const prompts = useMemo(
    () =>
      filter === 'All'
        ? STARTER_PROMPTS
        : STARTER_PROMPTS.filter((item) => item.category === filter),
    [filter]
  )

  const start = async (prompt: StarterPrompt): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const session = await createSession({
        providerId: defaultProviderId,
        modelId: defaultModelId,
        title: prompt.title
      })
      if (!session) {
        router.push('/settings/providers')
        return
      }
      router.push({ pathname: '/chat/[id]', params: { id: session.id, draft: prompt.prompt } })
    } finally {
      setBusy(false)
    }
  }

  return (
    <ScreenBackground>
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: theme.text }]}>Prompt library</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
            Starting points tuned for a phone-sized conversation. Tap one to open it in a new
            session, then edit before you send.
          </Text>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
          style={styles.filtersWrap}
        >
          {FILTERS.map((option) => {
            const active = option === filter
            return (
              <PressableScale
                key={option}
                onPress={() => setFilter(option)}
                haptic="selection"
                accessibilityRole="button"
                accessibilityLabel={option}
                style={[
                  styles.filter,
                  {
                    backgroundColor: active ? `${theme.accent}1F` : theme.surface,
                    borderColor: active ? `${theme.accent}66` : theme.border
                  }
                ]}
              >
                <Text
                  style={[
                    styles.filterLabel,
                    { color: active ? theme.accent : theme.textSecondary }
                  ]}
                >
                  {option}
                </Text>
              </PressableScale>
            )
          })}
        </ScrollView>

        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {prompts.map((prompt) => (
            <PressableScale
              key={prompt.id}
              onPress={() => void start(prompt)}
              haptic="light"
              accessibilityRole="button"
              accessibilityLabel={prompt.title}
              style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
            >
              <View style={[styles.iconTile, { backgroundColor: `${theme.accent}18` }]}>
                <Ionicons name={prompt.icon as never} size={20} color={theme.accent} />
              </View>
              <View style={styles.cardText}>
                <Text style={[styles.cardTitle, { color: theme.text }]}>{prompt.title}</Text>
                <Text
                  style={[styles.cardSubtitle, { color: theme.textSecondary }]}
                  numberOfLines={2}
                >
                  {prompt.subtitle}
                </Text>
                <Text style={[styles.cardCategory, { color: theme.textMuted }]}>
                  {prompt.category}
                </Text>
              </View>
              <Ionicons name="arrow-forward" size={16} color={theme.textMuted} />
            </PressableScale>
          ))}
          <Text style={[styles.footnote, { color: theme.textMuted }]}>
            Prompts are local to the app — nothing here is uploaded until you send.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </ScreenBackground>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.sm
  },
  title: {
    ...typography.display,
    fontSize: 30,
    lineHeight: 35
  },
  subtitle: {
    ...typography.callout,
    fontSize: 14,
    lineHeight: 20
  },
  filtersWrap: {
    flexGrow: 0,
    marginTop: spacing.md
  },
  filters: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    paddingVertical: 2
  },
  filter: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth
  },
  filterLabel: {
    ...typography.caption,
    fontWeight: '600'
  },
  list: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: 132,
    gap: spacing.sm
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md
  },
  iconTile: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center'
  },
  cardText: {
    flex: 1,
    gap: 2
  },
  cardTitle: {
    ...typography.headline,
    fontSize: 16
  },
  cardSubtitle: {
    ...typography.caption,
    lineHeight: 17
  },
  cardCategory: {
    ...typography.micro,
    fontSize: 9.5
  },
  footnote: {
    ...typography.caption,
    fontSize: 11.5,
    marginTop: spacing.sm,
    textAlign: 'center'
  }
})
