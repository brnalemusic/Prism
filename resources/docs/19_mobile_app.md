# Prism Mobile: Native Companion App

## 1. What Prism Mobile Is

Prism Mobile is a **separate native application** for phones, built with **React Native and Expo SDK 58**. It is not an Electron port, a WebView wrapper, or a responsive version of the desktop renderer.

The mobile app exists because the desktop workspace does not compress into a phone: multi-pane chat, harness projects, terminal sandboxes and browser automation all assume a keyboard, a large display and an operating system to control. Rather than shrinking that surface, Prism Mobile is designed around a different context — one conversation, one hand, one pocket.

**Scope of the mobile app**

- Streaming chat with Gemini (native API), any OpenAI-compatible endpoint, and Anthropic Messages.
- Local conversation history (session index + per-session messages).
- Provider management with API keys in the OS keychain.
- Prompt library with editable drafts.
- The eight Prism spectral themes, retuned for dark OLED surfaces.
- Native interaction: haptics, spring press feedback, sheets, floating glass tab bar, native stack transitions.

**Out of scope by design**

Terminal execution, harness projects, file and browser tools, Discord gateway, mini-apps, PDF/PPTX generation and screen vision all remain desktop-only. The mobile system prompt states this explicitly so the model never pretends to control the user's computer.

---

## 2. Stack

| Layer | Technology |
| --- | --- |
| Runtime | React Native 0.88 (New Architecture) |
| App framework | Expo SDK 58 with Continuous Native Generation (`expo prebuild`) |
| Routing | `expo-router` JS tabs and native stack (file-based routes in `mobile/app`) |
| Language | TypeScript 5.9 (`mobile/tsconfig.json`, strict, `noUncheckedIndexedAccess`) |
| State | React context providers (`settings`, `sessions`) — no external state library |
| Persistence | `@react-native-async-storage/async-storage` (metadata/messages), `expo-secure-store` (keys) |
| Networking | `expo/fetch` (real streaming `ReadableStream` on native) |
| Updates | `expo-application` + `expo-file-system` + `expo-intent-launcher` (GitHub Releases updater) |
| Markdown | `react-native-marked` (native views, no WebView) |
| Icons / vectors | `@expo/vector-icons`, `react-native-svg` (Prism mark) |
| Motion | React Native `Animated` (native driver) + `expo-haptics` |
| Tests | Node test runner through `tsx` (protocol and formatting logic) |

The desktop type stack (Geist/JetBrains Mono) is intentionally replaced by the platform text stack. Prism Mobile should read as a native app first and a brand object second.

---

## 3. Project Structure

```
mobile/
├── app/                      # expo-router routes
│   ├── _layout.tsx           # providers, splash, native stack
│   ├── (tabs)/               # Chats, Prompts, Settings + floating tab bar
│   ├── chat/[id].tsx         # conversation, streaming, model sheet, rename/delete
│   ├── settings/             # providers, provider editor, appearance, about
│   └── onboarding.tsx        # first-run provider setup
├── src/
│   ├── ai/                   # protocols, SSE parser, presets, persona, prompts, validation
│   ├── components/           # design-system primitives, chat surfaces, update UI
│   ├── domain/types.ts       # mobile domain model
│   ├── lib/                  # ids, text formatting, model labels, update logic
│   ├── services/             # native update download + installer bridge
│   ├── state/                # settings, sessions and updates providers
│   ├── storage/              # AsyncStorage and SecureStore adapters
│   └── theme/                # palettes and tokens
├── tests/                    # node:test suites (pure logic)
├── scripts/                  # Android release-signing wiring
├── app.json                  # Expo config (version and versionCode synced from tags)
└── package.json              # independent dependency tree and lockfile
```

`mobile/` has its own `package-lock.json`; the desktop install never touches it and `electron-builder` excludes `mobile/**` from the installer.

---

## 4. State and Persistence

**Settings** (`src/state/settings.tsx`) stores non-secret configuration in AsyncStorage under `prism.mobile.settings.v1`: providers (name, protocol, base URL, models), default provider/model, theme key and onboarding flag. The stored payload is sanitised on read, so a corrupt or partial record cannot crash boot.

**Sessions** (`src/state/sessions.tsx`) splits storage into an index and one record per conversation:

- `prism.mobile.sessions.v1.index` — ordered session summaries (`title`, `preview`, `messageCount`, model, timestamps).
- `prism.mobile.sessions.v1.messages.<id>` — the full transcript for one session.

