import { useCallback, useMemo, useState } from 'react'
import { Alert, FlatList, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Redirect, router } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { EmptyChats } from '../../src/components/EmptyChats'
import { IconButton } from '../../src/components/Buttons'
import { PrismMark } from '../../src/components/PrismMark'
import { ScreenBackground } from '../../src/components/ScreenBackground'
import { SessionRow } from '../../src/components/SessionRow'
import { UpdateBanner } from '../../src/components/UpdateBanner'
import { modelLabel } from '../../src/lib/models'
import { useSessions } from '../../src/state/sessions'
import { useSettings, useTheme } from '../../src/state/settings'
import { radius, spacing, type as typography } from '../../src/theme/tokens'

export default function ChatsScreen(): React.JSX.Element {
  const theme = useTheme()
  const { providers, onboardingComplete, defaultProviderId, defaultModelId } = useSettings()
  const { sessions, createSession, deleteSession, ready } = useSessions()
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return sessions
    return sessions.filter(
      (session) =>
        session.title.toLowerCase().includes(term) || session.preview.toLowerCase().includes(term)
    )
  }, [query, sessions])

  const startChat = useCallback(
    async (draft?: string, title?: string) => {
      if (creating) return
      setCreating(true)
      try {
        const session = await createSession({
          providerId: defaultProviderId,
          modelId: defaultModelId,
          title
        })
        if (!session) {
          router.push('/settings/providers')
          return
        }
        router.push(
          draft
            ? { pathname: '/chat/[id]', params: { id: session.id, draft } }
            : { pathname: '/chat/[id]', params: { id: session.id } }
        )
      } finally {
        setCreating(false)
      }
    },
    [createSession, creating, defaultModelId, defaultProviderId]
  )

  const confirmDelete = useCallback(
    (sessionId: string, title: string) => {
      Alert.alert('Delete conversation?', `“${title}” will be removed from this device.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => void deleteSession(sessionId) }
      ])
    },
    [deleteSession]
  )

  if (ready && !onboardingComplete) {
    return <Redirect href="/onboarding" />
  }

  return (
    <ScreenBackground ambient>
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <View style={styles.identity}>
            <View
              style={[
                styles.markTile,
                { backgroundColor: theme.surface, borderColor: theme.border }
              ]}
            >
              <PrismMark size={22} />
            </View>
            <View style={styles.identityText}>
              <Text style={[styles.wordmark, { color: theme.text }]}>Prism</Text>
              <Text style={[styles.badge, { color: theme.accent }]}>MOBILE</Text>
            </View>
          </View>
          <IconButton
            icon="add"
            label="New conversation"
            variant="accent"
            onPress={() => void startChat()}
            disabled={creating}
          />
        </View>

        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
          ListHeaderComponent={
            <View style={styles.listHeader}>
              <UpdateBanner />
              {providers.length === 0 ? (
                <View
                  style={[
                    styles.setupBanner,
                    { backgroundColor: `${theme.accent}14`, borderColor: `${theme.accent}44` }
                  ]}
                >
                  <Ionicons name="key-outline" size={18} color={theme.accent} />
                  <View style={styles.bannerText}>
                    <Text style={[styles.bannerTitle, { color: theme.text }]}>
                      Add your API key
                    </Text>
                    <Text style={[styles.bannerBody, { color: theme.textSecondary }]}>
                      Prism Mobile talks to providers directly. Nothing is stored in the cloud.
                    </Text>
                  </View>
                  <IconButton
                    icon="chevron-forward"
                    label="Open providers"
                    size={34}
                    onPress={() => router.push('/settings/providers')}
                  />
                </View>
              ) : null}

              {sessions.length > 0 ? (
                <>
                  <View
                    style={[
                      styles.search,
                      { backgroundColor: theme.surface, borderColor: theme.border }
                    ]}
                  >
                    <Ionicons name="search" size={16} color={theme.textMuted} />
                    <TextInput
                      value={query}
                      onChangeText={setQuery}
                      placeholder="Search conversations"
                      placeholderTextColor={theme.textMuted}
                      style={[styles.searchInput, { color: theme.text }]}
                      selectionColor={theme.accent}
                      accessibilityLabel="Search conversations"
                    />
                    {query ? (
                      <Ionicons
                        name="close-circle"
                        size={16}
                        color={theme.textMuted}
                        onPress={() => setQuery('')}
                      />
                    ) : null}
                  </View>
                  <View style={styles.sectionRow}>
                    <Text style={[styles.sectionTitle, { color: theme.textMuted }]}>
                      {query ? 'Results' : 'Recent sessions'}
                    </Text>
                    <Text style={[styles.sectionCount, { color: theme.textMuted }]}>
                      {filtered.length}
                    </Text>
                  </View>
                </>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            sessions.length === 0 ? (
              <EmptyChats
                onCreate={() => void startChat()}
                onBrowsePrompts={() => router.push('/prompts')}
                onStarter={(prompt) => void startChat(prompt, 'New session')}
              />
            ) : (
              <View style={styles.noResults}>
                <Text style={[styles.noResultsText, { color: theme.textMuted }]}>
                  No conversations match “{query}”.
                </Text>
              </View>
            )
          }
          renderItem={({ item }) => (
            <SessionRow
              session={item}
              modelLabel={modelLabel(providers, item.providerId, item.modelId)}
              onPress={() => router.push({ pathname: '/chat/[id]', params: { id: item.id } })}
              onLongPress={() => confirmDelete(item.id, item.title)}
            />
          )}
        />
      </SafeAreaView>
    </ScreenBackground>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md
  },
  markTile: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center'
  },
  identityText: {
    gap: 0
  },
  wordmark: {
    ...typography.title,
    fontSize: 25,
    lineHeight: 28
  },
  badge: {
    ...typography.micro,
    fontSize: 9.5,
    letterSpacing: 2
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 132
  },
  listHeader: {
    gap: spacing.md
  },
  setupBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md
  },
  bannerText: {
    flex: 1,
    gap: 2
  },
  bannerTitle: {
    ...typography.caption,
    fontWeight: '700'
  },
  bannerBody: {
    ...typography.caption,
    fontSize: 12,
    lineHeight: 16
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    height: 44
  },
  searchInput: {
    ...typography.callout,
    flex: 1,
    height: '100%'
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    marginTop: spacing.xs
  },
  sectionTitle: {
    ...typography.micro
  },
  sectionCount: {
    ...typography.caption,
    fontSize: 12
  },
  noResults: {
    paddingTop: spacing.xxl,
    alignItems: 'center'
  },
  noResultsText: {
    ...typography.callout
  }
})
