import { useMemo, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { PROMPT_CATEGORIES, STARTER_PROMPTS, type StarterPrompt } from '../src/ai/prompts'
import { PressableScale } from '../src/components/PressableScale'
import { ScreenBackground } from '../src/components/ScreenBackground'
import { ScreenHeader } from '../src/components/ScreenHeader'
import { useSessions } from '../src/state/sessions'
import { useSettings, useTheme } from '../src/state/settings'
import { radius, spacing, type as typography } from '../src/theme/tokens'

type Filter = 'All' | StarterPrompt['category']
const FILTERS: Filter[] = ['All', ...PROMPT_CATEGORIES]

export default function PromptsScreen(): React.JSX.Element {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { defaultProviderId, defaultModelId } = useSettings()
  const { createSession } = useSessions()
  const [filter, setFilter] = useState<Filter>('All')
  const [busy, setBusy] = useState(false)

  const sections = useMemo(() => {
    const categories = filter === 'All' ? PROMPT_CATEGORIES : [filter]
    return categories
      .map((category) => ({
        category,
        items: STARTER_PROMPTS.filter((item) => item.category === category)
      }))
      .filter((section) => section.items.length > 0)
  }, [filter])

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
        <ScreenHeader
          title="Prompts"
          subtitle="Starting points you can edit"
          onBack={() => router.back()}
        />

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
                accessibilityState={{ selected: active }}
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

        <ScrollView
          contentContainerStyle={[styles.list, { paddingBottom: spacing.xxxl + insets.bottom }]}
          showsVerticalScrollIndicator={false}
        >
          {sections.map((section) => (
            <View key={section.category} style={styles.section}>
              <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>
                {section.category}
              </Text>
              <View
                style={[
                  styles.group,
                  { backgroundColor: theme.surface, borderColor: theme.border }
                ]}
              >
                {section.items.map((prompt, index) => (
                  <View key={prompt.id}>
                    {index > 0 ? (
                      <View
                        style={[
                          styles.separator,
                          { backgroundColor: theme.border, marginLeft: 42 }
                        ]}
                      />
                    ) : null}
                    <PressableScale
                      onPress={() => void start(prompt)}
                      disabled={busy}
                      haptic="light"
                      accessibilityRole="button"
                      accessibilityLabel={prompt.title}
                      style={styles.row}
                    >
                      <Ionicons name={prompt.icon as never} size={18} color={theme.accent} />
                      <View style={styles.rowText}>
                        <Text style={[styles.rowTitle, { color: theme.text }]}>{prompt.title}</Text>
                        <Text
                          style={[styles.rowSubtitle, { color: theme.textSecondary }]}
                          numberOfLines={1}
                        >
                          {prompt.subtitle}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={15} color={theme.textMuted} />
                    </PressableScale>
                  </View>
                ))}
              </View>
            </View>
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
  filtersWrap: {
    flexGrow: 0,
    marginTop: spacing.sm
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
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxxl,
    gap: spacing.xl
  },
  section: {
    gap: spacing.sm
  },
  sectionLabel: {
    ...typography.micro,
    fontSize: 10.5,
    marginLeft: spacing.xs
  },
  group: {
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden'
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    minHeight: 62
  },
  separator: {
    height: StyleSheet.hairlineWidth
  },
  rowText: {
    flex: 1,
    gap: 2
  },
  rowTitle: {
    ...typography.callout,
    fontWeight: '600',
    fontSize: 15
  },
  rowSubtitle: {
    ...typography.caption,
    fontSize: 12.5
  },
  footnote: {
    ...typography.caption,
    fontSize: 11.5,
    textAlign: 'center'
  }
})
