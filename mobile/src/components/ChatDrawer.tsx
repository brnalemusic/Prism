import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import {
  Alert,
  Animated,
  Keyboard,
  Modal,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { router, usePathname } from 'expo-router'
import type { ChatSession } from '../domain/types'
import { useKeyboardVisible } from '../hooks/useKeyboardVisible'
import { useSessions } from '../state/sessions'
import { useTheme } from '../state/settings'
import { DURATION, EASING } from '../theme/motion'
import { spacing, type as typography } from '../theme/tokens'
import { GlassSurface } from './GlassSurface'
import { KeyboardAwareView } from './KeyboardAwareView'
import { PressableScale } from './PressableScale'
import { PrismMark } from './PrismMark'
import { SessionRow } from './SessionRow'
import type { IconName } from './Buttons'

interface DrawerContextValue {
  isOpen: boolean
  /** Increments when the drawer asks for a fresh conversation. */
  newChatToken: number
  open: () => void
  close: () => void
  requestNewChat: () => void
}

const DrawerContext = createContext<DrawerContextValue | null>(null)

export function useDrawer(): DrawerContextValue {
  const context = useContext(DrawerContext)
  if (!context) throw new Error('useDrawer must be used inside DrawerProvider')
  return context
}

export function DrawerProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const [newChatToken, setNewChatToken] = useState(0)
  const open = useCallback(() => {
    Keyboard.dismiss()
    setIsOpen(true)
  }, [])
  const close = useCallback(() => {
    Keyboard.dismiss()
    setIsOpen(false)
  }, [])
  const requestNewChat = useCallback(() => {
    Keyboard.dismiss()
    setNewChatToken((token) => token + 1)
    setIsOpen(false)
  }, [])
  const value = useMemo<DrawerContextValue>(
    () => ({ isOpen, newChatToken, open, close, requestNewChat }),
    [close, isOpen, newChatToken, open, requestNewChat]
  )

  return <DrawerContext.Provider value={value}>{children}</DrawerContext.Provider>
}

interface DrawerSection {
  title: string
  data: ChatSession[]
}

const DAY = 24 * 60 * 60 * 1000

/**
 * History is bucketed the way chat apps read it: recent work first, then a
 * quiet archive. Search collapses everything into one result group.
 */
function buildSections(sessions: ChatSession[], query: string): DrawerSection[] {
  const term = query.trim().toLowerCase()
  const visible = term
    ? sessions.filter(
        (session) =>
          session.title.toLowerCase().includes(term) || session.preview.toLowerCase().includes(term)
      )
    : sessions

  if (term) return visible.length > 0 ? [{ title: 'Results', data: visible }] : []

  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const today: ChatSession[] = []
  const yesterday: ChatSession[] = []
  const week: ChatSession[] = []
  const older: ChatSession[] = []

  for (const session of visible) {
    if (session.updatedAt >= todayStart) today.push(session)
    else if (session.updatedAt >= todayStart - DAY) yesterday.push(session)
    else if (session.updatedAt >= todayStart - 7 * DAY) week.push(session)
    else older.push(session)
  }

  return [
    { title: 'Today', data: today },
    { title: 'Yesterday', data: yesterday },
    { title: 'Previous 7 days', data: week },
    { title: 'Older', data: older }
  ].filter((section) => section.data.length > 0)
}

interface DrawerLinkProps {
  icon: IconName
  label: string
  onPress: () => void
}

function DrawerLink({ icon, label, onPress }: DrawerLinkProps): React.JSX.Element {
  const theme = useTheme()
  return (
    <PressableScale
      onPress={onPress}
      haptic="selection"
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.footerLink}
    >
      <Ionicons name={icon} size={18} color={theme.textSecondary} />
      <Text style={[styles.footerLabel, { color: theme.text }]}>{label}</Text>
      <Ionicons name="chevron-forward" size={15} color={theme.textMuted} />
    </PressableScale>
  )
}

