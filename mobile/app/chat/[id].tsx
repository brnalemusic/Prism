import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { Composer } from '../../src/components/Composer'
import { IconButton, PrimaryButton } from '../../src/components/Buttons'
import { MessageBubble } from '../../src/components/MessageBubble'
import { ModelSheet } from '../../src/components/ModelSheet'
import { ScreenBackground } from '../../src/components/ScreenBackground'
import { ScreenHeader } from '../../src/components/ScreenHeader'
import { Sheet } from '../../src/components/Sheet'
import type { ChatMessage } from '../../src/domain/types'
import { modelLabel, providerLabel } from '../../src/lib/models'
import { useSessions } from '../../src/state/sessions'
import { useSettings, useTheme } from '../../src/state/settings'
import { radius, spacing, type as typography } from '../../src/theme/tokens'

type SheetMode = 'none' | 'menu' | 'rename'

export default function ChatScreen(): React.JSX.Element {
  const theme = useTheme()
  const params = useLocalSearchParams<{ id?: string; draft?: string }>()
  const sessionId = typeof params.id === 'string' ? params.id : ''
  const initialDraft = typeof params.draft === 'string' ? params.draft : ''

  const { providers, setDefaultModel } = useSettings()
  const {
    sessions,
    getMessages,
    ensureLoaded,
    sendMessage,
    retryLast,
    stopStreaming,
    streaming,
    renameSession,
    deleteSession,
    setSessionModel
  } = useSessions()

  const session = sessions.find((candidate) => candidate.id === sessionId)
  const messages = getMessages(sessionId)

  const [input, setInput] = useState(initialDraft)
  const [sheetMode, setSheetMode] = useState<SheetMode>('none')
  const [modelSheet, setModelSheet] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const listRef = useRef<FlatList<ChatMessage>>(null)
  const stickToBottom = useRef(true)

  const isStreaming = streaming?.sessionId === sessionId

  useEffect(() => {
    if (!sessionId) return
    void ensureLoaded(sessionId)
  }, [ensureLoaded, sessionId])

  useEffect(() => {
    if (!session) return
    setRenameValue(session.title)
  }, [session?.id, session?.title])

  const scrollToEnd = useCallback((animated: boolean) => {
    if (!stickToBottom.current) return
    listRef.current?.scrollToEnd({ animated })
  }, [])

  useEffect(() => {
    if (!messages || messages.length === 0) return
    const timer = setTimeout(() => scrollToEnd(true), 40)
    return () => clearTimeout(timer)
  }, [messages?.length, scrollToEnd])

  const lastContentLength = useMemo(() => {
    if (!messages || messages.length === 0) return 0
    return messages[messages.length - 1]?.content.length ?? 0
  }, [messages])

  useEffect(() => {
    if (isStreaming) scrollToEnd(true)
  }, [lastContentLength, isStreaming, scrollToEnd])

  const handleSend = useCallback(() => {
    const text = input.trim()
    if (!text || isStreaming) return
    setInput('')
    stickToBottom.current = true
    void sendMessage(sessionId, text)
  }, [input, isStreaming, sendMessage, sessionId])

  const handleDelete = useCallback(() => {
    if (!session) return
    Alert.alert(
      'Delete conversation?',
      'This removes the session and its messages from this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void deleteSession(session.id).then(() => router.back())
          }
        }
      ]
    )
  }, [deleteSession, session])

  if (!session) {
    return (
      <ScreenBackground>
        <SafeAreaView style={styles.root} edges={['top']}>
          <ScreenHeader title="Session" onBack={() => router.back()} />
          <View style={styles.missing}>
            <Ionicons name="chatbubble-outline" size={28} color={theme.textMuted} />
            <Text style={[styles.missingText, { color: theme.textSecondary }]}>
              This conversation is no longer on this device.
            </Text>
            <PrimaryButton
              label="Back to chats"
              onPress={() => router.replace('/')}
              style={{ alignSelf: 'stretch' }}
            />
          </View>
        </SafeAreaView>
      </ScreenBackground>
    )
  }

  return (
    <ScreenBackground>
      <SafeAreaView style={styles.root} edges={['top']}>
        <ScreenHeader
          title={session.title}
          subtitle={`${providerLabel(providers, session.providerId)} · ${modelLabel(providers, session.providerId, session.modelId)}`}
          onBack={() => router.back()}
          right={
            <IconButton
              icon="ellipsis-horizontal"
              label="Session options"
              onPress={() => setSheetMode('menu')}
            />
          }
        />
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={0}
        >
          <View style={styles.flex}>
            {!messages ? (
              <View style={styles.loading}>
                <ActivityIndicator color={theme.accent} />
              </View>
            ) : (
              <FlatList
                ref={listRef}
                data={messages}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <MessageBubble
                    message={item}
                    onRetry={
                      item.status === 'error' && !isStreaming
                        ? () => void retryLast(sessionId)
                        : undefined
                    }
                  />
                )}
                contentContainerStyle={[
                  styles.listContent,
                  messages.length === 0 ? styles.emptyList : null
                ]}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                onContentSizeChange={() => scrollToEnd(false)}
                onScroll={(event) => {
                  const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
                  stickToBottom.current =
                    contentSize.height - contentOffset.y - layoutMeasurement.height < 160
                }}
                scrollEventThrottle={64}
                ListEmptyComponent={
                  <View style={styles.blank}>
                    <Text style={[styles.blankTitle, { color: theme.text }]}>
                      This session is ready.
                    </Text>
                    <Text style={[styles.blankBody, { color: theme.textSecondary }]}>
                      Ask a question, paste a snippet, or think out loud. Prism answers with{' '}
                      {modelLabel(providers, session.providerId, session.modelId)}.
                    </Text>
                  </View>
                }
              />
            )}
            <Composer
              value={input}
              onChangeText={setInput}
              onSend={handleSend}
              onStop={stopStreaming}
              streaming={isStreaming}
              modelLabel={modelLabel(providers, session.providerId, session.modelId)}
              providerLabel={providerLabel(providers, session.providerId)}
              onOpenModel={() => setModelSheet(true)}
              autoFocus={Boolean(initialDraft)}
            />
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <Sheet
        visible={sheetMode === 'menu'}
        onClose={() => setSheetMode('none')}
        title="Session"
        subtitle={session.title}
      >
        <View style={styles.menu}>
          <PrimaryButton
            label="Rename"
            icon="pencil-outline"
            variant="surface"
            onPress={() => setSheetMode('rename')}
          />
          <PrimaryButton
            label="Delete conversation"
            icon="trash-outline"
            variant="danger"
            onPress={handleDelete}
          />
        </View>
      </Sheet>

      <Sheet
        visible={sheetMode === 'rename'}
        onClose={() => setSheetMode('none')}
        title="Rename session"
        subtitle="A short label shown in your chats list."
      >
        <TextInput
          value={renameValue}
          onChangeText={setRenameValue}
          placeholder="Session name"
          placeholderTextColor={theme.textMuted}
          selectionColor={theme.accent}
          style={[
            styles.renameInput,
            { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }
          ]}
          autoFocus
          maxLength={80}
          returnKeyType="done"
          onSubmitEditing={() => {
            renameSession(session.id, renameValue)
            setSheetMode('none')
          }}
        />
        <PrimaryButton
          label="Save name"
          onPress={() => {
            renameSession(session.id, renameValue)
            setSheetMode('none')
          }}
          style={{ marginTop: spacing.md }}
        />
      </Sheet>

      <ModelSheet
        visible={modelSheet}
        onClose={() => setModelSheet(false)}
        providerId={session.providerId}
        modelId={session.modelId}
        onSelect={(providerId, modelId) => {
          setSessionModel(session.id, providerId, modelId)
          setDefaultModel(providerId, modelId)
        }}
        onManage={() => router.push('/settings/providers')}
      />
    </ScreenBackground>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1
  },
  flex: {
    flex: 1
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    gap: spacing.xl
  },
  emptyList: {
    flexGrow: 1
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  blank: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.sm
  },
  blankTitle: {
    ...typography.title,
    fontSize: 22
  },
  blankBody: {
    ...typography.callout
  },
  missing: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.md
  },
  missingText: {
    ...typography.callout,
    textAlign: 'center'
  },
  menu: {
    gap: spacing.sm
  },
  renameInput: {
    ...typography.body,
    minHeight: 50,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md
  }
})
