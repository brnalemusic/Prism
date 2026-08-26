import React, { useState, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { GlobeSimple, Robot, X } from '@phosphor-icons/react'
import type { HarnessSource } from '../../../shared/types'
import type { Message, ToolCallItem } from '../types/tab'
import { decodeHarnessToolResult, type DecodedFetchSubagent } from '../harnessToolPresentation'
import { CopyMessageButton } from './CopyMessageButton'
import { TtsButton } from './TtsButton'

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

export function SourcePill({
  source,
  index = 0
}: {
  source: HarnessSource
  index?: number
}): React.JSX.Element {
  const domain = source.domain || getDomainFromUrl(source.url)

  return (
    <button
      type="button"
      onClick={() => void window.api.openExternalUrl(source.url)}
      title={`${source.title}\n${source.url}`}
      style={{ animationDelay: `${index * 120}ms` }}
      className="animate-source-pill group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] hover:border-white/[0.16] text-[11.5px] text-text-secondary hover:text-text-primary transition-[colors,border-color,box-shadow] duration-150 cursor-pointer shadow-xs max-w-[220px]"
    >
      <SourceFavicon source={source} />
      <span className="truncate font-normal">{domain}</span>
    </button>
  )
}

export function FetchSubagentPill({
  subagent,
  index = 0
}: {
  subagent: DecodedFetchSubagent
  index?: number
}): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        title={subagent.query ? `Fetch Subagent: ${subagent.query}` : 'Fetch Subagent'}
        style={{ animationDelay: `${index * 120}ms` }}
        className={`animate-source-pill group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] transition-[colors,border-color,box-shadow] duration-150 cursor-pointer shadow-xs max-w-[260px] ${
          isOpen
            ? 'bg-accent-primary/20 border border-accent-primary/40 text-accent-primary'
            : 'bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] hover:border-white/[0.16] text-text-secondary hover:text-text-primary'
        }`}
      >
        <Robot size={13} className="shrink-0 text-accent-primary" />
        <span className="truncate font-medium">Fetch Subagent</span>
      </button>

      {isOpen && (
        <div className="w-full mt-2 mb-1 p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.1] shadow-lg animate-fade-in flex flex-col gap-2.5 select-text">
          {/* Header */}
          <div className="flex items-center justify-between gap-2 select-none border-b border-white/[0.06] pb-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-accent-primary/15 text-accent-primary text-[11px] font-semibold tracking-wide uppercase">
                <Robot size={13} />
                Fetch Subagent
              </span>
              {subagent.query && (
                <span className="text-[11.5px] text-text-muted truncate font-normal">
                  "{subagent.query}"
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              title="Close"
              className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-white/[0.08] transition-colors cursor-pointer"
            >
              <X size={14} />
            </button>
          </div>

          {/* Subagent Markdown Response */}
          <div className="text-[12.5px] leading-relaxed text-text-primary/90 space-y-2 max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
              {subagent.summary}
            </ReactMarkdown>
          </div>

          {/* Real Sources read by the subagent */}
          {subagent.sources && subagent.sources.length > 0 && (
            <div className="w-full pt-1">
              <div className="text-[10.5px] font-medium text-text-muted uppercase tracking-wider mb-1 select-none">
                Sources ({subagent.sources.length})
              </div>
              <SourcePills sources={subagent.sources} />
            </div>
          )}

          {/* Copy and TTS Buttons */}
          <div className="flex items-center gap-1.5 pt-1 border-t border-white/[0.06] select-none opacity-80 hover:opacity-100 transition-opacity">
            <CopyMessageButton text={subagent.summary} />
            <TtsButton text={subagent.summary} />
          </div>
        </div>
      )}
    </>
  )
}

export function SourcePills({
  sources = [],
  fetchSubagents = [],
  className
}: {
  sources?: HarnessSource[]
  fetchSubagents?: DecodedFetchSubagent[]
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

  const totalCount = deduplicatedSources.length + (fetchSubagents?.length || 0)
  if (totalCount === 0) return null

  let pillIndex = 0

  return (
    <div
      className={
        className ||
        'flex flex-wrap items-center gap-1.5 pt-1.5 pb-0.5 select-none'
      }
      aria-label="Search sources"
    >
      {fetchSubagents &&
        fetchSubagents.map((subagent, idx) => (
          <FetchSubagentPill
            key={`subagent-${idx}-${subagent.query}`}
            subagent={subagent}
            index={pillIndex++}
          />
        ))}
      {deduplicatedSources.map((source) => (
        <SourcePill key={source.url} source={source} index={pillIndex++} />
      ))}
    </div>
  )
}

export interface ExtractedMessageSources {
  sources: HarnessSource[]
  fetchSubagents: DecodedFetchSubagent[]
}

export function extractMessageSources(msg: Message): ExtractedMessageSources {
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
  const fetchSubagents: DecodedFetchSubagent[] = []
  const seenUrls = new Set<string>()
  const seenSubagents = new Set<string>()

  for (const tool of allTools) {
    if (!tool.result) continue
    const decoded = decodeHarnessToolResult(tool.result)

    if (decoded.fetchSubagent) {
      const subagentKey = `${decoded.fetchSubagent.query}-${decoded.fetchSubagent.summary}`
      if (!seenSubagents.has(subagentKey)) {
        seenSubagents.add(subagentKey)
        fetchSubagents.push(decoded.fetchSubagent)
      }
    }

    for (const source of decoded.sources) {
      if (source.url && !seenUrls.has(source.url)) {
        seenUrls.add(source.url)
        sources.push(source)
      }
    }
  }

  return { sources, fetchSubagents }
}
