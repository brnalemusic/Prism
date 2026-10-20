import { useMemo, useState } from 'react'
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { PROVIDER_PRESETS, PROTOCOL_LABELS, getProviderPreset } from '../ai/presets'
import {
  formatModelList,
  parseModelList,
  validateProviderDraft,
  type ProviderDraftErrors
} from '../ai/validation'
import type { ProviderDraft, ProviderProfile, ProviderProtocol } from '../domain/types'
import { useTheme } from '../state/settings'
import { radius, spacing, type as typography } from '../theme/tokens'
import { PrimaryButton } from './Buttons'
import { Field } from './Field'
import { PressableScale } from './PressableScale'

interface ProviderFormProps {
  initial?: ProviderProfile
  initialPresetKey?: string
  hasStoredKey: boolean
  submitLabel: string
  onSubmit: (draft: ProviderDraft) => Promise<void>
  onDelete?: () => void
}

const PROTOCOLS: ProviderProtocol[] = ['gemini', 'openai', 'anthropic']

export function ProviderForm({
  initial,
  initialPresetKey,
  hasStoredKey,
  submitLabel,
  onSubmit,
  onDelete
}: ProviderFormProps): React.JSX.Element {
  const theme = useTheme()
  const preset = getProviderPreset(initialPresetKey ?? '')
  const isNew = !initial
  const [presetKey, setPresetKey] = useState(initialPresetKey ?? '')

  const [name, setName] = useState(initial?.name ?? preset?.name ?? '')
  const [protocol, setProtocol] = useState<ProviderProtocol>(
    initial?.protocol ?? preset?.protocol ?? 'openai'
  )
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? preset?.baseUrl ?? '')
  const [models, setModels] = useState(formatModelList(initial?.models ?? preset?.models ?? []))
  const [apiKey, setApiKey] = useState('')
  const [revealKey, setRevealKey] = useState(false)
  const [errors, setErrors] = useState<ProviderDraftErrors>({})
  const [saving, setSaving] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [consoleUrl, setConsoleUrl] = useState(preset?.consoleUrl ?? '')

  const activePreset = useMemo(() => getProviderPreset(presetKey), [presetKey])

  const applyPreset = (key: string): void => {
    const next = getProviderPreset(key)
    if (!next) return
    setPresetKey(key)
    setConsoleUrl(next.consoleUrl)
    setBaseUrl(next.baseUrl)
    setProtocol(next.protocol)
    setModels(formatModelList(next.models))
    if (isNew) setName(next.name)
  }

  const handleSubmit = async (): Promise<void> => {
    if (saving) return
    const draft: ProviderDraft = {
      id: initial?.id,
      name,
      protocol,
      baseUrl,
      models: parseModelList(models),
      ...(apiKey.trim() || !hasStoredKey ? { apiKey: apiKey.trim() } : {})
    }
    const nextErrors = validateProviderDraft(draft, { hasStoredKey })
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setSaving(true)
    setSubmitError(null)
    try {
      await onSubmit(draft)
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Could not save this provider.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {isNew ? (
          <View style={styles.presetsBlock}>
            <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>PRESETS</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.presets}
            >
              {PROVIDER_PRESETS.map((item) => {
                const active = item.key === presetKey
                return (
                  <PressableScale
                    key={item.key}
                    onPress={() => applyPreset(item.key)}
                    haptic="selection"
                    accessibilityRole="button"
                    accessibilityLabel={item.name}
                    style={[
                      styles.preset,
                      {
                        backgroundColor: active ? `${theme.accent}18` : theme.surface,
                        borderColor: active ? `${theme.accent}66` : theme.border
                      }
                    ]}
                  >
                    <Text
                      style={[styles.presetName, { color: active ? theme.accent : theme.text }]}
                      numberOfLines={1}
                    >
                      {item.name}
                    </Text>
                    <Text
                      style={[styles.presetTagline, { color: theme.textMuted }]}
                      numberOfLines={2}
                    >
                      {item.tagline}
                    </Text>
                  </PressableScale>
                )
              })}
            </ScrollView>
          </View>
        ) : null}

        <View style={styles.fields}>
          <Field
            label="NAME"
            value={name}
            onChangeText={setName}
            placeholder="My provider"
            error={errors.name}
            autoCapitalize="words"
          />

          <View style={styles.protocolBlock}>
            <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>PROTOCOL</Text>
            <View style={styles.protocolRow}>
              {PROTOCOLS.map((option) => {
                const active = option === protocol
                return (
                  <PressableScale
                    key={option}
                    onPress={() => {
                      setProtocol(option)
                      setConsoleUrl('')
                    }}
                    haptic="selection"
                    accessibilityRole="button"
                    accessibilityLabel={PROTOCOL_LABELS[option]}
                    style={[
                      styles.protocol,
                      {
                        backgroundColor: active ? `${theme.accent}18` : theme.surface,
                        borderColor: active ? `${theme.accent}66` : theme.border
                      }
                    ]}
                  >
                    <Text
                      style={[
                        styles.protocolLabel,
                        { color: active ? theme.accent : theme.textSecondary }
                      ]}
                      numberOfLines={1}
                    >
                      {PROTOCOL_LABELS[option]}
                    </Text>
                  </PressableScale>
                )
              })}
            </View>
          </View>

          <Field
            label="BASE URL"
            value={baseUrl}
            onChangeText={setBaseUrl}
            placeholder={
              protocol === 'gemini'
                ? 'https://generativelanguage.googleapis.com/v1beta'
                : protocol === 'anthropic'
                  ? 'https://api.anthropic.com'
                  : 'https://api.openai.com/v1'
            }
            error={errors.baseUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />

          <Field
            label="MODELS"
            value={models}
            onChangeText={setModels}
            placeholder={'gemini-3.6-flash\ngemini-3.1-pro'}
            hint="One model id per line, or comma separated. The first one becomes the default."
            error={errors.models}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.modelsInput}
          />

          <View style={styles.keyBlock}>
            <Field
              label="API KEY"
              value={apiKey}
              onChangeText={setApiKey}
              placeholder={
                hasStoredKey
                  ? 'Stored securely — leave blank to keep'
                  : (activePreset?.keyHint ?? 'Paste your key')
              }
              hint="Stored in the device keychain, never in plain storage and never sent to Prism servers."
              error={errors.apiKey}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry={!revealKey}
            />
            <View style={styles.keyActions}>
              <PressableScale
                onPress={() => setRevealKey((value) => !value)}
                haptic="selection"
                accessibilityRole="button"
                accessibilityLabel={revealKey ? 'Hide API key' : 'Show API key'}
                style={styles.inlineAction}
              >
                <Ionicons
                  name={revealKey ? 'eye-off-outline' : 'eye-outline'}
                  size={14}
                  color={theme.textSecondary}
                />
                <Text style={[styles.inlineLabel, { color: theme.textSecondary }]}>
                  {revealKey ? 'Hide' : 'Show'}
                </Text>
              </PressableScale>
              {consoleUrl ? (
                <PressableScale
                  onPress={() => void Linking.openURL(consoleUrl).catch(() => undefined)}
                  haptic="selection"
                  accessibilityRole="button"
                  accessibilityLabel="Get an API key"
                  style={styles.inlineAction}
                >
                  <Ionicons name="open-outline" size={14} color={theme.accent} />
                  <Text style={[styles.inlineLabel, { color: theme.accent }]}>Get a key</Text>
                </PressableScale>
              ) : null}
            </View>
          </View>

          {activePreset && isNew ? (
            <Text style={[styles.note, { color: theme.textMuted }]}>{activePreset.tagline}</Text>
          ) : null}

          {submitError ? (
            <Text style={[styles.submitError, { color: theme.danger }]}>{submitError}</Text>
          ) : null}
        </View>

        <View style={styles.actions}>
          <PrimaryButton label={submitLabel} onPress={() => void handleSubmit()} loading={saving} />
          {onDelete ? (
            <PrimaryButton
              label="Remove provider"
              variant="danger"
              icon="trash-outline"
              onPress={onDelete}
            />
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  flex: {
    flex: 1
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxxl,
    gap: spacing.xl
  },
  presetsBlock: {
    gap: spacing.sm
  },
  presets: {
    gap: spacing.sm,
    paddingVertical: 2,
    paddingRight: spacing.lg
  },
  preset: {
    width: 156,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    gap: 3
  },
  presetName: {
    ...typography.caption,
    fontWeight: '700',
    fontSize: 13
  },
  presetTagline: {
    ...typography.caption,
    fontSize: 11.5,
    lineHeight: 15
  },
  fields: {
    gap: spacing.lg
  },
  sectionLabel: {
    ...typography.micro,
    marginLeft: 2
  },
  protocolBlock: {
    gap: 6
  },
  protocolRow: {
    flexDirection: 'row',
    gap: spacing.sm
  },
  protocol: {
    flex: 1,
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
    paddingHorizontal: 4
  },
  protocolLabel: {
    ...typography.caption,
    fontSize: 11.5,
    fontWeight: '600'
  },
  modelsInput: {
    minHeight: 100,
    textAlignVertical: 'top',
    fontFamily: typography.mono.fontFamily,
    fontSize: 13
  },
  keyBlock: {
    gap: spacing.sm
  },
  keyActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 2
  },
  inlineAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5
  },
  inlineLabel: {
    ...typography.caption,
    fontSize: 12,
    fontWeight: '600'
  },
  note: {
    ...typography.caption
  },
  submitError: {
    ...typography.caption
  },
  actions: {
    gap: spacing.sm
  }
})
