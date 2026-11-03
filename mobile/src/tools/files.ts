import * as FileSystem from 'expo-file-system/legacy'
import { readJson } from '../storage/preferences'
import { NativeModules } from 'react-native'

const GRANTS_KEY = 'prism.mobile.settings.v1'
const MAX_TEXT_BYTES = 80_000
const PRIVATE_ROOT = FileSystem.documentDirectory

interface Grant {
  id: string
  label: string
  uri: string
}

async function grants(): Promise<Grant[]> {
  const settings = await readJson<Record<string, unknown>>(GRANTS_KEY, {})
  return Array.isArray(settings.storageGrants) ? (settings.storageGrants as Grant[]) : []
}

export async function chooseStorageFolder(): Promise<Grant | null> {
  const result = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync()
  if (!result.granted) return null
  const grant = {
    id: `grant_${Date.now()}`,
    label: result.directoryUri.split('/').pop() || 'Selected folder',
    uri: result.directoryUri
  }
  return grant
}

function parts(raw: string): string[] {
  const normalized = raw.replace(/\\/g, '/').trim()
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z][\w+.-]*:/.test(normalized)) {
    throw new Error('Use a relative path inside Prism storage or a granted folder.')
  }
  const result = normalized.split('/').filter(Boolean)
  if (
    result.some(
      (part) => part === '.' || part === '..' || part.includes(':') || part.includes('\0')
    )
  ) {
    throw new Error('The path contains an unsupported segment.')
  }
  return result
}

async function resolve(raw: string, createParents = false): Promise<{ uri: string; name: string }> {
  const segments = parts(raw)
  const roots = [
    ...(PRIVATE_ROOT ? [{ id: 'private', label: 'Prism', uri: PRIVATE_ROOT }] : []),
    ...(await grants())
  ]
  const [rootName, ...relative] = segments
  const root = roots.find(
    (entry) => entry.id === rootName || entry.label.toLowerCase() === rootName?.toLowerCase()
  )
  if (!root)
    throw new Error(
      `Storage root not found. Available roots: ${roots.map((entry) => (entry.id === 'private' ? 'Prism' : entry.label)).join(', ') || 'none'}.`
    )
  let current = root.uri
  const isSaf = current.startsWith('content://')
  for (const segment of relative) {
    const children = isSaf
      ? await FileSystem.StorageAccessFramework.readDirectoryAsync(current)
      : await FileSystem.readDirectoryAsync(current)
    const found = children.find(
      (child) => decodeURIComponent(child.split('/').pop() || '') === segment
    )
    if (!found) {
      if (!createParents) throw new Error(`Directory not found: ${segment}`)
      if (!isSaf) {
        current = `${current}${segment}/`
        await FileSystem.makeDirectoryAsync(current, { intermediates: true })
      } else current = await FileSystem.StorageAccessFramework.makeDirectoryAsync(current, segment)
    } else current = found
  }
  return { uri: current, name: relative.at(-1) || '' }
}

export async function listFiles(directory: string): Promise<string> {
  const segments = parts(directory)
  if (segments.length === 1 && segments[0] === 'Prism') {
    const children = await FileSystem.readDirectoryAsync(PRIVATE_ROOT || '')
    return children.join('\n') || '(empty)'
  }
  const resolved = await resolve(directory)
  const children = resolved.uri.startsWith('content://')
    ? await FileSystem.StorageAccessFramework.readDirectoryAsync(resolved.uri)
    : await FileSystem.readDirectoryAsync(resolved.uri)
  return (
    children.map((uri) => decodeURIComponent(uri.split('/').pop() || '')).join('\n') || '(empty)'
  )
}

export async function readFile(path: string, maxCharacters: number): Promise<string> {
  const segments = parts(path)
  const filename = segments.pop()
  if (!filename || segments.length === 0)
    throw new Error('Specify a file under Prism or a granted folder.')
  const parent = await resolve(segments.join('/'))
  const uri = parent.uri.startsWith('content://')
    ? (await FileSystem.StorageAccessFramework.readDirectoryAsync(parent.uri)).find(
        (child) => decodeURIComponent(child.split('/').pop() || '') === filename
      )
    : `${parent.uri}${filename}`
  if (!uri) throw new Error(`File not found: ${filename}`)
  const info = await FileSystem.getInfoAsync(uri)
  if (!info.exists || info.isDirectory) throw new Error('File not found or is a directory.')
  if (info.size && info.size > MAX_TEXT_BYTES) throw new Error('File exceeds the 80 KB text limit.')
  const text = await FileSystem.readAsStringAsync(uri)
  return text.slice(0, Math.min(maxCharacters, 20_000))
}

export async function writeFile(path: string, content: string): Promise<string> {
  if (content.length > MAX_TEXT_BYTES) throw new Error('File content exceeds the 80 KB text limit.')
  const segments = parts(path)
  if (segments.length < 2) throw new Error('Specify a file name under Prism or a granted folder.')
  const root = segments[0]
  const filename = segments.pop()!
  const parentPath = segments.join('/')
  if (root === 'Prism' && PRIVATE_ROOT) {
    const folder = `${PRIVATE_ROOT}${segments.slice(1).join('/')}${segments.length > 1 ? '/' : ''}`
    await FileSystem.makeDirectoryAsync(folder, { intermediates: true })
    const target = `${folder}${filename}`
    if ((await FileSystem.getInfoAsync(target)).exists)
      throw new Error('The file already exists. Overwriting files is not enabled for Mobile tools.')
    await FileSystem.writeAsStringAsync(target, content)
    return `Wrote ${filename} in Prism private storage.`
  }
  const parent = await resolve(parentPath, true)
  if (!parent.uri.startsWith('content://'))
    throw new Error('The selected storage root is no longer available.')
  const uri = await FileSystem.StorageAccessFramework.createFileAsync(
    parent.uri,
    filename,
    'text/plain'
  )
  await FileSystem.writeAsStringAsync(uri, content)
  return `Created ${filename} in ${root}. Existing files are never overwritten via SAF.`
}

export async function forgetStorageGrant(id: string): Promise<void> {
  const settings = await readJson<Record<string, unknown>>(GRANTS_KEY, {})
  const current = Array.isArray(settings.storageGrants) ? (settings.storageGrants as Grant[]) : []
  const removed = current.find((grant) => grant.id === id)
  settings.storageGrants = current.filter((grant) => grant.id !== id)
  const { writeJson } = await import('../storage/preferences')
  await writeJson(GRANTS_KEY, settings)
  if (removed?.uri) {
    try {
      await NativeModules.PrismTerminal?.releaseFolderGrant(removed.uri)
    } catch {}
  }
}
