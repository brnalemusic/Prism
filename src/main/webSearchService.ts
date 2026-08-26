import { HarnessSource, ProviderConfig } from '../shared/types'
import { streamOpenAiCompletion } from './ai/openaiClient'
import { loadConfig } from './config'

export interface WebSearchResult {
  query: string
  sources: HarnessSource[]
  pages: Array<HarnessSource & { content: string }>
}

export interface WebFetchResult {
  query: string
  summary: string
  sources: HarnessSource[]
  isSubagentFetch: true
}

export function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
}

export function safeWebUrl(rawUrl: string): URL {
  const url = new URL(rawUrl)
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('Only HTTP(S) pages are allowed.')
  const hostname = url.hostname.toLowerCase()
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.local') ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    hostname === '::1'
  ) {
    throw new Error('Private and local network pages are not allowed.')
  }
  return url
}

export async function fetchHtml(
  urlValue: string,
  signal?: AbortSignal,
  redirects = 0
): Promise<string> {
  const url = safeWebUrl(urlValue)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12_000)
  const abort = (): void => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  try {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml'
      }
    })
    if (response.status >= 300 && response.status < 400) {
      if (redirects >= 5) throw new Error('Too many redirects.')
      const location = response.headers.get('location')
      if (!location) throw new Error('Redirect did not include a destination.')
      return fetchHtml(new URL(location, url).toString(), signal, redirects + 1)
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      throw new Error('Source is not an HTML page.')
    }
    return await response.text()
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
}

export function pageText(
  html: string,
  maximumCharacters: number
): { title: string; content: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = decodeEntities((titleMatch?.[1] || 'Untitled page').replace(/<[^>]+>/g, '')).trim()
  const content = decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|svg|nav|footer|noscript)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|article|section)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maximumCharacters)
  return { title, content }
}

export function duckDuckGoResultUrls(html: string): string[] {
  const urls: string[] = []
  for (const match of html.matchAll(/<a\b([^>]*\bclass="[^"]*result__a[^"]*"[^>]*)>/gi)) {
    const href = match[1].match(/\bhref="([^"]+)"/i)?.[1]
    if (!href) continue
    const decoded = decodeEntities(href)
    const absolute = decoded.startsWith('//') ? `https:${decoded}` : decoded
    try {
      const candidate = new URL(absolute, 'https://html.duckduckgo.com')
      const redirected = candidate.searchParams.get('uddg')
      const finalUrl = safeWebUrl(
        redirected ? decodeURIComponent(redirected) : candidate.toString()
      )
      if (!urls.includes(finalUrl.toString())) urls.push(finalUrl.toString())
    } catch {
      // Skip malformed or local result URLs.
    }
  }
  return urls
}

function extractDuckDuckGoNextParams(html: string): Record<string, string> | null {
  const formMatch = html.match(/<form\b[^>]*action="\/html\/"[^>]*>([\s\S]*?)<\/form>/i)
  if (!formMatch) return null
  const params: Record<string, string> = {}
  for (const inputMatch of formMatch[1].matchAll(/<input\b[^>]*name="([^"]+)"[^>]*value="([^"]*)"/gi)) {
    params[inputMatch[1]] = decodeEntities(inputMatch[2])
  }
  return Object.keys(params).length > 0 ? params : null
}

async function fetchDuckDuckGoCandidateUrls(
  query: string,
  minCandidates: number,
  signal?: AbortSignal
): Promise<string[]> {
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const firstPageHtml = await fetchHtml(searchUrl, signal)
  const candidateUrls = duckDuckGoResultUrls(firstPageHtml)

  // If we already have enough candidates or cannot paginate, return what we have
  if (candidateUrls.length >= minCandidates) {
    return candidateUrls
  }

  const nextParams = extractDuckDuckGoNextParams(firstPageHtml)
  if (nextParams) {
    try {
      const body = new URLSearchParams(nextParams).toString()
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 12_000)
      const abort = (): void => controller.abort()
      signal?.addEventListener('abort', abort, { once: true })

      const response = await fetch('https://html.duckduckgo.com/html/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml'
        },
        body,
        signal: controller.signal
      })
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)

      if (response.ok) {
        const secondPageHtml = await response.text()
        const secondPageUrls = duckDuckGoResultUrls(secondPageHtml)
        for (const u of secondPageUrls) {
          if (!candidateUrls.includes(u)) {
            candidateUrls.push(u)
          }
        }
      }
    } catch {
      // Ignore pagination errors and return first page results
    }
  }

  return candidateUrls
}

