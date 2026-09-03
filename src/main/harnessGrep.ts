import { promises as fs } from 'fs'
import * as path from 'path'

export function harnessWildcardRegex(query: string): RegExp {
  let pattern = ''
  for (let index = 0; index < query.length; index += 1) {
    const character = query[index]
    if (character === '*' && query[index + 1] === '*') {
      if (query[index + 2] === '/') {
        pattern += '(?:.*/)?'
        index += 2
      } else {
        pattern += '.*'
        index += 1
      }
    } else if (character === '*') {
      pattern += '[^/]*'
    } else {
      pattern += character.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${pattern}$`, 'i')
}

export const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.webp',
  '.ico',
  '.svgz',
  '.exe',
  '.dll',
  '.dylib',
  '.so',
  '.bin',
  '.dat',
  '.iso',
  '.zip',
  '.tar',
  '.gz',
  '.7z',
  '.rar',
  '.bz2',
  '.xz',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.mp3',
  '.wav',
  '.ogg',
  '.flac',
  '.aac',
  '.m4a',
  '.mp4',
  '.avi',
  '.mov',
  '.mkv',
  '.webm',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.otf',
  '.pyc',
  '.pyo',
  '.class',
  '.db',
  '.sqlite',
  '.sqlite3',
  '.node',
  '.lock'
])

export const IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'out',
  '.next',
  '.vite',
  '.cache',
  '.turbo',
  '.output',
  'build'
])

export interface GrepMatchFile {
  path: string
  lines: number[]
}

export interface GrepResult {
  query: string
  totalMatches: number
  filesSearched: number
  matches: GrepMatchFile[]
}

export function isBinaryBuffer(buffer: Buffer): boolean {
  const checkLength = Math.min(buffer.length, 512)
  for (let i = 0; i < checkLength; i++) {
    if (buffer[i] === 0) return true
  }
  return false
}

export async function grepFiles(
  root: string,
  start: string,
  query: string,
  options: {
    include?: string
    isRegex?: boolean
    caseSensitive?: boolean
    wordMatch?: boolean
    limit?: number
  } = {}
): Promise<GrepResult> {
  const limit = options.limit ?? 200
  // Smart-case: if caseSensitive is undefined, default to true if query has uppercase letters
  const caseSensitive =
    options.caseSensitive !== undefined ? Boolean(options.caseSensitive) : /[A-Z]/.test(query)
  const isRegex = Boolean(options.isRegex)
  const wordMatch = Boolean(options.wordMatch)

  let regex: RegExp | null = null
  if (isRegex) {
    const rawPattern = wordMatch ? `\\b(?:${query})\\b` : query
    regex = new RegExp(rawPattern, caseSensitive ? '' : 'i')
  } else if (wordMatch) {
    const escaped = query.replace(/[.+^${}()|[\]\\?*]/g, '\\$&')
    regex = new RegExp(`\\b${escaped}\\b`, caseSensitive ? '' : 'i')
  }
  const lowerQuery = caseSensitive ? query : query.toLowerCase()

  const includeMatcher = options.include
    ? harnessWildcardRegex(options.include.replace(/\\/g, '/'))
    : null

  const matches: GrepMatchFile[] = []
  let totalMatches = 0
  let filesSearched = 0

  const searchSingleFile = async (absolutePath: string, relativePath: string): Promise<void> => {
    if (totalMatches >= limit) return
    const ext = path.extname(absolutePath).toLowerCase()
    if (BINARY_EXTENSIONS.has(ext)) return

    let stat
    try {
      stat = await fs.stat(absolutePath)
    } catch {
      return
    }
    if (!stat.isFile() || stat.size === 0 || stat.size > 10 * 1024 * 1024) return

    filesSearched++
    try {
      const buffer = await fs.readFile(absolutePath)
      if (isBinaryBuffer(buffer)) return
      const content = buffer.toString('utf8')
      const lines = content.replace(/\r\n/g, '\n').split('\n')
      const matchingLines: number[] = []

      for (let i = 0; i < lines.length; i++) {
        if (totalMatches >= limit) break
        const lineText = lines[i]
        const isMatch = regex
          ? regex.test(lineText)
          : caseSensitive
            ? lineText.includes(lowerQuery)
            : lineText.toLowerCase().includes(lowerQuery)
        if (isMatch) {
          matchingLines.push(i + 1)
          totalMatches++
        }
      }

      if (matchingLines.length > 0) {
        matches.push({
          path: relativePath,
          lines: matchingLines
        })
      }
    } catch {
      // Ignore unreadable files
    }
  }

  const walk = async (directory: string): Promise<void> => {
    if (totalMatches >= limit) return
    let entries
    try {
      entries = await fs.readdir(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (totalMatches >= limit) break
      if (IGNORED_DIRECTORIES.has(entry.name)) continue
      const fullPath = path.join(directory, entry.name)
      const relative = path.relative(root, fullPath).replace(/\\/g, '/')
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        await walk(fullPath)
      } else if (entry.isFile()) {
        if (
          !includeMatcher ||
          includeMatcher.test(relative) ||
          includeMatcher.test(entry.name)
        ) {
          await searchSingleFile(fullPath, relative)
        }
      }
    }
  }

  let startStat
  try {
    startStat = await fs.stat(start)
  } catch {
    return { query, totalMatches: 0, filesSearched: 0, matches: [] }
  }

  if (startStat.isFile()) {
    const relative = path.relative(root, start).replace(/\\/g, '/')
    await searchSingleFile(start, relative)
  } else {
    await walk(start)
  }

  return {
    query,
    totalMatches,
    filesSearched,
    matches
  }
}