export function ChatDrawer(): React.JSX.Element {
  const { isOpen, close, requestNewChat } = useDrawer()
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const keyboardVisible = useKeyboardVisible()
  const pathname = usePathname()
  const { width } = useWindowDimensions()
  const { sessions, deleteSession } = useSessions()

  const [mounted, setMounted] = useState(false)
  const [query, setQuery] = useState('')
  const drawerWidth = Math.min(324, Math.round(width * 0.86))
  const translateX = useRef(new Animated.Value(-drawerWidth)).current
  const scrim = useRef(new Animated.Value(0)).current

  const sections = useMemo(() => buildSections(sessions, query), [query, sessions])

  useEffect(() => {
    if (isOpen) setMounted(true)
  }, [isOpen])

  useEffect(() => {
    if (!mounted) return
    if (isOpen) {
      translateX.setValue(-drawerWidth)
      scrim.setValue(0)
      Animated.parallel([
        Animated.timing(translateX, {
          toValue: 0,
          duration: DURATION.enter,
          easing: EASING.snappy,
          useNativeDriver: true
        }),
        Animated.timing(scrim, {
          toValue: 1,
          duration: DURATION.quick,
          easing: EASING.outExpo,
          useNativeDriver: true
        })
      ]).start()
      return
    }

    Animated.parallel([
      Animated.timing(translateX, {
        toValue: -drawerWidth,
        duration: DURATION.exit,
        easing: EASING.inOutSine,
        useNativeDriver: true
      }),
      Animated.timing(scrim, {
        toValue: 0,
        duration: DURATION.exit,
        easing: EASING.outExpo,
        useNativeDriver: true
      })
    ]).start(({ finished }) => {
      if (finished) setMounted(false)
    })
  }, [drawerWidth, isOpen, mounted, scrim, translateX])

  useEffect(() => {
    if (isOpen) setQuery('')
  }, [isOpen])

  const startNewChat = useCallback(() => {
    requestNewChat()
    router.navigate('/')
  }, [requestNewChat])

  const openSession = useCallback(
    (session: ChatSession) => {
      close()
      if (pathname === `/chat/${session.id}`) return
      router.push({ pathname: '/chat/[id]', params: { id: session.id } })
    },
    [close, pathname]
  )

  const confirmDelete = useCallback(
    (session: ChatSession) => {
      Alert.alert('Delete conversation?', `“${session.title}” will be removed from this device.`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => void deleteSession(session.id)
        }
      ])
    },
    [deleteSession]
  )

  const openPrompts = useCallback(() => {
    close()
    router.push('/prompts')
  }, [close])

  const openSettings = useCallback(() => {
    close()
    router.push('/settings')
  }, [close])

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={close}
    >
      <KeyboardAwareView style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: scrim }]}>
          <Pressable
            style={[StyleSheet.absoluteFill, styles.scrim]}
            onPress={close}
            accessibilityRole="button"
            accessibilityLabel="Close menu"
          />
        </Animated.View>

        <Animated.View
          style={[styles.panel, { width: drawerWidth, transform: [{ translateX }] }]}
          accessibilityViewIsModal
        >
          <GlassSurface
            variant="sheet"
            radiusSize={0}
            intensity={54}
            bordered={false}
            style={[
              styles.surface,
              {
                paddingTop: insets.top + spacing.sm,
                paddingBottom: keyboardVisible ? spacing.sm : Math.max(insets.bottom, spacing.sm),
                borderRightColor: theme.borderStrong
              }
            ]}
          >
            <View style={styles.header}>
              <View style={styles.brand}>
                <PrismMark size={22} />
                <Text style={[styles.wordmark, { color: theme.text }]}>Prism</Text>
              </View>
              <PressableScale
                onPress={close}
                haptic="light"
                accessibilityRole="button"
                accessibilityLabel="Close menu"
                style={styles.close}
              >
                <Ionicons name="close" size={21} color={theme.textSecondary} />
              </PressableScale>
            </View>

            <PressableScale
              onPress={startNewChat}
              haptic="medium"
              accessibilityRole="button"
              accessibilityLabel="New conversation"
              style={[
                styles.newChat,
                { backgroundColor: theme.surfaceRaised, borderColor: theme.border }
              ]}
            >
              <Ionicons name="create-outline" size={18} color={theme.accent} />
              <Text style={[styles.newChatLabel, { color: theme.text }]}>New conversation</Text>
              <Ionicons name="chevron-forward" size={15} color={theme.textMuted} />
            </PressableScale>

            {sessions.length > 0 ? (
              <View
                style={[
                  styles.search,
                  { backgroundColor: theme.surface, borderColor: theme.border }
                ]}
              >
                <Ionicons name="search" size={15} color={theme.textMuted} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search chats"
                  placeholderTextColor={theme.textMuted}
                  style={[styles.searchInput, { color: theme.text }]}
                  selectionColor={theme.accent}
                  accessibilityLabel="Search conversations"
                />
                {query ? (
                  <Pressable
                    onPress={() => setQuery('')}
                    accessibilityLabel="Clear search"
                    hitSlop={8}
                    style={styles.searchClear}
                  >
                    <Ionicons name="close-circle" size={15} color={theme.textMuted} />
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            <SectionList
              sections={sections}
              keyExtractor={(item) => item.id}
              style={styles.list}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              stickySectionHeadersEnabled={false}
              renderSectionHeader={({ section }) => (
                <Text style={[styles.sectionTitle, { color: theme.textMuted }]}>
                  {section.title}
                </Text>
              )}
              renderItem={({ item }) => (
                <SessionRow
                  session={item}
                  active={pathname === `/chat/${item.id}`}
                  onPress={() => openSession(item)}
                  onLongPress={() => confirmDelete(item)}
                />
              )}
              ListEmptyComponent={
                <Text style={[styles.empty, { color: theme.textMuted }]}>
                  {query ? `No chats match “${query}”.` : 'Your conversations will appear here.'}
                </Text>
              }
            />

            <View style={[styles.footer, { borderTopColor: theme.border }]}>
              <DrawerLink icon="sparkles-outline" label="Prompt library" onPress={openPrompts} />
              <DrawerLink icon="settings-outline" label="Settings" onPress={openSettings} />
            </View>
          </GlassSurface>
        </Animated.View>
      </KeyboardAwareView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1
  },
  scrim: {
    backgroundColor: 'rgba(0, 0, 0, 0.58)'
  },
  panel: {
    flex: 1,
    alignSelf: 'flex-start'
  },
  surface: {
    flex: 1,
    borderRightWidth: StyleSheet.hairlineWidth
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm
  },
  wordmark: {
    ...typography.headline,
    fontSize: 18
  },
  close: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center'
  },
  newChat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    minHeight: 44
  },
  newChatLabel: {
    ...typography.callout,
    fontWeight: '600',
    flex: 1
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.sm + 2,
    height: 38
  },
  searchInput: {
    ...typography.callout,
    flex: 1,
    height: '100%',
    fontSize: 14
  },
  searchClear: {
    alignItems: 'center',
    justifyContent: 'center'
  },
  list: {
    flex: 1,
    marginTop: spacing.sm
  },
  listContent: {
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm
  },
  sectionTitle: {
    ...typography.micro,
    fontSize: 10,
    paddingHorizontal: spacing.sm + 2,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs
  },
  empty: {
    ...typography.callout,
    fontSize: 14,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm
  },
  footerLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 11,
    borderRadius: 10
  },
  footerLabel: {
    ...typography.callout,
    fontSize: 14.5,
    flex: 1
  }
})
