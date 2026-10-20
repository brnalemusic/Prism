/**
 * Text helpers used by chat titles and list previews. Kept dependency-free so
 * they can be unit tested outside the React Native runtime.
 */

export function stripMarkdown(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~#>]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function deriveTitle(input: string, maxLength = 52): string {
  const firstLine =
    input
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ''
  const cleaned = stripMarkdown(firstLine)
  if (!cleaned) return 'New session'
  if (cleaned.length <= maxLength) return cleaned
  const cut = cleaned.slice(0, maxLength)
  const lastSpace = cut.lastIndexOf(' ')
  const safeCut = lastSpace > maxLength * 0.5 ? cut.slice(0, lastSpace) : cut
  return `${safeCut.trimEnd()}…`
}

export function previewText(input: string, maxLength = 96): string {
  const cleaned = stripMarkdown(input)
  if (cleaned.length <= maxLength) return cleaned
  return `${cleaned.slice(0, maxLength).trimEnd()}…`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  const diff = Math.max(0, now - timestamp)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff < minute) return 'now'
  if (diff < hour) return `${Math.floor(diff / minute)}m`
  if (diff < day) return `${Math.floor(diff / hour)}h`
  if (diff < 7 * day) return `${Math.floor(diff / day)}d`

  const date = new Date(timestamp)
  const month = MONTHS[date.getMonth()] ?? ''
  return `${date.getDate()} ${month}`
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return ''
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

export function formatClockTime(timestamp: number): string {
  const date = new Date(timestamp)
  const hours = date.getHours().toString().padStart(2, '0')
  const minutes = date.getMinutes().toString().padStart(2, '0')
  return `${hours}:${minutes}`
}

export function maskApiKey(key: string): string {
  if (key.length <= 8) return '••••'
  return `${key.slice(0, 4)}••••${key.slice(-4)}`
}
