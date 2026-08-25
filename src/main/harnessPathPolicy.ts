import { promises as fs } from 'fs'
import * as path from 'path'

export function isInsideHarnessRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  )
}

export async function resolveHarnessProjectPath(
  projectRoot: string,
  requestedPath: string,
  allowMissing = false
): Promise<string> {
  const cleaned = requestedPath.trim() || '.'
  if (path.isAbsolute(cleaned) || /^[a-zA-Z]:/.test(cleaned) || cleaned.startsWith('\\\\')) {
    throw new Error('Harness paths must be relative to the project root.')
  }
  const root = await fs.realpath(path.resolve(projectRoot))
  const candidate = path.resolve(root, cleaned)
  if (!isInsideHarnessRoot(root, candidate)) {
    throw new Error('Path escapes the Harness project root.')
  }

  let existing = candidate
  while (true) {
    try {
      const realExisting = await fs.realpath(existing)
      if (!isInsideHarnessRoot(root, realExisting)) {
        throw new Error('Path resolves outside the Harness project root.')
      }
      if (!allowMissing && existing !== candidate)
        throw new Error(`Path does not exist: ${cleaned}`)
      return candidate
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      if (!allowMissing) throw new Error(`Path does not exist: ${cleaned}`)
      const parent = path.dirname(existing)
      if (parent === existing || !isInsideHarnessRoot(root, parent)) {
        throw new Error('Could not resolve a safe parent inside the Harness project root.')
      }
      existing = parent
    }
  }
}
