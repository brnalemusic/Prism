#!/usr/bin/env node
/**
 * Wires a release signing config into the prebuilt Android project.
 *
 * Prism Mobile's CI publishes installable APKs. If the repository provides a
 * keystore (ANDROID_KEYSTORE_BASE64 decoded ahead of this script), the release
 * is signed with it so users can update in place across versions. Without a
 * keystore the prebuild default (debug signing) is kept, which is fine for
 * testing but requires uninstalling before installing another build.
 *
 * Passwords are read from the environment inside Gradle, so no secret is
 * written into the generated native project.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const gradlePath = path.join(mobileRoot, 'android', 'app', 'build.gradle')
const keystorePath = path.resolve(
  mobileRoot,
  process.env.ANDROID_KEYSTORE_PATH ?? 'android/app/prism-release.keystore'
)

if (!fs.existsSync(gradlePath)) {
  console.error('[android-signing] android/app/build.gradle not found. Run expo prebuild first.')
  process.exit(1)
}

if (!fs.existsSync(keystorePath)) {
  console.warn(
    '[android-signing] No release keystore found — keeping the prebuild debug signing config.'
  )
  process.exit(0)
}

if (!process.env.ANDROID_KEYSTORE_PASSWORD || !process.env.ANDROID_KEY_ALIAS) {
  console.error(
    '[android-signing] Keystore present but ANDROID_KEYSTORE_PASSWORD / ANDROID_KEY_ALIAS are missing.'
  )
  process.exit(1)
}

let gradle = fs.readFileSync(gradlePath, 'utf8')

if (gradle.includes('signingConfigs.release')) {
  console.log('[android-signing] Release signing already configured.')
  process.exit(0)
}

const releaseConfig = `
        release {
            storeFile file(System.getenv("ANDROID_KEYSTORE_PATH") ?: "prism-release.keystore")
            storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias System.getenv("ANDROID_KEY_ALIAS")
            keyPassword System.getenv("ANDROID_KEY_PASSWORD")
        }`

const signingAnchor = /signingConfigs\s*\{/
if (!signingAnchor.test(gradle)) {
  console.error('[android-signing] Could not find the signingConfigs block in build.gradle.')
  process.exit(1)
}
gradle = gradle.replace(signingAnchor, (block) => `${block}${releaseConfig}`)

const releaseUsage = /(release\s*\{[^}]*?)signingConfig\s+signingConfigs\.debug/s
if (!releaseUsage.test(gradle)) {
  console.error('[android-signing] Could not find the release buildType in build.gradle.')
  process.exit(1)
}
gradle = gradle.replace(releaseUsage, '$1signingConfig signingConfigs.release')

fs.writeFileSync(gradlePath, gradle)
console.log('[android-signing] Release signing configured from environment.')
