import { useState } from 'react'
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

  return (
    <div
      className={`mb-3 mt-1 flex w-full flex-col gap-0.5 text-[12px] text-white/45 ${
        reduceMotion ? '[&_*]:!transition-none' : 'animate-message'
      }`}
      aria-label="Harness context injections"
    >
      {snapshot.entries.map((entry) => {
        const isExpanded = expandedEntryId === entry.id
        return (
          <div key={entry.id} className="min-w-0">
            <button
              type="button"
              className="group flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-white/[0.025] hover:text-white/65 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
              aria-expanded={isExpanded}
              onClick={() => setExpandedEntryId(isExpanded ? null : entry.id)}
            >
              <CaretDown
                size={12}
                weight="bold"
                className={`shrink-0 transition-transform ${isExpanded ? '' : '-rotate-90'}`}
              />
              <FileText size={13} className="shrink-0 text-white/35" />
              <span className="shrink-0 text-white/60">Context injection</span>
              <span aria-hidden="true" className="text-white/20">
                ·
              </span>
              <span className="min-w-0 truncate font-medium text-white/45">{entry.label}</span>
            </button>

            {isExpanded && (
              <div className="ml-[34px] mr-1 mb-2 overflow-hidden rounded-lg border border-white/[0.055] bg-black/20">
                <div className="flex items-center justify-between gap-3 border-b border-white/[0.045] px-3 py-2 text-[10px] text-white/30">
                  <span className="min-w-0 truncate" title={entry.origin}>
                    {entry.origin}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {entry.characterCount.toLocaleString()} chars
                  </span>
                </div>
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words px-3 py-2.5 font-mono text-[11px] leading-[1.55] text-white/55 selection:bg-white/15">
                  {entry.content}
                </pre>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
