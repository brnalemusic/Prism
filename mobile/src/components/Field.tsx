import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native'
import { useTheme } from '../state/settings'
import { radius, spacing, type as typography } from '../theme/tokens'

interface FieldProps extends TextInputProps {
  label: string
  hint?: string
  error?: string
}

export function Field({ label, hint, error, style, ...rest }: FieldProps): React.JSX.Element {
  const theme = useTheme()
  return (
    <View style={styles.root}>
      <Text style={[styles.label, { color: theme.textMuted }]}>{label}</Text>
      <TextInput
        {...rest}
        placeholderTextColor={theme.textMuted}
        selectionColor={theme.accent}
        style={[
          styles.input,
          {
            color: theme.text,
            backgroundColor: theme.surface,
            borderColor: error ? theme.danger : theme.border
          },
          style
        ]}
      />
      {error ? (
        <Text style={[styles.hint, { color: theme.danger }]}>{error}</Text>
      ) : hint ? (
        <Text style={[styles.hint, { color: theme.textMuted }]}>{hint}</Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    gap: 6
  },
  label: {
    ...typography.micro,
    marginLeft: 2
  },
  input: {
    ...typography.callout,
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md
  },
  hint: {
    ...typography.caption,
    paddingHorizontal: 2
  }
})
