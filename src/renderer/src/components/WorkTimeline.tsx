import React, { useId, useLayoutEffect, useRef, useState } from 'react'
import { CaretDown, CaretRight } from '@phosphor-icons/react'
import { splitChatTimeline, type ChatTimelineEntry } from '../chatTimeline'

export function WorkTimeline({
  entries,
  active,
  seconds,
  renderEntry
}: {
  entries: ChatTimelineEntry[]
  active: boolean
  seconds: number
  renderEntry: (entry: ChatTimelineEntry) => React.ReactNode
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const anchorRef = useRef<{ scroller: HTMLElement; top: number } | null>(null)
  const id = useId()
  const { final, hasTools } = splitChatTimeline(entries)
  const visibleWhenCollapsed = new Set(final.map((entry) => entry.key))
  const open = active || expanded
  useLayoutEffect(() => {
    const anchor = anchorRef.current
    if (!anchor || !buttonRef.current) return
    anchor.scroller.scrollTop += buttonRef.current.getBoundingClientRect().top - anchor.top
    anchorRef.current = null
  }, [open])
  return (
    <div className="flex flex-col w-full gap-1.5" data-prism-work-timeline="true">
      {!active && hasTools && (
        <button
          ref={buttonRef}
          type="button"
          aria-expanded={open}
          aria-controls={id}
          title={open ? 'Hide work progress' : 'Show work progress'}
          className="w-full select-none flex items-center gap-1 text-xs text-text-secondary/60 font-medium hover:text-text-secondary transition-colors cursor-pointer text-left"
          onClick={() => {
            const button = buttonRef.current
            const scroller = button?.closest<HTMLElement>('[data-prism-chat-scroll]')
            if (button && scroller) {
              anchorRef.current = { scroller, top: button.getBoundingClientRect().top }
              scroller.dispatchEvent(new Event('prism-work-toggle'))
            }
            setExpanded((value) => !value)
          }}
        >
          {open ? <CaretDown size={12} /> : <CaretRight size={12} />}
          <span>
            Worked for {Math.max(1, seconds)} {Math.max(1, seconds) === 1 ? 'second' : 'seconds'}
          </span>
        </button>
      )}
      <div id={id} className="flex flex-col gap-1.5">
        {entries.map((entry) => (
          <div
            key={entry.key}
            className="contents"
            hidden={!open && !visibleWhenCollapsed.has(entry.key)}
          >
            {renderEntry(entry)}
          </div>
        ))}
      </div>
    </div>
  )
}