export async function searchAndReadWeb(
  query: string,
  options: { maxContextCharacters?: number; webPageCount: number },
  signal?: AbortSignal
): Promise<WebSearchResult> {
  const targetCount = options.webPageCount
  const maxContext = options.maxContextCharacters || 40_000
  const candidateUrls = await fetchDuckDuckGoCandidateUrls(query, targetCount * 2, signal)

  const pages: Array<HarnessSource & { content: string }> = []
  const perPageLimit = Math.max(2_000, Math.floor(maxContext / targetCount))

  for (const url of candidateUrls) {
    if (pages.length >= targetCount) break
    try {
      const html = await fetchHtml(url, signal)
      const extracted = pageText(html, perPageLimit)
      if (extracted.content.length < 200) continue
      const parsed = new URL(url)
      pages.push({
        title: extracted.title,
        url,
        domain: parsed.hostname.replace(/^www\./, ''),
        faviconUrl: `${parsed.origin}/favicon.ico`,
        content: extracted.content
      })
    } catch {
      // Continue until the target number of readable sources is reached.
    }
  }

  if (pages.length === 0) {
    throw new Error('DuckDuckGo returned no readable source pages.')
  }

  return {
    query,
    sources: pages.map((page) => ({
      title: page.title,
      url: page.url,
      domain: page.domain,
      faviconUrl: page.faviconUrl
    })),
    pages
  }
}

export async function fetchAndSummarizeWeb(
  query: string,
  options: {
    provider?: ProviderConfig
    modelId?: string
    signal?: AbortSignal
  }
): Promise<WebFetchResult> {
  // 1. Fetch and read up to 20 web pages
  const searchResult = await searchAndReadWeb(
    query,
    { maxContextCharacters: 200_000, webPageCount: 20 },
    options.signal
  )

  // 2. Prepare subagent model & provider
  let provider = options.provider
  let modelId = options.modelId
  if (!provider || !modelId) {
    const config = loadConfig()
    provider =
      config.providers.find((p) => p.models && p.models.some((m) => m.enabled)) ||
      config.providers[0]
    modelId = config.lastSelectedChatModel || config.quickLauncherModel || 'gpt-4o'
  }

  if (!provider) {
    throw new Error('No enabled AI provider available for Fetch Subagent.')
  }

  const formattedPages = searchResult.pages
    .map(
      (page, idx) =>
        `### Source ${idx + 1}: ${page.title}\nURL: ${page.url}\n\n${page.content.slice(0, 9500)}`
    )
    .join('\n\n---\n\n')

  const systemInstruction =
    'You are a focused web research subagent. Your only task is to synthesize and summarize the information from the 20 web pages provided below to answer the user inquiry directly.\n\n' +
    'MANDATORY RULES:\n' +
    '1. The response MUST be at least 500 characters and MUST NOT exceed 4000 characters in total length.\n' +
    '2. Be comprehensive, direct, clear, precise, and informative. Use Markdown.\n' +
    '3. Ground all facts in the provided source pages.\n' +
    '4. Do NOT use conversational greetings, preamble, or meta-commentary.'

  const userContent = `User query: "${query}"\n\nWeb Search Sources (20 pages):\n\n${formattedPages}`

  const result = await streamOpenAiCompletion(
    provider,
    modelId,
    [
      { role: 'system', content: systemInstruction },
      { role: 'user', content: userContent }
    ],
    [], // No tools for subagent
    options.signal || new AbortController().signal,
    {
      onTextDelta: () => {},
      onReasoningDelta: () => {},
      onToolCallDelta: () => {}
    }
  )

  let summary = result.text.trim()
  if (summary.length > 4000) {
    summary = summary.slice(0, 3997) + '...'
  }

  return {
    query,
    summary,
    sources: searchResult.sources,
    isSubagentFetch: true
  }
}
