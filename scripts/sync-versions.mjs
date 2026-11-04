#!/usr/bin/env node
/**
 * Applies the versions declared in version.txt (desktop) and version_m.txt
 * (mobile) to every project file.
 *
 * The script is additive and idempotent:
 *   - A version that already matches is left untouched and reported as unchanged.
 *   - A version that differs is written to package.json, package-lock.json and,
 *     for the mobile app, app.json (including the Android versionCode).
 *
 * The release workflow uses the same version files, so "the script changed the
 * version" and "the build runs" always mean the same thing.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function isValidSemver(version) {
  return typeof version === 'string' && SEMVER_PATTERN.test(version.trim())
}

export function assertSemver(version, label) {
  const trimmed = String(version ?? '').trim()
  if (!isValidSemver(trimmed)) {
    throw new Error(`${label} must be a valid SemVer version (received "${trimmed}").`)
  }
  return trimmed
}

export function androidVersionCode(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(assertSemver(version, 'Mobile version'))
  if (!match) throw new Error('Could not derive an Android versionCode.')
  const [, major, minor, patch] = match
  return Number(major) * 10000 + Number(minor) * 100 + Number(patch)
}

export function readVersionFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing ${label} version file: ${path.basename(filePath)}`)
  }
  return assertSemver(fs.readFileSync(filePath, 'utf8'), path.basename(filePath))
}

function detectIndent(raw) {
  const match = raw.match(/^\{\r?\n(\s+)/)
  return match ? match[1].length : 2
}

/** Writes JSON with the file's existing indentation so diffs stay small. */
export function writeJsonLike(filePath, value) {
  const raw = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : ''
  const indent = raw ? detectIndent(raw) : 2
  const trailing = raw.endsWith('\n') || raw === '' ? '\n' : ''
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, indent)}${trailing}`)
}

function updateDesktopVersion(root, version) {
  const packagePath = path.join(root, 'package.json')
  const lockPath = path.join(root, 'package-lock.json')
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
  const from = pkg.version

  if (from === version) {
    return { from, to: version, changed: false }
  }

  pkg.version = version
  writeJsonLike(packagePath, pkg)

  if (fs.existsSync(lockPath)) {
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
    lock.version = version
    if (lock.packages && lock.packages['']) lock.packages[''].version = version
    writeJsonLike(lockPath, lock)
  }

  return { from, to: version, changed: true }
}

function updateMobileVersion(root, version) {
  const mobileDir = path.join(root, 'mobile')
  const packagePath = path.join(mobileDir, 'package.json')
  const lockPath = path.join(mobileDir, 'package-lock.json')
  const appPath = path.join(mobileDir, 'app.json')
  const versionCode = androidVersionCode(version)

  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
  const app = JSON.parse(fs.readFileSync(appPath, 'utf8'))
  const from = pkg.version
  const versionCodeChanged = app?.expo?.android?.versionCode !== versionCode

  if (from === version && !versionCodeChanged) {
    return { from, to: version, changed: false }
  }

  pkg.version = version
  writeJsonLike(packagePath, pkg)

  if (fs.existsSync(lockPath)) {
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
    lock.version = version
    if (lock.packages && lock.packages['']) lock.packages[''].version = version
    writeJsonLike(lockPath, lock)
  }

  app.expo.version = version
  app.expo.android = { ...app.expo.android, versionCode }
  writeJsonLike(appPath, app)

  return { from, to: version, changed: true, versionCode }
}

function updateReadmeBadge(root, desktopVersion) {
  const readmePath = path.join(root, 'README.md')
  if (!fs.existsSync(readmePath)) return false
  const raw = fs.readFileSync(readmePath, 'utf8')
  const pattern =
    /https:\/\/img\.shields\.io\/badge\/version-([0-9]+\.[0-9]+\.[0-9]+[0-9A-Za-z.-]*)-38bdf8/
  if (!pattern.test(raw)) return false
  const next = raw.replace(
    pattern,
    `https://img.shields.io/badge/version-${desktopVersion}-38bdf8`
  )
  if (next === raw) return false
  fs.writeFileSync(readmePath, next)
  return true
}

