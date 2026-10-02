import React, { useState } from 'react'
import clsx from 'clsx'
import { CaretDown, FileText } from '@phosphor-icons/react'
import type { HarnessContextSnapshot } from '../../../shared/types'

interface HarnessContextInjectionProps {
  snapshot: HarnessContextSnapshot
  reduceMotion?: boolean
}

export function HarnessContextInjection({
  snapshot,
  reduceMotion = false
}: HarnessContextInjectionProps): React.JSX.Element {
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null)
  const entries = snapshot.entries

  if (!entries || entries.length === 0) return <></>

  return (
    <div
      className={clsx(
        'w-fit max-w-full my-1 select-none flex flex-col gap-0.5 px-4',
        reduceMotion ? '[&_*]:!transition-none' : 'animate-message'
      )}
      aria-label="Harness context injections"
    >
      {entries.map((entry) => {
        const isExpanded = expandedEntryId === entry.id
        const label = entry.label || entry.kind || 'Context injection'

        return (
          <article key={entry.id} className="min-w-0">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 py-0.5 text-left text-[12px] font-medium text-text-secondary/70 hover:text-text-secondary transition-colors outline-none focus-visible:ring-1 focus-visible:ring-accent-primary/55 rounded-sm group cursor-pointer"
              aria-expanded={isExpanded}
              onClick={() => setExpandedEntryId(isExpanded ? null : entry.id)}
            >
              <FileText size={12} className="shrink-0 text-text-muted/70 group-hover:text-text-secondary" />
              <span className="truncate max-w-[400px]">
                Injected <span className="font-mono text-[11px] text-text-secondary/90">{label}</span>
              </span>
              <span className="text-[10px] text-text-muted/50 tabular-nums">
                {entry.characterCount.toLocaleString()} chars
              </span>
              <CaretDown
                size={10}
                className={clsx(
                  'shrink-0 text-text-muted/60 transition-transform duration-200 group-hover:text-text-secondary ml-0.5',
                  isExpanded && 'rotate-180'
                )}
              />
            </button>

            {isExpanded && (
              <div className="mb-1.5 ml-[5px] mt-1 space-y-1.5 border-l border-white/[0.07] pb-0.5 pl-3 pr-1 animate-fade-in max-w-full">
                <div className="flex items-center justify-between gap-3 text-[10px] text-text-muted/60 mb-1">
                  <span className="truncate" title={entry.origin}>
                    {entry.origin}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {entry.characterCount.toLocaleString()} chars
                  </span>
                </div>
                <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-md bg-black/25 p-2 font-mono text-[10px] leading-relaxed text-text-secondary custom-scrollbar border border-white/[0.04]">
                  {entry.content}
                </pre>
              </div>
            )}
          </article>
        )
      })}
    </div>
  )
}
