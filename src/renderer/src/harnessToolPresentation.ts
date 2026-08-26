import type { HarnessSource } from '../../shared/types'

export interface DecodedHarnessToolResult {
  ok?: boolean
  outputText: string
  output: unknown
  diff?: string
  sources: HarnessSource[]
  runId?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function asHarnessRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

export function stringifyHarnessValue(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) || ''
  } catch {
    return String(value ?? '')
  }
}

function parseSources(value: unknown): HarnessSource[] {
  if (!Array.isArray(value)) return []
  const sources: HarnessSource[] = []
  const seen = new Set<string>()
  for (const candidate of value) {
    if (!isRecord(candidate)) continue
    const url = typeof candidate.url === 'string' ? candidate.url.trim() : ''
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue
    seen.add(url)
    let fallbackDomain = ''
    try {
      fallbackDomain = new URL(url).hostname
    } catch {
      // The protocol check above is intentionally followed by URL validation.
    }
    sources.push({
      url,
      title:
        typeof candidate.title === 'string' && candidate.title.trim()
          ? candidate.title.trim()
          : fallbackDomain || url,
      domain:
        typeof candidate.domain === 'string' && candidate.domain.trim()
          ? candidate.domain.trim()
          : fallbackDomain,
      faviconUrl:
        typeof candidate.faviconUrl === 'string' && /^https?:\/\//i.test(candidate.faviconUrl)
          ? candidate.faviconUrl
          : ''
    })
  }
  return sources
}

export function decodeHarnessToolResult(result?: string): DecodedHarnessToolResult {
  if (!result) return { outputText: '', output: '', sources: [] }
  if (typeof result !== 'string') {
    if (isRecord(result)) {
      const rawRecord = result as Record<string, unknown>
      const rawOutput = rawRecord.ok === false ? rawRecord.error : rawRecord.output
      const envelopeSources = parseSources(rawRecord.sources)
      return {
        ok: typeof rawRecord.ok === 'boolean' ? rawRecord.ok : undefined,
        outputText: stringifyHarnessValue(rawOutput ?? result),
        output: rawOutput ?? result,
        diff: isRecord(rawOutput) && typeof rawOutput.diff === 'string' ? rawOutput.diff : undefined,
        sources: envelopeSources,
        runId: isRecord(rawOutput) && typeof rawOutput.runId === 'string' ? rawOutput.runId : undefined
      }
    }
    return { outputText: String(result), output: result, sources: [] }
  }
  try {
    const parsedEnvelope = JSON.parse(result) as unknown
    if (!isRecord(parsedEnvelope)) {
      return { outputText: result, output: result, sources: [] }
    }
    const rawOutput = parsedEnvelope.ok === false ? parsedEnvelope.error : parsedEnvelope.output
    const envelopeSources = parseSources(parsedEnvelope.sources)

    if (typeof rawOutput !== 'string') {
      const outputSources = isRecord(rawOutput) ? parseSources(rawOutput.sources) : []
      const combinedSources = outputSources.length > 0 ? outputSources : envelopeSources
      return {
        ok: typeof parsedEnvelope.ok === 'boolean' ? parsedEnvelope.ok : undefined,
        outputText: stringifyHarnessValue(rawOutput),
        output: rawOutput,
        diff: isRecord(rawOutput) && typeof rawOutput.diff === 'string' ? rawOutput.diff : undefined,
        sources: combinedSources,
        runId: isRecord(rawOutput) && typeof rawOutput.runId === 'string' ? rawOutput.runId : undefined
      }
    }
    try {
      const parsedOutput = JSON.parse(rawOutput) as unknown
      if (!isRecord(parsedOutput)) {
        return {
          ok: typeof parsedEnvelope.ok === 'boolean' ? parsedEnvelope.ok : undefined,
          outputText: rawOutput,
          output: rawOutput,
          sources: envelopeSources
        }
      }
      const outputSources = parseSources(parsedOutput.sources)
      const combinedSources = outputSources.length > 0 ? outputSources : envelopeSources
      return {
        ok: typeof parsedEnvelope.ok === 'boolean' ? parsedEnvelope.ok : undefined,
        outputText: stringifyHarnessValue(parsedOutput),
        output: parsedOutput,
        diff: typeof parsedOutput.diff === 'string' ? parsedOutput.diff : undefined,
        sources: combinedSources,
        runId: typeof parsedOutput.runId === 'string' ? parsedOutput.runId : undefined
      }
    } catch {
      return {
        ok: typeof parsedEnvelope.ok === 'boolean' ? parsedEnvelope.ok : undefined,
        outputText: rawOutput,
        output: rawOutput,
        sources: envelopeSources
      }
    }
  } catch {
    return { outputText: result, output: result, sources: [] }
  }
}