Only the touched session is rewritten when a reply finishes, and the index caps at 120 sessions (oldest transcripts are deleted with their session). Messages interrupted by an app kill are sanitised back to `stopped` on read.

**Streaming** is orchestrated in the sessions provider. Deltas are buffered for 24 ms before touching React state, which keeps long replies smooth without dropping characters. A single `AbortController` guarantees one in-flight generation; stop, retry and delete all go through the same path.

---

## 5. AI Layer

`src/ai/` is deliberately split into pure modules and one platform module:

- `sse.ts` — incremental Server-Sent Events decoder (chunk-safe, CRLF-safe, multi-line data, BOM) plus per-protocol delta extraction for Gemini, OpenAI and Anthropic, including provider error events, `[DONE]` and Gemini `blockReason`.
- `request.ts` — pure request builders. Gemini uses `:streamGenerateContent?alt=sse` with the key in `x-goog-api-key` (never in the URL); OpenAI-compatible endpoints use `/chat/completions` with bearer auth; Anthropic uses `/v1/messages` with `anthropic-version` and `x-api-key`. Loopback and `.local` endpoints may omit a key.
- `client.ts` — the only module that touches the network. It uses `expo/fetch`, reports friendly messages for 401/403/404/429/5xx, and preserves partial text when a stream breaks.
- `persona.ts` — the mobile system prompt (phone-only capabilities, small-screen answer shape) and the 24-turn context window.
- `presets.ts` — curated providers; every field stays editable.
- `validation.ts` — draft validation and model-list parsing used by the provider form.

Because the pure modules never import React Native, they are covered by `npm run mobile:test` on Node.

---

## 6. Design System

Themes live in `src/theme/themes.ts`: eight accent families matching the desktop themes, each with a dark background pair, glass surfaces, borders and text ramp. `mono` stands in for the desktop's Classic White theme.

All spacing, radius and type tokens come from `src/theme/tokens.ts`. Screens use `ScreenBackground` for the continuous gradient (no pale flash between routes), `GlassSurface` for real iOS blur with an Android solid fallback, and `PressableScale` for press feedback + haptics.

---

## 7. Versioning and Releases

Local commands (from the repository root):

```bash
npm run mobile            # Expo dev server
npm run mobile:android    # expo run:android (native build; auto-resolves JDK 17+ and handles Windows long paths)
npm run mobile:typecheck  # tsc --noEmit for the mobile app
npm run mobile:test       # node:test suites incl. the updater logic
npm run mobile:bundle     # expo export --platform android (Metro validation)
npm run versions          # apply version.txt + version_m.txt
npm run test:release-meta # tag parsing / change detection tests
```

The native project (`mobile/android`) is generated on demand by `expo prebuild` and is **not** committed; `app.json` is the single source of truth for identifiers, icons and the mobile version. The `withAndroidCmakeObjectPathMax` config plugin injects `-DCMAKE_OBJECT_PATH_MAX=240` so React Native codegen object names stay below Windows' `MAX_PATH`. Prism Mobile ships for **Android only** — there is no iOS build, job or artifact.

### 7.1 Two apps, two version files

| File | App | Example |
| --- | --- | --- |
| `version.txt` | Desktop | `9.3.0` |
| `version_m.txt` | Mobile | `0.0.1` |

`scripts/sync-versions.mjs` reads both and writes `package.json`, `package-lock.json`, and for mobile `app.json` with `versionCode = major*10000 + minor*100 + patch`. It is idempotent: a version that already matches is untouched, and the report says which app changed. The PowerShell wrapper (`npm run sync`) and the release workflow call the same script, so local and CI behaviour cannot diverge.

### 7.2 Release tag format

```text
MAJORDSK.MINORDSK-MAJORMBL.MINORMBL/YYYYMMDD
9.3-0.0/20261020
example: desktop 10.0.3 + mobile 0.0.1 → 10.0-0.0/20270710
```

The tag holds each app's major.minor plus the release date. Application versions remain strict SemVer (`10.0.3`, `0.0.1`); only the tag uses `/`, which Git allows in refs and GitHub accepts for releases. SemVer itself does not permit `/` in a version string, which is why the tag is never parsed as an app version.

`scripts/release-meta.mjs` validates the tag (format + real date + matching major.minor pairs) and compares `version.txt` / `version_m.txt` with the previous release tag.

