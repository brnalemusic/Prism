import { useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import { useMarkdown, type MarkedStyles } from 'react-native-marked'
import { useTheme } from '../state/settings'
import { font, radius, spacing } from '../theme/tokens'

interface MarkdownBodyProps {
  content: string
}

/**
 * Markdown is rendered to native views (no WebView), which keeps selection,
 * text scaling and link handling feeling native on both platforms.
 */
export function MarkdownBody({ content }: MarkdownBodyProps): React.JSX.Element {
  const theme = useTheme()

  const markdownTheme = useMemo(
    () => ({
      colors: {
        text: theme.text,
        code: theme.surfaceStrong,
        link: theme.accent,
        border: theme.border
      },
      spacing: {
        xs: 2,
        s: 4,
        m: 8,
        l: 16
      }
    }),
    [theme]
  )

  const markdownStyles = useMemo<MarkedStyles>(
    () => ({
      text: { color: theme.text, fontFamily: font.regular, fontSize: 15.5, lineHeight: 23 },
      paragraph: { marginTop: 0, marginBottom: spacing.sm },
      h1: {
        color: theme.text,
        fontFamily: font.bold,
        fontSize: 21,
        lineHeight: 27,
        marginTop: spacing.sm,
        marginBottom: spacing.sm
      },
      h2: {
        color: theme.text,
        fontFamily: font.semibold,
        fontSize: 18,
        lineHeight: 24,
        marginTop: spacing.sm,
        marginBottom: 6
      },
      h3: {
        color: theme.text,
        fontFamily: font.semibold,
        fontSize: 16.5,
        lineHeight: 22,
        marginTop: 6,
        marginBottom: 4
      },
      h4: { color: theme.textSecondary, fontFamily: font.semibold, fontSize: 15.5, lineHeight: 21 },
      strong: { fontFamily: font.semibold, color: theme.text },
      em: { fontStyle: 'italic', color: theme.text },
      link: { color: theme.accent, textDecorationLine: 'underline' },
      codespan: {
        fontFamily: font.mono,
        fontSize: 13,
        color: theme.accentSoft,
        backgroundColor: theme.surfaceStrong,
        paddingHorizontal: 4,
        borderRadius: 5
      },
      code: {
        backgroundColor: theme.surfaceStrong,
        borderRadius: radius.sm,
        marginVertical: spacing.sm,
        padding: spacing.md,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.border
      },
      codeText: { fontFamily: font.mono, fontSize: 12.5, lineHeight: 18, color: theme.text },
      blockquote: {
        borderLeftWidth: 2,
        borderLeftColor: theme.accent,
        paddingLeft: spacing.md,
        marginVertical: 6,
        opacity: 0.92
      },
      list: { marginVertical: 2 },
      li: { color: theme.text, fontFamily: font.regular, fontSize: 15.5, lineHeight: 23 },
      hr: {
        backgroundColor: theme.border,
        height: StyleSheet.hairlineWidth,
        marginVertical: spacing.md
      },
      table: { borderColor: theme.border, borderWidth: StyleSheet.hairlineWidth, borderRadius: 8 },
      tableRow: { borderColor: theme.border },
      tableCell: { borderColor: theme.border, padding: 6 }
    }),
    [theme]
  )

  const elements = useMarkdown(content, {
    colorScheme: 'dark',
    theme: markdownTheme,
    styles: markdownStyles,
    selectable: true
  })

  return <View style={styles.root}>{elements}</View>
}

const styles = StyleSheet.create({
  root: {
    flexShrink: 1
  }
})
