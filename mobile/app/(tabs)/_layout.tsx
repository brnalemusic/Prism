import { Tabs } from 'expo-router/js-tabs'
import { TabBar } from '../../src/components/TabBar'

export default function TabsLayout(): React.JSX.Element {
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false, animation: 'shift' }}
    >
      <Tabs.Screen name="index" options={{ title: 'Chats' }} />
      <Tabs.Screen name="prompts" options={{ title: 'Prompts' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
  )
}