### 7.3 Conditional build pipeline

`.github/workflows/release.yml` runs:

1. `prepare` — validates the tag, resolves both versions, and outputs `desktop_changed` / `mobile_changed` by diffing the version files against the previous release tag. Fails the run when neither file changed.
2. `build` — Windows desktop installer; runs only when `desktop_changed`.
3. `mobile-android` — Node 22 + Java 17, `npm ci`, typecheck, tests, `expo prebuild --platform android`, release signing, `./gradlew assembleRelease`; runs only when `mobile_changed`.
4. `release` — runs when no required job failed; downloads desktop and/or mobile artifacts and publishes them to the same GitHub Release. A skipped app simply contributes no artifact.

Tags are no longer treated as prereleases (the `-` in the new format is structural), so `prerelease` is always `false`.

### 7.4 Android signing

`mobile/scripts/configure-android-signing.mjs` adds a release `signingConfig` to the generated Gradle project when a keystore is present, reading passwords from environment variables so no secret is written to disk.

Configure these repository secrets to publish update-compatible APKs:

| Secret | Purpose |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Base64 of the release keystore (`base64 -w0 release.keystore`) |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | Key alias |
| `ANDROID_KEY_PASSWORD` | Key password |

Without these secrets the workflow still produces an installable APK using the prebuild debug signing config, but installing a new build over an older one requires uninstalling first.

### 7.5 Android only

Prism Mobile targets Android exclusively. The release workflow has no iOS job, no macOS runner for the mobile app and no IPA artifact, and the desktop installer never packages the mobile sources. Bringing iOS back would mean adding an `expo prebuild --platform ios` + `xcodebuild` job with Apple signing credentials.

---

## 8. Auto-updater

The updater is split into pure rules and a native bridge:

- `src/lib/updater.ts` — SemVer precedence (including prereleases), GitHub release parsing (`prism-mobile-<version>.apk` assets), latest-release selection and release-note trimming. Covered by `tests/updater.test.ts`.
- `src/services/updateService.ts` — GitHub API request (10 s timeout, explicit `User-Agent`, rate-limit message), cached APK download with progress, and `IntentLauncher` hand-off to the Android package installer via a `FileProvider` content URI.
- `src/state/updates.tsx` — state machine (`idle → checking → available/current → downloading → installing/error`), 6-hour throttle persisted in AsyncStorage, silent launch check after 2.5 s, manual forced checks, and installation errors surfaced in the sheet.
- `src/components/UpdateSheet.tsx` / `UpdateBanner.tsx` — the visible flow: banner on Chats, sheet with version, notes, download progress and installer instructions.

Rules and safety:

- Auto-checks are silent; only a newer version produces UI.
- The APK is downloaded into the app cache, never over an existing install by the app itself: Android shows its own confirmation and verifies the package signature.
- The Android manifest declares `REQUEST_INSTALL_PACKAGES`; users may still need to allow “Install unknown apps” for Prism once.
- Expo Go has no native version, so the updater reports “native builds only” there instead of showing a false update.

---

## 9. Verification Checklist

- `npm run mobile:typecheck` — strict TypeScript for app, components and tests.
- `npm run mobile:test` — SSE framing, protocol deltas, request construction, validation, title/preview formatting, update parsing and version precedence.
- `npm run test:release-meta` — tag validation, per-app change detection against previous tags, and unified version sync (runs in a temporary Git repository).
- `npm run mobile:bundle` — Metro can resolve and bundle the whole app (catches missing native modules and route errors).
- `npx expo prebuild --platform android --no-install` — `app.json` is valid and the native project generates.
- On a device: onboarding → add provider → streamed reply → stop/retry → rename/delete → theme switch → restart persistence.

Runtime UI checks require a device or simulator; they are not covered by automated tests.

---

## 10. Known Limitations

- No image or file attachments yet; the composer is text-only.
- No in-app provider connection test; failures surface on the first message with a status-specific hint.
- Conversations are device-local and not synced with the desktop app.
- The updater depends on GitHub’s unauthenticated API (60 requests/hour per IP); results are cached for six hours.
- Two releases on the same day with unchanged major.minor pairs for both apps would collide on the tag name; bump at least one minor (or the date) for each release.
- The mobile app does not use the Prism account / cloud proxy; it is bring-your-own-key only.
- Web is not a target platform (`expo-secure-store` is native-only), even though the bundler can emit a web bundle.
