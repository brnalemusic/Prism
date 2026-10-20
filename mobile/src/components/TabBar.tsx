import { StyleSheet, Text, View } from 'react-native'
import type { BottomTabBarProps } from 'expo-router/js-tabs'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../state/settings'
import { radius, spacing, type as typography } from '../theme/tokens'
import { GlassSurface } from './GlassSurface'
import { PressableScale } from './PressableScale'
import type { IconName } from './Buttons'

const TAB_META: Record<string, { label: string; icon: IconName; activeIcon: IconName }> = {
  index: { label: 'Chats', icon: 'chatbubble-ellipses-outline', activeIcon: 'chatbubble-ellipses' },
  prompts: { label: 'Prompts', icon: 'sparkles-outline', activeIcon: 'sparkles' },
  settings: { label: 'Settings', icon: 'options-outline', activeIcon: 'options' }
}

/**
 * Floating glass tab bar: reachable with one thumb, above the home indicator,
 * and visually detached from the content it floats over.
 */
export function TabBar({ state, navigateToTab, insets }: BottomTabBarProps): React.JSX.Element {
  const theme = useTheme()

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrapper, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}
    >
      <GlassSurface
        radiusSize={radius.pill}
        intensity={60}
        style={[styles.bar, { backgroundColor: theme.surfaceStrong }]}
      >
        {state.routes.map((route, index) => {
          const focused = state.index === index
          const meta = TAB_META[route.name] ?? {
            label: route.name,
            icon: 'ellipse-outline' as IconName,
            activeIcon: 'ellipse' as IconName
          }

          const onPress = (): void => {
            if (!focused) navigateToTab(route.key)
          }

          return (
            <PressableScale
              key={route.key}
              onPress={onPress}
              haptic="selection"
              accessibilityRole="tab"
              accessibilityLabel={meta.label}
              accessibilityState={{ selected: focused }}
              style={[styles.tab, focused ? { backgroundColor: `${theme.accent}1F` } : null]}
            >
              <Ionicons
                name={focused ? meta.activeIcon : meta.icon}
                size={21}
                color={focused ? theme.accent : theme.textMuted}
              />
              <Text
                style={[styles.label, { color: focused ? theme.accent : theme.textMuted }]}
                numberOfLines={1}
              >
                {meta.label}
              </Text>
            </PressableScale>
          )
        })}
      </GlassSurface>
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    alignItems: 'center'
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 6,
    gap: 4,
    alignSelf: 'stretch'
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingVertical: 8,
    borderRadius: radius.pill,
    minHeight: 50
  },
  label: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '600'
  }
})
