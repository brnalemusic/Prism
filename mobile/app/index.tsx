import { useCallback, useEffect, useRef, useState } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Redirect, router } from 'expo-router'
import { ChatWelcome } from '../src/components/ChatWelcome'
import { Composer } from '../src/components/Composer'
import { IconButton } from '../src/components/Buttons'
import { ModelSheet } from '../src/components/ModelSheet'
import { PrismMark } from '../src/components/PrismMark'
import { ScreenBackground } from '../src/components/ScreenBackground'
import { UpdateBanner } from '../src/components/UpdateBanner'
import { useDrawer } from '../src/components/ChatDrawer'
import { modelLabel } from '../src/lib/models'
import { useSessions } from '../src/state/sessions'
import { useSettings, useTheme } from '../src/state/settings'
import { spacing, type as typography } from '../src/theme/tokens'

/**
 * Home is a new conversation, not an inbox. Sending the first message creates
 * the session and hands it to the chat screen with an auto-send payload.
 */
export default function HomeScreen(): React.JSX.Element {
  const theme = useTheme()
  const { open, newChatToken } = useDrawer()
  const { providers, onboardingComplete, defaultProviderId, defaultModelId, setDefaultModel } =
    useSettings()
  const { createSession, streaming, stopStreaming } = useSessions()

  const [input, setInput] = useState('')
  const [creating, setCreating] = useState(false)
  const [focusSignal, setFocusSignal] = useState(0)
  const [modelSheet, setModelSheet] = useState(false)

  const hasProviders = providers.length > 0
  const currentModel = hasProviders
    ? modelLabel(providers, defaultProviderId, defaultModelId)
    : 'Add a provider'
  const seenNewChatToken = useRef(newChatToken)

  useEffect(() => {
    if (newChatToken === seenNewChatToken.current) return
    seenNewChatToken.current = newChatToken
    setInput('')
  }, [newChatToken])

  const focusComposer = useCallback(() => {
    setFocusSignal((value) => value + 1)
  }, [])

  const handleSuggestion = useCallback(
    (prompt: string) => {
      setInput(prompt)
      focusComposer()
    },
    [focusComposer]
  )

  const handleNewChat = useCallback(() => {
    setInput('')
    focusComposer()
  }, [focusComposer])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || creating || streaming) return
    if (!hasProviders) {
      router.push('/settings/providers')
      return
    }

    setCreating(true)
    try {
      const session = await createSession({
        providerId: defaultProviderId,
        modelId: defaultModelId
      })
      if (!session) {
        router.push('/settings/providers')
        return
      }
      setInput('')
      router.push({ pathname: '/chat/[id]', params: { id: session.id, send: text } })
    } finally {
      setCreating(false)
    }
  }, [createSession, creating, defaultModelId, defaultProviderId, hasProviders, input, streaming])

  if (!onboardingComplete) {
    return <Redirect href="/onboarding" />
  }

  return (
    <ScreenBackground>
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <IconButton icon="menu" label="Open conversations" variant="ghost" onPress={open} />
          <View style={styles.brand}>
            <PrismMark size={18} />
            <Text style={[styles.wordmark, { color: theme.text }]}>Prism</Text>
          </View>
          <IconButton
            icon="create-outline"
            label="New conversation"
            variant="ghost"
            onPress={handleNewChat}
          />
        </View>

        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
          >
            <UpdateBanner />
            <ChatWelcome
              hasProviders={hasProviders}
              onSuggestion={handleSuggestion}
              onSetup={() => router.push('/settings/providers')}
            />
          </ScrollView>

          <Composer
            value={input}
            onChangeText={setInput}
            onSend={() => void handleSend()}
            onStop={stopStreaming}
            streaming={Boolean(streaming)}
            modelLabel={currentModel}
            onOpenModel={() => {
              if (hasProviders) setModelSheet(true)
              else router.push('/settings/providers')
            }}
            focusSignal={focusSignal}
            placeholder="Ask anything…"
          />
        </KeyboardAvoidingView>
      </SafeAreaView>

      <ModelSheet
        visible={modelSheet}
        onClose={() => setModelSheet(false)}
        providerId={defaultProviderId}
        modelId={defaultModelId}
        onSelect={(providerId, modelId) => setDefaultModel(providerId, modelId)}
        onManage={() => router.push('/settings/providers')}
        subtitle="The model Prism will use for new conversations."
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    minHeight: 52
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm
  },
  wordmark: {
    ...typography.headline,
    fontSize: 17,
    letterSpacing: -0.3
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.md
  }
})
