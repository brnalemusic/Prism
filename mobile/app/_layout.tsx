import { useEffect } from 'react'
import { View } from 'react-native'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import * as SplashScreen from 'expo-splash-screen'
import * as SystemUI from 'expo-system-ui'
import { SettingsProvider, useSettings } from '../src/state/settings'
import { SessionsProvider, useSessions } from '../src/state/sessions'
import { UpdatesProvider } from '../src/state/updates'
import { ChatDrawer, DrawerProvider } from '../src/components/ChatDrawer'
import { UpdateSheet } from '../src/components/UpdateSheet'

void SplashScreen.preventAutoHideAsync().catch(() => undefined)

function RootNavigator(): React.JSX.Element {
  const { ready: settingsReady, theme } = useSettings()
  const { ready: sessionsReady } = useSessions()
  const ready = settingsReady && sessionsReady

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(theme.background).catch(() => undefined)
  }, [theme.background])

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => undefined)
  }, [ready])

  if (!ready) {
    return <View style={{ flex: 1, backgroundColor: theme.background }} />
  }

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.background }
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="prompts" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="chat/[id]" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="settings/index" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="settings/providers" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="settings/provider" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="settings/appearance" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="settings/about" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="onboarding" options={{ animation: 'fade', gestureEnabled: false }} />
      </Stack>
      <ChatDrawer />
      <UpdateSheet />
    </>
  )
}

export default function RootLayout(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <SessionsProvider>
          <UpdatesProvider>
            <DrawerProvider>
              <RootNavigator />
            </DrawerProvider>
          </UpdatesProvider>
        </SessionsProvider>
      </SettingsProvider>
    </SafeAreaProvider>
  )
}
