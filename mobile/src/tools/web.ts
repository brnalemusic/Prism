export function validatePublicUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('Enter a valid public HTTP(S) URL.')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new Error('Only HTTP and HTTPS pages are supported.')
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (url.username || url.password || host.includes(':'))
    throw new Error('Credentials and literal IP addresses are not allowed for web tools.')
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host === '::1' ||
    host === '0.0.0.0' ||
    host.startsWith('fc') ||
    host.startsWith('fd') ||
    host.startsWith('fe80:') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^\d+$/.test(host) ||
    host.includes('@')
  )
    throw new Error('Local and private network addresses are blocked.')
  return url
}

async function boundedFetch(url: URL, signal: AbortSignal): Promise<Response> {
  let current = url
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetch(current.toString(), { signal, redirect: 'manual' })
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      if (!response.ok) throw new Error(`Page request failed (${response.status}).`)
      return response
    }
    const location = response.headers.get('location')
    if (!location) throw new Error('The page redirected without a destination.')
    current = validatePublicUrl(new URL(location, current).toString())
  }
  throw new Error('The page exceeded the three-redirect limit.')
}

function extractText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/article|\/section)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*/g, '\n')
    .trim()
}

export async function fetchPage(raw: string, limit: number, signal: AbortSignal): Promise<string> {
  const url = validatePublicUrl(raw)
  const response = await boundedFetch(url, signal)
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > 1_000_000) throw new Error('Page exceeds the 1 MB response limit.')
  const html = await readBoundedText(response, 1_000_000)
  return `Source: ${response.url || url.toString()}\n\n${extractText(html).slice(0, Math.max(1000, Math.min(limit, 12000)))}${html.length >= 1_000_000 ? '\n[Response truncated]' : ''}`
}

export async function searchWeb(
  query: string,
  count: number,
  signal: AbortSignal
): Promise<string> {
  const clean = query.trim().slice(0, 500)
  if (!clean) throw new Error('A search query is required.')
  const url = new URL('https://html.duckduckgo.com/html/')
  url.searchParams.set('q', clean)
  const response = await boundedFetch(url, signal)
  const html = await readBoundedText(response, 1_000_000)
  const results: Array<{ title: string; url: string; snippet: string }> = []
  const blocks = html.split(/class="result\b/).slice(1)
  for (const block of blocks) {
    if (results.length >= Math.min(5, Math.max(1, count))) break
    const link = block.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
    if (!link) continue
    let target = link[1] || ''
    try {
      const parsed = new URL(target, 'https://html.duckduckgo.com')
      const redirect = parsed.searchParams.get('uddg')
      target = redirect ? decodeURIComponent(redirect) : parsed.toString()
      validatePublicUrl(target)
    } catch {
      continue
    }
    const snippet = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/[^>]+>/i)?.[1] || ''
    results.push({
      title: extractText(link[2] || '').slice(0, 240),
      url: target,
      snippet: extractText(snippet).slice(0, 600)
    })
  }
  if (!results.length) return `No DuckDuckGo results found for: ${clean}`
  return results
    .map((result, index) => `${index + 1}. ${result.title}\n${result.url}\n${result.snippet}`)
    .join('\n\n')
}

async function readBoundedText(response: Response, limit: number): Promise<string> {
  if (!response.body) return (await response.text()).slice(0, limit)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let output = ''
  try {
    while (output.length < limit) {
      const { value, done } = await reader.read()
      if (done) break
      if (value) output += decoder.decode(value, { stream: true })
    }
    output += decoder.decode()
    return output.slice(0, limit)
  } finally {
    try {
      await reader.cancel()
    } catch {}
  }
}
