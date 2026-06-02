import { useState } from 'react'
import { Warning as AlertIcon, CaretDown } from '@phosphor-icons/react'
import clsx from 'clsx'
import type { ToolCall } from './ActionLoader'

interface MalformedToolCallWarningProps {
  toolCall: ToolCall
}

export function MalformedToolCallWarning({
  toolCall
}: MalformedToolCallWarningProps): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false)
  const errorMessage =
    (toolCall.args.errorMessage as string) ||
    'The model attempted to call a tool but generated a malformed JSON payload (for example, omitting the type field).'

  return (
    <div className="my-2 flex flex-col gap-2 max-w-full select-none">
      {/* ── Text-Only Expansible Trigger ── */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="inline-flex items-center gap-2 text-[13px] py-1 select-none cursor-pointer hover:opacity-80 active:scale-[0.99]"
      >
        <div className="flex shrink-0 items-center justify-center text-status-warning">
          <AlertIcon size={13} weight="fill" />
        </div>

        <span className="font-semibold text-text-primary leading-none">
          AI stopped due to a malformed Tool Call
        </span>
        <span className="text-[11px] font-medium leading-none opacity-80 text-status-warning">
          (Error)
        </span>

        <div className="flex items-center gap-1.5 ml-1">
          <CaretDown
            size={12}
            className={clsx(
              'text-text-muted transition-transform duration-200',
              isExpanded && 'rotate-180'
            )}
          />
        </div>
      </div>

      {/* ── Expanded Detail (Collapsible) ── */}
      {isExpanded && (
        <div className="pl-5 flex flex-col gap-2 animate-fade-in py-1 max-w-[500px]">
          <p className="text-xs text-text-secondary/80 leading-relaxed whitespace-pre-wrap">
            {errorMessage}
            {'\n\nThe system automatically reported the error back to the AI model to retry.'}
          </p>
        </div>
      )}
    </div>
  )
}
