import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { THEME_LIST, type ThemePalette, type ThemeKey } from '../theme/themes'
import { useSettings, useTheme } from '../state/settings'
import { radius, spacing, type as typography } from '../theme/tokens'
import { PressableScale } from './PressableScale'

interface SwatchProps {
  palette: ThemePalette
  selected: boolean
  onPress: () => void
  size?: number
  showName?: boolean
}

function Swatch({
  palette,
  selected,
  onPress,
  size = 46,
  showName = true
}: SwatchProps): React.JSX.Element {
  const theme = useTheme()
  return (
    <PressableScale
      onPress={onPress}
      haptic="selection"
      accessibilityRole="button"
      accessibilityLabel={`${palette.name} theme`}
      accessibilityState={{ selected }}
      style={styles.swatchItem}
    >
      <View
        style={[
          styles.swatchRing,
          {
            borderColor: selected ? palette.accent : 'transparent',
            width: size + 8,
            height: size + 8,
            borderRadius: (size + 8) / 2
          }
        ]}
      >
        <LinearGradient
          colors={[palette.accent, palette.accentSoft, palette.accentDeep]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.swatch, { width: size, height: size, borderRadius: size / 2 }]}
        >
          {selected ? <Ionicons name="checkmark" size={18} color={palette.background} /> : null}
        </LinearGradient>
      </View>
      {showName ? (
        <Text
          style={[styles.swatchName, { color: selected ? theme.text : theme.textMuted }]}
          numberOfLines={1}
        >
          {palette.name}
        </Text>
      ) : null}
    </PressableScale>
  )
}

export function ThemeRow(): React.JSX.Element {
  const { themeKey, setThemeKey } = useSettings()
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      accessibilityRole="radiogroup"
    >
      {THEME_LIST.map((palette) => (
        <Swatch
          key={palette.key}
          palette={palette}
          selected={palette.key === themeKey}
          onPress={() => setThemeKey(palette.key)}
        />
      ))}
    </ScrollView>
  )
}

export function ThemeGrid(): React.JSX.Element {
  const { themeKey, setThemeKey } = useSettings()
  const activeTheme = useTheme()

  return (
    <View style={styles.grid}>
      {THEME_LIST.map((palette) => {
        const selected = palette.key === themeKey
        return (
          <PressableScale
            key={palette.key}
            onPress={() => setThemeKey(palette.key)}
            haptic="selection"
            accessibilityRole="button"
            accessibilityLabel={`${palette.name} theme`}
            accessibilityState={{ selected }}
            style={[
              styles.card,
              {
                borderColor: selected ? palette.accent : activeTheme.border,
                backgroundColor: activeTheme.surface
              }
            ]}
          >
            <LinearGradient
              colors={[palette.backgroundTop, palette.background]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.cardPreview}
            >
              <View
                style={[
                  styles.previewBubble,
                  { backgroundColor: `${palette.accent}2E`, borderColor: `${palette.accent}66` }
                ]}
              />
              <View
                style={[styles.previewLine, { backgroundColor: palette.text, opacity: 0.75 }]}
              />
              <View
                style={[styles.previewLineShort, { backgroundColor: palette.text, opacity: 0.4 }]}
              />
              <View style={[styles.previewPill, { backgroundColor: palette.accent }]} />
            </LinearGradient>
            <View style={styles.cardFooter}>
              <View style={styles.cardText}>
                <Text style={[styles.cardName, { color: activeTheme.text }]}>{palette.name}</Text>
                <Text
                  style={[styles.cardTagline, { color: activeTheme.textMuted }]}
                  numberOfLines={1}
                >
                  {palette.tagline}
                </Text>
              </View>
              {selected ? (
                <Ionicons name="checkmark-circle" size={18} color={palette.accent} />
              ) : null}
            </View>
          </PressableScale>
        )
      })}
    </View>
  )
}

export function themeLabel(key: ThemeKey): string {
  return THEME_LIST.find((palette) => palette.key === key)?.name ?? 'Marine'
}

const styles = StyleSheet.create({
  row: {
    gap: spacing.md,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs
  },
  swatchItem: {
    alignItems: 'center',
    gap: 6,
    width: 72
  },
  swatchRing: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2
  },
  swatch: {
    alignItems: 'center',
    justifyContent: 'center'
  },
  swatchName: {
    ...typography.caption,
    fontSize: 11.5,
    textAlign: 'center'
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md
  },
  card: {
    width: '47.5%',
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden'
  },
  cardPreview: {
    height: 92,
    padding: spacing.md,
    justifyContent: 'flex-end',
    gap: 5
  },
  previewBubble: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    width: '52%',
    height: 26,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth
  },
  previewLine: {
    height: 6,
    width: '72%',
    borderRadius: 3
  },
  previewLineShort: {
    height: 6,
    width: '48%',
    borderRadius: 3
  },
  previewPill: {
    height: 8,
    width: 28,
    borderRadius: 4,
    marginTop: 2
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: 10
  },
  cardText: {
    flex: 1,
    gap: 1
  },
  cardName: {
    ...typography.caption,
    fontWeight: '700',
    fontSize: 13.5
  },
  cardTagline: {
    ...typography.caption,
    fontSize: 11
  }
})
