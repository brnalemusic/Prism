import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useUpdates } from '../state/updates'
import { useTheme } from '../state/settings'
import { radius, spacing, type as typography } from '../theme/tokens'
import { PrimaryButton } from './Buttons'
import { PressableScale } from './PressableScale'
import { Sheet } from './Sheet'

function StatusIcon({
  name,
  color,
  background
}: {
  name: keyof typeof Ionicons.glyphMap
  color: string
  background: string
}): React.JSX.Element {
  return (
    <View style={[styles.statusIcon, { backgroundColor: background }]}>
      <Ionicons name={name} size={22} color={color} />
    </View>
  )
}

export function UpdateSheet(): React.JSX.Element {
  const theme = useTheme()
  const {
    status,
    release,
    progress,
    error,
    currentVersion,
    sheetVisible,
    closeSheet,
    installUpdate,
    openDownloadPage,
    checkForUpdate
  } = useUpdates()

  const isAndroid = Platform.OS === 'android'
  const percent = Math.round(progress * 100)

  return (
    <Sheet
      visible={sheetVisible}
      onClose={closeSheet}
      title="Prism Mobile update"
      subtitle={`Installed version v${currentVersion}`}
      maxHeightRatio={0.82}
    >
      {status === 'checking' ? (
        <View style={styles.centered}>
          <ActivityIndicator color={theme.accent} />
          <Text style={[styles.body, { color: theme.textSecondary }]}>
            Checking GitHub Releases for the latest build…
          </Text>
        </View>
      ) : null}

      {status === 'unsupported' ? (
        <View style={styles.section}>
          <StatusIcon
            name="phone-portrait-outline"
            color={theme.accent}
            background={`${theme.accent}1F`}
          />
          <Text style={[styles.title, { color: theme.text }]}>Native builds only</Text>
          <Text style={[styles.body, { color: theme.textSecondary }]}>
            Update checks compare the installed binary with the APK published on GitHub Releases.
            Expo Go and the web preview cannot update themselves — install the release APK to use
            the updater.
          </Text>
          <PrimaryButton
            label="Open releases page"
            icon="open-outline"
            onPress={() => void openDownloadPage()}
          />
        </View>
      ) : null}

      {status === 'current' ? (
        <View style={styles.section}>
          <StatusIcon
            name="checkmark-circle-outline"
            color={theme.success}
            background={`${theme.success}1F`}
          />
          <Text style={[styles.title, { color: theme.text }]}>You’re up to date</Text>
          <Text style={[styles.body, { color: theme.textSecondary }]}>
            v{currentVersion} is the newest mobile build published for Prism.
          </Text>
          <PrimaryButton
            label="Check again"
            icon="refresh"
            variant="surface"
            onPress={() => void checkForUpdate(true)}
          />
        </View>
      ) : null}

      {status === 'available' && release ? (
        <View style={styles.section}>
          <View style={styles.availableHeader}>
            <StatusIcon
              name="cloud-download-outline"
              color={theme.accent}
              background={`${theme.accent}1F`}
            />
            <View style={styles.availableText}>
              <Text style={[styles.title, { color: theme.text }]}>
                v{release.version} is available
              </Text>
              <Text style={[styles.caption, { color: theme.textMuted }]}>
                You are on v{currentVersion}
              </Text>
            </View>
          </View>
          {release.notes ? (
            <ScrollView style={styles.notes} showsVerticalScrollIndicator={false}>
              <Text style={[styles.notesText, { color: theme.textSecondary }]}>
                {release.notes}
              </Text>
            </ScrollView>
          ) : null}
          <PrimaryButton
            label={isAndroid ? 'Download and install' : 'Open download page'}
            icon={isAndroid ? 'download-outline' : 'open-outline'}
            onPress={() => void installUpdate()}
          />
          <PressableScale
            onPress={closeSheet}
            haptic="selection"
            accessibilityRole="button"
            accessibilityLabel="Remind me later"
            style={styles.secondary}
          >
            <Text style={[styles.secondaryLabel, { color: theme.textMuted }]}>Remind me later</Text>
          </PressableScale>
        </View>
      ) : null}

      {status === 'downloading' ? (
        <View style={styles.section}>
          <StatusIcon
            name="download-outline"
            color={theme.accent}
            background={`${theme.accent}1F`}
          />
          <Text style={[styles.title, { color: theme.text }]}>Downloading update… {percent}%</Text>
          <View style={[styles.progressTrack, { backgroundColor: theme.surface }]}>
            <View
              style={[
                styles.progressFill,
                { width: `${Math.max(2, percent)}%`, backgroundColor: theme.accent }
              ]}
            />
          </View>
          <Text style={[styles.body, { color: theme.textSecondary }]}>
            The Android installer will open automatically when the download finishes.
          </Text>
        </View>
      ) : null}

      {status === 'installing' ? (
        <View style={styles.section}>
          <StatusIcon
            name="checkmark-done-outline"
            color={theme.success}
            background={`${theme.success}1F`}
          />
          <Text style={[styles.title, { color: theme.text }]}>Finish in the installer</Text>
          <Text style={[styles.body, { color: theme.textSecondary }]}>
            Confirm the update in the Android package installer. If Android blocks the install,
            allow “Install unknown apps” for Prism and tap the downloaded package again.
          </Text>
          <PrimaryButton
            label="Open releases page"
            variant="surface"
            onPress={() => void openDownloadPage()}
          />
        </View>
      ) : null}

      {status === 'error' ? (
        <View style={styles.section}>
          <StatusIcon
            name="alert-circle-outline"
            color={theme.danger}
            background={`${theme.danger}18`}
          />
          <Text style={[styles.title, { color: theme.text }]}>Update failed</Text>
          <Text style={[styles.body, { color: theme.textSecondary }]}>{error}</Text>
          <PrimaryButton
            label="Check for updates again"
            icon="refresh"
            onPress={() => void checkForUpdate(true)}
          />
          <PrimaryButton
            label="Open releases page"
            variant="surface"
            icon="open-outline"
            onPress={() => void openDownloadPage()}
          />
        </View>
      ) : null}

      <Text style={[styles.footnote, { color: theme.textMuted }]}>
        Updates come from the Prism GitHub Releases page. Android verifies the package signature, so
        an APK signed with a different key is rejected.
      </Text>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.md,
    paddingBottom: spacing.sm
  },
  centered: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.lg
  },
  statusIcon: {
    width: 46,
    height: 46,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center'
  },
  title: {
    ...typography.headline,
    fontSize: 18
  },
  body: {
    ...typography.callout,
    fontSize: 14.5,
    lineHeight: 21
  },
  caption: {
    ...typography.caption
  },
  availableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md
  },
  availableText: {
    flex: 1,
    gap: 2
  },
  notes: {
    maxHeight: 150
  },
  notesText: {
    ...typography.callout,
    fontSize: 14,
    lineHeight: 20
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden'
  },
  progressFill: {
    height: '100%',
    borderRadius: 4
  },
  secondary: {
    alignItems: 'center',
    paddingVertical: spacing.xs
  },
  secondaryLabel: {
    ...typography.caption,
    fontWeight: '600'
  },
  footnote: {
    ...typography.caption,
    fontSize: 11.5,
    lineHeight: 16,
    marginTop: spacing.xs
  }
})
