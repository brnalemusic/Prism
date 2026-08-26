import React, { useState, useMemo } from 'react'
import { GlobeSimple } from '@phosphor-icons/react'
import type { HarnessSource } from '../../../shared/types'
import type { Message, ToolCallItem } from '../types/tab'
import { decodeHarnessToolResult } from '../harnessToolPresentation'

function getDomainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function SourceFavicon({
  source,
  className = 'w-3.5 h-3.5 rounded-full shrink-0 object-contain'
}: {
  source: HarnessSource
  className?: string
}): React.JSX.Element {
  const [error, setError] = useState(false)
  const domain = source.domain || getDomainFromUrl(source.url)
  const iconSrc =
    !error && source.faviconUrl
      ? source.faviconUrl
      : !error && domain
        ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`
        : null

  if (!iconSrc || error) {
    return <GlobeSimple size={12} className="shrink-0 text-text-muted group-hover:text-text-secondary" />
  }

  return (
    <img
      src={iconSrc}
      alt=""
      onError={() => setError(true)}
      className={className}
      loading="lazy"
    />
  )
}

export function SourcePill({ source }: { source: HarnessSource }): React.JSX.Element {
  const domain = source.domain || getDomainFromUrl(source.url)

  return (
    <button
      type="button"
      onClick={() => void window.api.openExternalUrl(source.url)}
      title={`${source.title}\n${source.url}`}
      className="group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] hover:border-white/[0.16] text-[11.5px] text-text-secondary hover:text-text-primary transition-all duration-150 cursor-pointer shadow-xs max-w-[220px]"
    >
      <SourceFavicon source={source} />
      <span className="truncate font-normal">{domain}</span>
    </button>
  )
}

export function SourcePills({
  sources,
  className
}: {
  sources: HarnessSource[]
  className?: string
}): React.JSX.Element | null {
  const deduplicatedSources = useMemo(() => {
    const seen = new Set<string>()
    const list: HarnessSource[] = []
    for (const source of sources) {
      const key = source.url || source.domain || source.title
      if (!key || seen.has(key)) continue
      seen.add(key)
      list.push(source)
    }
    return list
  }, [sources])

  if (deduplicatedSources.length === 0) return null

  return (
    <div
      className={
        className ||
        'flex flex-wrap items-center gap-1.5 pt-1.5 pb-0.5 select-none animate-fade-in'
      }
      aria-label="Search sources"
    >
      {deduplicatedSources.map((source) => (
        <SourcePill key={source.url} source={source} />
      ))}
    </div>
  )
}

export function extractMessageSources(msg: Message): HarnessSource[] {
  const allTools: ToolCallItem[] = []

  if (msg.harnessRounds && Array.isArray(msg.harnessRounds)) {
    for (const round of msg.harnessRounds) {
      if (round.toolCalls && Array.isArray(round.toolCalls)) {
        allTools.push(...round.toolCalls)
      }
    }
  }

  if (msg.toolCalls && Array.isArray(msg.toolCalls)) {
    allTools.push(...msg.toolCalls)
  }

  const sources: HarnessSource[] = []
  const seenUrls = new Set<string>()

  for (const tool of allTools) {
    if (!tool.result) continue
    const decoded = decodeHarnessToolResult(tool.result)
    for (const source of decoded.sources) {
      if (source.url && !seenUrls.has(source.url)) {
        seenUrls.add(source.url)
        sources.push(source)
      }
    }
  }

  return sources
}