/**
 * @returns {{ desktop: {from: string, to: string, changed: boolean},
 *             mobile: {from: string, to: string, changed: boolean, versionCode?: number} }}
 */
export function syncVersions(root = REPO_ROOT) {
  const desktopVersion = readVersionFile(path.join(root, 'version.txt'), 'Desktop')
  const mobileVersion = readVersionFile(path.join(root, 'version_m.txt'), 'Mobile')

  const desktop = updateDesktopVersion(root, desktopVersion)
  const mobile = updateMobileVersion(root, mobileVersion)
  if (desktop.changed) updateReadmeBadge(root, desktopVersion)

  return { desktop, mobile }
}

export function releaseTagBase(desktopVersion, mobileVersion, date) {
  const formattedDate = String(date ?? '').replaceAll('-', '')
  const dateMatch = /^(\d{4})(\d{2})(\d{2})$/.exec(formattedDate)
  if (!dateMatch) {
    throw new Error(`Release date must be YYYYMMDD (received "${date}").`)
  }
  const [, year, month, day] = dateMatch
  const parsedDate = new Date(`${year}-${month}-${day}T00:00:00Z`)
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== `${year}-${month}-${day}`) {
    throw new Error(`Release date must be a valid calendar date (received "${date}").`)
  }
  return `${semverDigits(desktopVersion)}-${semverDigits(mobileVersion)}/${formattedDate}`
}

function semverDigits(version) {
  return assertSemver(version, 'Version').split(/[+-]/)[0]
}

export function nextReleaseTag(base, tags) {
  const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`^${escapedBase}(?:#(\\d+))?$`)
  let highestSuffix = 0
  let baseExists = false

  for (const tag of tags) {
    const match = pattern.exec(tag)
    if (!match) continue
    if (match[1] === undefined) baseExists = true
    else highestSuffix = Math.max(highestSuffix, Number(match[1]))
  }

  if (!baseExists && highestSuffix === 0) return base
  return `${base}#${Math.max(baseExists ? 1 : 0, highestSuffix) + 1}`
}

export function syncReleaseTag(root = REPO_ROOT, date = new Date()) {
  const desktopVersion = readVersionFile(path.join(root, 'version.txt'), 'Desktop')
  const mobileVersion = readVersionFile(path.join(root, 'version_m.txt'), 'Mobile')
  const dateString = date instanceof Date
    ? `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
    : String(date)
  const base = releaseTagBase(desktopVersion, mobileVersion, dateString)
  let tags
  try {
    tags = execFileSync('git', ['tag', '--list'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).split(/\r?\n/).filter(Boolean)
  } catch (error) {
    throw new Error(`Could not list Git tags: ${error instanceof Error ? error.message : String(error)}`)
  }

  const tag = nextReleaseTag(base, tags)
  fs.writeFileSync(path.join(root, 'version_tag.txt'), tag)
  return tag
}

export function formatSyncReport({ desktop, mobile }) {
  const line = (label, entry) => {
    const state = entry.changed ? `updated from ${entry.from}` : 'unchanged'
    const extra = entry.versionCode ? `, versionCode ${entry.versionCode}` : ''
    return `${label.padEnd(8)} ${entry.to} (${state}${extra})`
  }
  return [line('desktop', desktop), line('mobile', mobile)].join('\n')
}

function runCli() {
  try {
    const result = syncVersions()
    console.log('[sync-versions] Version files applied:')
    console.log(formatSyncReport(result))
    if (process.argv.includes('--write-tag')) {
      console.log(`[sync-versions] Release tag written to version_tag.txt: ${syncReleaseTag()}`)
    }
    if (!result.desktop.changed && !result.mobile.changed) {
      console.log('[sync-versions] Both apps were already up to date; nothing was written.')
    }
  } catch (error) {
    console.error(`[sync-versions] ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli()
}
