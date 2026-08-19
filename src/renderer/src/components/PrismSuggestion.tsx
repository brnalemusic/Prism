import React, { useContext, useState } from 'react'
import { ArrowDownRight, Check } from '@phosphor-icons/react'
import { StreamContext } from './AnimatedStreamingText'

export interface SuggestionRuntime {
  messageKey: string
  isSendDisabled: boolean
  onSendSuggestion?: (payload: string, suggestionKey: string) => boolean
}

const defaultSuggestionRuntime: SuggestionRuntime = {
  messageKey: 'suggestion',
  isSendDisabled: true
}

export const SuggestionRuntimeContext =
  React.createContext<SuggestionRuntime>(defaultSuggestionRuntime)

interface MarkdownNode {
  position?: {
    start?: {
      offset?: number
    }
  }
}

interface PrismSuggestionProps {
  children?: React.ReactNode
  send?: string
  node?: MarkdownNode
}

function getSuggestionPayload(send: unknown): string {
  return typeof send === 'string' ? send.trim() : ''
}

function getSuggestionKey(
  messageKey: string,
  node: MarkdownNode | undefined,
  payload: string
): string {
  const offset = node?.position?.start?.offset
  return `${messageKey}:${offset ?? 'inline'}:${payload}`
}

/**
 * Removes Prism-only suggestion markup while retaining the text presented to the user.
 */
export function stripPrismSuggestionMarkup(value: string): string {
  return value
    .replace(
      /<prism-suggestion\b[^>]*>([\s\S]*?)<\/prism-suggestion\s*>/gi,
      (_match, visibleText: string) => visibleText
    )
    .replace(/<\/?prism-suggestion\b[^>]*>/gi, '')
}

export function PrismSuggestion({ children, send, node }: PrismSuggestionProps): React.JSX.Element {
  const { isStreaming } = useContext(StreamContext)
  const { messageKey, isSendDisabled, onSendSuggestion } = useContext(SuggestionRuntimeContext)
  const [isUsed, setIsUsed] = useState(false)
  const payload = getSuggestionPayload(send)
  const suggestionKey = getSuggestionKey(messageKey, node, payload)
  const isInteractive = Boolean(
    payload && onSendSuggestion && !isStreaming && !isSendDisabled && !isUsed
  )

  const content = (
    <>
      {children}
      {isUsed ? (
        <Check
          size={12}
          weight="bold"
          aria-hidden="true"
          className="ml-1 inline-block align-baseline"
        />
      ) : (
        <ArrowDownRight
          size={12}
          weight="bold"
          aria-hidden="true"
          className="ml-1 inline-block align-baseline"
        />
      )}
    </>
  )

  if (!payload) {
    return <>{children}</>
  }

  if (!isInteractive) {
    return (
      <span
        className={
          isUsed
            ? 'inline text-text-secondary/55 decoration-dotted underline underline-offset-4 cursor-default'
            : 'inline text-text-secondary/75 decoration-dotted underline underline-offset-4 cursor-default'
        }
        aria-disabled="true"
      >
        {content}
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={() => {
        if (onSendSuggestion?.(payload, suggestionKey)) {
          setIsUsed(true)
        }
      }}
      className="inline text-inherit decoration-dotted underline underline-offset-4 decoration-accent-secondary/80 transition-colors duration-150 hover:text-accent-secondary hover:decoration-accent-secondary focus-visible:outline-none focus-visible:text-accent-secondary focus-visible:ring-1 focus-visible:ring-accent-secondary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black cursor-pointer"
      title="Send suggestion"
      aria-label={`Send suggestion: ${payload}`}
    >
      {content}
    </button>
  )
}
