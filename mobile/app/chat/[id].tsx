import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { Composer } from '../../src/components/Composer'
import { IconButton, PrimaryButton } from '../../src/components/Buttons'
import { KeyboardAwareView } from '../../src/components/KeyboardAwareView'
import { MessageBubble } from '../../src/components/MessageBubble'
import { ModelSheet } from '../../src/components/ModelSheet'
import { PrismMark } from '../../src/components/PrismMark'
import { ScreenBackground } from '../../src/components/ScreenBackground'
import { ScreenHeader } from '../../src/components/ScreenHeader'
import { Sheet } from '../../src/components/Sheet'
import { PressableScale } from '../../src/components/PressableScale'
import type { ChatMessage } from '../../src/domain/types'
import { useKeyboardVisible } from '../../src/hooks/useKeyboardVisible'
import { modelLabel } from '../../src/lib/models'
import { useSessions } from '../../src/state/sessions'
import { useSettings, useTheme } from '../../src/state/settings'
import { elevation, radius, spacing, type as typography } from '../../src/theme/tokens'

type SheetMode = 'none' | 'menu' | 'rename'

export default function ChatScreen(): React.JSX.Element {
  const theme = useTheme()
  const params = useLocalSearchParams<{ id?: string; draft?: string; send?: string }>()
  const sessionId = typeof params.id === 'string' ? params.id : ''
  const initialDraft = typeof params.draft === 'string' ? params.draft : ''
  const autoSend = typeof params.send === 'string' ? params.send : ''

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
  const [showJump, setShowJump] = useState(false)
  const keyboardVisible = useKeyboardVisible()
  const listRef = useRef<FlatList<ChatMessage>>(null)
  const stickToBottom = useRef(true)
  const autoSent = useRef<string | null>(null)

  const isStreaming = streaming?.sessionId === sessionId
  const isBusy = streaming !== null

  useEffect(() => {
    if (!sessionId) return
    void ensureLoaded(sessionId)
  }, [ensureLoaded, sessionId])

  useEffect(() => {
    if (!session) return
    setRenameValue(session.title)
  }, [session?.id, session?.title])

  /**
   * The home composer hands its first message to this screen through the
   * `send` param, so a new conversation starts streaming without a second tap.
   */
  useEffect(() => {
    if (!autoSend || !session || messages === undefined) return
    if (autoSent.current === autoSend) return
    autoSent.current = autoSend
    router.setParams({ send: '' })
    if (messages.length > 0) return
    stickToBottom.current = true
    void sendMessage(sessionId, autoSend)
  }, [autoSend, messages, sendMessage, session, sessionId])

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

  /**
   * Opening the keyboard shrinks the list without changing its content size,
   * so a conversation parked at the bottom needs an explicit nudge to stay
   * pinned to the latest reply.
   */
  useEffect(() => {
    if (!keyboardVisible) return
    const timer = setTimeout(() => scrollToEnd(true), 80)
    return () => clearTimeout(timer)
  }, [keyboardVisible, scrollToEnd])

  const lastAssistantId = useMemo(() => {
    if (!messages) return null
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]
      if (message?.role === 'assistant') return message.id
    }
    return null
  }, [messages])

  const jumpToBottom = useCallback(() => {
    stickToBottom.current = true
    setShowJump(false)
    listRef.current?.scrollToEnd({ animated: true })
  }, [])

  const handleSend = useCallback(() => {
    const text = input.trim()
    if (!text || isBusy) return
    setInput('')
    stickToBottom.current = true
    setShowJump(false)
    void sendMessage(sessionId, text)
  }, [input, isBusy, sendMessage, sessionId])

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
          <ScreenHeader title="Session" onBack={() => router.back()} backVariant="ghost" />
          <View style={styles.missing}>
            <Ionicons name="chatbubble-outline" size={28} color={theme.textMuted} />
            <Text style={[styles.missingText, { color: theme.textSecondary }]}>
              This conversation is no longer on this device.
            </Text>
            <PrimaryButton
              label="Back to home"
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
          centerTitle
          onBack={() => router.back()}
          backVariant="ghost"
          right={
            <IconButton
              icon="ellipsis-horizontal"
              label="Session options"
              variant="ghost"
              onPress={() => setSheetMode('menu')}
            />
          }
        />
        <KeyboardAwareView>
          <View style={styles.flex}>
            {!messages ? (
              <View style={styles.loading}>
                <ActivityIndicator color={theme.accent} />
              </View>
            ) : (
              <View style={styles.flex}>
                <FlatList
                  ref={listRef}
                  data={messages}
                  keyExtractor={(item) => item.id}
                  renderItem={({ item }) => (
                    <MessageBubble
                      message={item}
                      onRetry={
                        item.status === 'error' && !isBusy
                          ? () => void retryLast(sessionId)
                          : undefined
                      }
                      onRegenerate={
                        item.id === lastAssistantId && item.status !== 'error' && !isBusy
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
                  keyboardDismissMode="on-drag"
                  onContentSizeChange={() => scrollToEnd(false)}
                  onScroll={(event) => {
                    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
                    const distance = contentSize.height - contentOffset.y - layoutMeasurement.height
                    const atBottom = distance < 120
                    stickToBottom.current = atBottom
                    setShowJump((current) => (current === !atBottom ? current : !atBottom))
                  }}
                  scrollEventThrottle={64}
                  ListEmptyComponent={
                    <View style={styles.blank}>
                      <PrismMark size={30} />
                      <Text style={[styles.blankTitle, { color: theme.text }]}>Ask anything</Text>
                      <Text style={[styles.blankBody, { color: theme.textSecondary }]}>
                        Prism is ready with{' '}
                        {modelLabel(providers, session.providerId, session.modelId)}.
                      </Text>
                    </View>
                  }
                />
                {showJump ? (
                  <PressableScale
                    onPress={jumpToBottom}
                    haptic="light"
                    accessibilityRole="button"
                    accessibilityLabel="Scroll to latest message"
                    hitSlop={6}
                    style={[
                      styles.jump,
                      {
                        backgroundColor: theme.surfaceStrong,
                        borderColor: theme.borderStrong,
                        boxShadow: elevation.sm
                      }
                    ]}
                    scaleTo={0.92}
                  >
                    <Ionicons name="arrow-down" size={18} color={theme.text} />
                  </PressableScale>
                ) : null}
              </View>
            )}
            <Composer
              value={input}
              onChangeText={setInput}
              onSend={handleSend}
              onStop={stopStreaming}
              streaming={isBusy}
              modelLabel={modelLabel(providers, session.providerId, session.modelId)}
              onOpenModel={() => setModelSheet(true)}
              autoFocus={Boolean(initialDraft)}
            />
          </View>
        </KeyboardAwareView>
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
        dismissKeyboardOnOpen={false}
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
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.sm
  },
  blankTitle: {
    ...typography.title,
    fontSize: 22,
    marginTop: spacing.sm
  },
  blankBody: {
    ...typography.callout,
    textAlign: 'center'
  },
  jump: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: spacing.sm,
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center'
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
