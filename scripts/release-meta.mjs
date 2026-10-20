#!/usr/bin/env node
/**
 * Release metadata resolver for tags shaped like:
 *
 *   MAJORDSK.MINORDSK-MAJORMBL.MINORMBL/YYYYMMDD
 *   example: 10.0-0.0/20270710
 *
 * The app versions themselves stay valid SemVer (version.txt / version_m.txt);
 * the tag only carries the major.minor pair of each app plus the release date.
 *
 * For every tag push this script:
 *   1. validates the tag format,
 *   2. checks the tag's major.minor pairs against the version files,
 *   3. compares version.txt and version_m.txt against the previous release tag,
 *   4. exposes desktop_changed / mobile_changed for the workflow to gate builds.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { REPO_ROOT, assertSemver, readVersionFile } from './sync-versions.mjs'

export const RELEASE_TAG_PATTERN = /^(\d+)\.(\d+)-(\d+)\.(\d+)\/(\d{8})$/

/**
 * @returns {{ desktopMajor: number, desktopMinor: number,
 *             mobileMajor: number, mobileMinor: number,
 *             date: string, desktopPrefix: string, mobilePrefix: string }}
 */
export function parseReleaseTag(tag) {
  const trimmed = String(tag ?? '').trim()
  const match = RELEASE_TAG_PATTERN.exec(trimmed)
  if (!match) {
    throw new Error(
      `Tag "${trimmed}" is invalid. Expected MAJORDSK.MINORDSK-MAJORMBL.MINORMBL/YYYYMMDD (for example 10.0-0.0/20270710).`
    )
  }
  const [, desktopMajor, desktopMinor, mobileMajor, mobileMinor, date] = match
  const parsedDate = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
  const asDate = new Date(`${parsedDate}T00:00:00Z`)
  if (Number.isNaN(asDate.getTime()) || asDate.toISOString().slice(0, 10) !== parsedDate) {
    throw new Error(`Tag "${trimmed}" contains an invalid date segment (${date}).`)
  }
  return {
    desktopMajor: Number(desktopMajor),
    desktopMinor: Number(desktopMinor),
    mobileMajor: Number(mobileMajor),
    mobileMinor: Number(mobileMinor),
    date: parsedDate,
    desktopPrefix: `${desktopMajor}.${desktopMinor}`,
    mobilePrefix: `${mobileMajor}.${mobileMinor}`
  }
}

export function semverMajorMinor(version) {
  const validated = assertSemver(version, 'Version')
  const [major, minor] = validated.split('.')
  return `${Number(major)}.${Number(minor)}`
}

export function assertTagMatchesVersions(tagMeta, desktopVersion, mobileVersion) {
  const desktopPrefix = semverMajorMinor(desktopVersion)
  const mobilePrefix = semverMajorMinor(mobileVersion)
  if (tagMeta.desktopPrefix !== desktopPrefix) {
    throw new Error(
      `Tag desktop segment "${tagMeta.desktopPrefix}" does not match version.txt (${desktopVersion} → ${desktopPrefix}.x).`
    )
  }
  if (tagMeta.mobilePrefix !== mobilePrefix) {
    throw new Error(
      `Tag mobile segment "${tagMeta.mobilePrefix}" does not match version_m.txt (${mobileVersion} → ${mobilePrefix}.x).`
    )
  }
}

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
}

export function findPreviousTag(currentTag, cwd = REPO_ROOT) {
  const tags = git(['tag', '--merged', 'HEAD', '--sort=-creatordate'], cwd)
    .split('\n')
    .map((tag) => tag.trim())
    .filter(Boolean)
  return tags.find((tag) => tag !== currentTag) ?? null
}

export function versionFileChanged(previousTag, relativePath, cwd = REPO_ROOT) {
  if (!previousTag) return true
  const diff = git(['diff', '--name-only', previousTag, 'HEAD', '--', relativePath], cwd)
  return diff.length > 0
}

/**
 * @returns {{ tag: string, desktopVersion: string, mobileVersion: string,
 *             previousTag: string | null, desktopChanged: boolean, mobileChanged: boolean }}
 */
export function resolveReleaseMeta(tag, cwd = REPO_ROOT) {
  const meta = parseReleaseTag(tag)
  const desktopVersion = readVersionFile(path.join(cwd, 'version.txt'), 'Desktop')
  const mobileVersion = readVersionFile(path.join(cwd, 'version_m.txt'), 'Mobile')
  assertTagMatchesVersions(meta, desktopVersion, mobileVersion)

  const previousTag = findPreviousTag(tag, cwd)
  const desktopChanged = versionFileChanged(previousTag, 'version.txt', cwd)
  const mobileChanged = versionFileChanged(previousTag, 'version_m.txt', cwd)

  if (!desktopChanged && !mobileChanged) {
    throw new Error(
      'Neither version.txt nor version_m.txt changed since the previous release tag. Bump a version before tagging.'
    )
  }

  return {
    tag,
    desktopVersion,
    mobileVersion,
    previousTag,
    desktopChanged,
    mobileChanged
  }
}

export function formatReleaseReport(meta) {
  const previous = meta.previousTag ? `previous tag ${meta.previousTag}` : 'no previous tag (first release)'
  return [
    `tag              ${meta.tag}`,
    `desktop version  ${meta.desktopVersion} (${meta.desktopChanged ? 'changed → build' : 'unchanged → skip'})`,
    `mobile version   ${meta.mobileVersion} (${meta.mobileChanged ? 'changed → build' : 'unchanged → skip'})`,
    `comparison base  ${previous}`
  ].join('\n')
}

function writeGithubOutput(file, values) {
  if (!file) return
  const lines = Object.entries(values).map(([key, value]) => `${key}=${String(value)}`)
  fs.appendFileSync(file, `${lines.join('\n')}\n`)
}

function runCli() {
  try {
    const tag = process.env.RELEASE_TAG ?? process.argv[2]
    if (!tag) throw new Error('RELEASE_TAG (or the first argument) is required.')
    const meta = resolveReleaseMeta(tag, REPO_ROOT)
    console.log('[release-meta] Resolved:')
    console.log(formatReleaseReport(meta))
    writeGithubOutput(process.env.GITHUB_OUTPUT, {
      desktop_version: meta.desktopVersion,
      mobile_version: meta.mobileVersion,
      desktop_changed: meta.desktopChanged,
      mobile_changed: meta.mobileChanged,
      previous_tag: meta.previousTag ?? ''
    })
  } catch (error) {
    console.error(`[release-meta] ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli()
}
