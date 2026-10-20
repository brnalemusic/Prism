/**
 * Pure update logic: version comparison and GitHub release parsing.
 * No React Native imports, so the rules can be tested on Node.
 */

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/
const APK_PATTERN = /^prism-mobile-(.+)\.apk$/
const IPA_PATTERN = /^prism-mobile-(.+?)(?:-unsigned)?\.ipa$/

export interface ReleaseAsset {
  name: string
  browser_download_url: string
  size?: number
}

export interface GitHubRelease {
  tag_name?: string
  name?: string
  html_url?: string
  published_at?: string
  body?: string
  draft?: boolean
  prerelease?: boolean
  assets?: ReleaseAsset[]
}

export interface MobileRelease {
  version: string
  apkUrl: string | null
  ipaUrl: string | null
  pageUrl: string
  notes: string
  publishedAt: string | null
}

interface ParsedVersion {
  major: number
  minor: number
  patch: number
  prerelease: string[]
}

export function parseVersion(value: string): ParsedVersion | null {
  const match = SEMVER_PATTERN.exec(
    String(value ?? '')
      .trim()
      .replace(/^v/, '')
  )
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : []
  }
}

function comparePrerelease(left: string[], right: string[]): number {
  if (left.length === 0 && right.length === 0) return 0
  if (left.length === 0) return 1
  if (right.length === 0) return -1

  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const a = left[index]
    const b = right[index]
    if (a === undefined) return -1
    if (b === undefined) return 1
    const numericA = /^\d+$/.test(a)
    const numericB = /^\d+$/.test(b)
    if (numericA && numericB) {
      const diff = Number(a) - Number(b)
      if (diff !== 0) return diff > 0 ? 1 : -1
    } else if (numericA !== numericB) {
      return numericA ? -1 : 1
    } else if (a !== b) {
      return a > b ? 1 : -1
    }
  }
  return 0
}

/** SemVer 2.0.0 precedence, including prerelease identifiers. */
export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (!a || !b) return 0
  if (a.major !== b.major) return a.major > b.major ? 1 : -1
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1
  return comparePrerelease(a.prerelease, b.prerelease)
}

export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0
}

function isSemver(value: string): boolean {
  return SEMVER_PATTERN.test(value)
}

export function releaseNotesExcerpt(body: string | undefined, maxLength = 280): string {
  if (!body) return ''
  const cleaned = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>~]/g, '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (cleaned.length <= maxLength) return cleaned
  return `${cleaned.slice(0, maxLength).trimEnd()}…`
}

export function parseMobileRelease(raw: unknown): MobileRelease | null {
  if (!raw || typeof raw !== 'object') return null
  const release = raw as GitHubRelease
  if (release.draft === true || release.prerelease === true) return null

  const assets = Array.isArray(release.assets) ? release.assets : []
  let version: string | null = null
  let apkUrl: string | null = null
  let ipaUrl: string | null = null

  for (const asset of assets) {
    if (
      !asset ||
      typeof asset.name !== 'string' ||
      typeof asset.browser_download_url !== 'string'
    ) {
      continue
    }
    const apk = APK_PATTERN.exec(asset.name)
    if (apk?.[1] && isSemver(apk[1])) {
      version = version ?? apk[1]
      apkUrl = apkUrl ?? asset.browser_download_url
      continue
    }
    const ipa = IPA_PATTERN.exec(asset.name)
    if (ipa?.[1] && isSemver(ipa[1])) {
      version = version ?? ipa[1]
      ipaUrl = ipaUrl ?? asset.browser_download_url
    }
  }

  if (!version) return null
  if (typeof release.html_url !== 'string' || !release.html_url) return null

  return {
    version,
    apkUrl,
    ipaUrl,
    pageUrl: release.html_url,
    notes: releaseNotesExcerpt(release.body),
    publishedAt: typeof release.published_at === 'string' ? release.published_at : null
  }
}

export function pickLatestRelease(releases: unknown[]): MobileRelease | null {
  const parsed = releases
    .map((release) => parseMobileRelease(release))
    .filter((release): release is MobileRelease => release !== null)
  if (parsed.length === 0) return null
  return parsed.reduce((latest, release) =>
    compareVersions(release.version, latest.version) > 0 ? release : latest
  )
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`
}
