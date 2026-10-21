# Prism Mobile

A native phone app for Prism, built with React Native and Expo. It is a separate
codebase from the Electron desktop app — not a port, not a WebView, and not
generated from the desktop renderer. It also versions independently.

## Quick start

```bash
cd mobile
npm install
npm start          # Expo dev server
```

To build real native binaries locally, run this from the repository root:

```bash
npm run mobile:android    # requires Android Studio / SDK
```

On Windows, the root command resolves a JDK 17+ automatically (preferring
`JAVA_HOME`, then Android Studio's bundled JBR) and limits Gradle to two
workers unless `GRADLE_OPTS` is set. The `withAndroidCmakeObjectPathMax` config
plugin injects `-DCMAKE_OBJECT_PATH_MAX=240`, which keeps React Native codegen
object paths below Windows' 260-character `MAX_PATH`.

Keep the repository at a short path (for example `C:\Prism`). React Native
mirrors absolute source paths into the CMake object directory; a deep
repository path can still exceed `MAX_PATH` and make Ninja fail. `subst` drives
do not help because Gradle canonicalizes them back to the physical path.
Running `npm run android` directly from `mobile/` still works when the
repository path is short enough.

Prism Mobile targets **Android only** — no iOS build is produced or published.

## Verification

```bash
npm run typecheck
npm test
npm run bundle     # Metro production bundle for Android
```

`npx expo prebuild --platform android --no-install` regenerates the native
project; `android/` is generated output and stays untracked.

## Versioning and releases

The mobile version lives in `../version_m.txt` (the desktop version lives in
`../version.txt`). From the repository root:

```bash
npm run versions   # applies both version files (idempotent)
npm run sync       # same, through the PowerShell wrapper
```

Release tags combine both apps:

```text
MAJORDSK.MINORDSK-MAJORMBL.MINORMBL/YYYYMMDD
9.3-0.0/20261020
```

The release workflow only builds the Android APK when `version_m.txt` changed
since the previous release tag, and only builds the Windows app when
`version.txt` changed. Artifacts go to the same GitHub Release as the desktop
installer.

## Auto-updater

`src/lib/updater.ts` (pure rules), `src/services/updateService.ts` (GitHub
Releases + Android installer bridge) and `src/state/updates.tsx` (state machine)
implement an in-app updater:

- Checks GitHub Releases on launch, at most once every six hours.
- Shows a banner and update sheet when a newer `prism-mobile-<version>.apk` exists.
- Downloads the APK with progress and opens the Android installer in one tap.

## Where things live

- `app/` — expo-router routes (tabs, chat, settings, onboarding).
- `src/ai/` — provider protocols, SSE parser, request builders, presets, persona.
- `src/state/` — settings, conversation and update stores.
- `src/storage/` — AsyncStorage (history) and SecureStore (API keys).
- `src/services/` — native bridges (update download/installer).
- `src/components/` — the mobile design system, chat surfaces and update UI.
- `tests/` — Node tests for the pure streaming, updater and formatting logic.

See [`resources/docs/19_mobile_app.md`](../resources/docs/19_mobile_app.md) for
the architecture, release pipeline, signing setup and updater details.
