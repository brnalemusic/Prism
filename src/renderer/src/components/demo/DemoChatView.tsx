import { memo, useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ArrowLeft, ArrowClockwise, Brain, DownloadSimple } from '@phosphor-icons/react'
import clsx from 'clsx'
import type { DemoEvent, DemoScript } from '../../../../shared/demo'
import { playDemoScript } from '../../demo/playback'
import { ActionLoader, type ToolCall } from '../ActionLoader'
import {
  StreamContext,
  StaticMarkdownComponents,
  createStreamingFadeRehypePlugin,
  useStreamStats
} from '../AnimatedStreamingText'

interface DemoChatViewProps {
  script: DemoScript
  onBack: () => void
  onDownload: () => void
}

interface DemoChatMessage {
  id: string
  role: 'user' | 'ai'
  content: string
  thoughts: string
  isStreaming: boolean
  isThinking: boolean
  toolCalls: ToolCall[]
  toolUpdates: string[]
}

function createAiMessage(): DemoChatMessage {
  return {
    id: `ai-${Date.now()}`,
    role: 'ai',
    content: '',
    thoughts: '',
    isStreaming: true,
    isThinking: false,
    toolCalls: [],
    toolUpdates: []
  }
}

function getToolArgs(event: Extract<DemoEvent, { kind: 'tool_start' }>): Record<string, unknown> {
  if (event.tool === 'web_search' || event.tool === 'search_chat_history') {
    return { query: event.label }
  }

  if (event.tool === 'execute_terminal_command') {
    return { command: event.label }
  }

  return { task: event.label }
}

function updateLastAiMessage(
  messages: DemoChatMessage[],
  updater: (message: DemoChatMessage) => DemoChatMessage
): DemoChatMessage[] {
  const next = [...messages]
  const aiIndex = next.findLastIndex((message) => message.role === 'ai')
  if (aiIndex === -1) {
    next.push(updater(createAiMessage()))
    return next
  }

  next[aiIndex] = updater(next[aiIndex])
  return next
}

const DemoAiMessage = memo(function DemoAiMessage({
  message
}: {
  message: DemoChatMessage
}): React.JSX.Element | null {
  const streamStats = useStreamStats(message.content, message.isStreaming)

  if (!message.content && message.toolCalls.length === 0 && !message.thoughts) return null

  return (
    <StreamContext.Provider value={streamStats}>
      <div className="flex w-full flex-col gap-3 text-text-primary">
        {(message.isThinking || message.thoughts) && (
          <details className="group w-full select-none">
            <summary className="inline-flex list-none items-center gap-2 py-1 text-[12.5px] font-medium text-text-secondary/70 transition-colors hover:text-text-secondary [&::-webkit-details-marker]:hidden">
              <Brain
                size={13}
                className={clsx(
                  'text-text-secondary/55',
                  message.isThinking && 'animate-pulse text-accent-secondary/80'
                )}
              />
              <span>{message.isThinking ? 'Thinking...' : 'Thinking'}</span>
            </summary>
            <div className="ml-1.5 mt-1.5 border-l border-white/[0.06] py-0.5 pl-4 font-mono text-[11px] leading-relaxed text-text-secondary/55">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.thoughts}</ReactMarkdown>
            </div>
          </details>
        )}

        {message.toolCalls.map((toolCall) => (
          <div key={`${toolCall.name}-${toolCall.status}`} className="flex flex-col gap-1">
            <ActionLoader toolCall={toolCall} />
            {message.toolUpdates.length > 0 && (
              <div className="ml-5 flex flex-col gap-1 border-l border-white/[0.055] pl-3 font-mono text-[11px] text-text-secondary/65">
                {message.toolUpdates.map((update, index) => (
                  <span key={`${update}-${index}`}>{update}</span>
                ))}
              </div>
            )}
          </div>
        ))}

        {message.content && (
          <div className="prose prose-invert max-w-none prose-p:text-sm prose-p:font-light prose-p:leading-relaxed prose-li:text-sm prose-pre:border prose-pre:border-surface/50 prose-pre:bg-background-secondary prose-code:font-mono prose-code:text-[12px] md:prose-p:text-base md:prose-li:text-base">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[createStreamingFadeRehypePlugin(streamStats)]}
              components={StaticMarkdownComponents}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </StreamContext.Provider>
  )
})

export function DemoChatView({ script, onBack, onDownload }: DemoChatViewProps): React.JSX.Element {
  const [messages, setMessages] = useState<DemoChatMessage[]>([])
  const [isDone, setIsDone] = useState(false)
  const [runId, setRunId] = useState(0)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const handleEvent = useCallback((event: DemoEvent): void => {
    setMessages((current) => {
      if (event.kind === 'user_message') {
        return [
          ...current,
          {
            id: `user-${event.at}`,
            role: 'user',
            content: event.text,
            thoughts: '',
            isStreaming: false,
            isThinking: false,
            toolCalls: [],
            toolUpdates: []
          }
        ]
      }

      if (event.kind === 'tool_start') {
        return updateLastAiMessage(current, (message) => ({
          ...message,
          isStreaming: true,
          toolCalls: [
            ...message.toolCalls,
            {
              name: event.tool,
              args: getToolArgs(event),
              status: 'running'
            }
          ]
        }))
      }

      if (event.kind === 'tool_update') {
        return updateLastAiMessage(current, (message) => ({
          ...message,
          toolUpdates: [...message.toolUpdates, event.text]
        }))
      }

      if (event.kind === 'tool_end') {
        return updateLastAiMessage(current, (message) => ({
          ...message,
          toolCalls: message.toolCalls.map((toolCall, index) =>
            index === message.toolCalls.length - 1
              ? { ...toolCall, status: 'done', result: message.toolUpdates.join('\n') }
              : toolCall
          )
        }))
      }

      if (event.kind === 'thinking_chunk') {
        return updateLastAiMessage(current, (message) => ({
          ...message,
          isThinking: true,
          thoughts: `${message.thoughts}${event.text}`
        }))
      }

      if (event.kind === 'answer_chunk') {
        return updateLastAiMessage(current, (message) => ({
          ...message,
          isThinking: false,
          isStreaming: true,
          content: `${message.content}${event.text}`
        }))
      }

      if (event.kind === 'done') {
        return updateLastAiMessage(current, (message) => ({
          ...message,
          isThinking: false,
          isStreaming: false,
          toolCalls: message.toolCalls.map((toolCall) =>
            toolCall.status === 'running' ? { ...toolCall, status: 'done' } : toolCall
          )
        }))
      }

      return current
    })

    if (event.kind === 'done') {
      setIsDone(true)
    }
  }, [])

  useEffect(() => {
    const controller = playDemoScript(script, handleEvent, () => setIsDone(true))
    return () => {
      controller.stop()
    }
  }, [handleEvent, runId, script])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [messages])

  const handleReplay = (): void => {
    setMessages([])
    setIsDone(false)
    setRunId((value) => value + 1)
  }

  return (
    <main className="relative z-10 flex h-full min-h-0 flex-col pt-12">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.06] bg-background-main/46 px-4 backdrop-blur-md sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <button
            onClick={onBack}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-white/[0.055] hover:text-text-primary"
            title="Back"
          >
            <ArrowLeft size={17} />
          </button>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-text-primary">{script.trigger}</div>
            <div className="truncate text-xs text-text-secondary">{script.category}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleReplay}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-white/[0.055] hover:text-text-primary"
            title="Replay"
          >
            <ArrowClockwise size={17} />
          </button>
          <button
            onClick={onDownload}
            className="flex h-8 items-center gap-2 rounded-lg bg-accent-secondary px-3 text-xs font-semibold text-background-main transition-opacity hover:opacity-90"
          >
            <DownloadSimple size={15} weight="bold" />
            Download Prism
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-0 pb-28 pt-4">
        <div className="mx-auto flex w-full max-w-[860px] flex-col">
          {messages.map((message) => (
            <div key={message.id} className="flex w-full flex-col transition-all duration-700">
              <div
                className={clsx(
                  'flex w-full flex-col px-4 py-5 transition-all duration-700 animate-message sm:px-8',
                  message.role === 'user' ? 'items-end' : 'items-start'
                )}
              >
                {message.role === 'user' ? (
                  <div className="premium-panel-soft max-w-[92%] rounded-[18px] rounded-tr-md px-4 py-3 text-sm text-text-primary sm:max-w-[78%] md:text-base lg:max-w-[68%]">
                    {message.content}
                  </div>
                ) : (
                  <DemoAiMessage message={message} />
                )}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} className="h-4" />
        </div>
      </div>

      <div className="pointer-events-none fixed bottom-0 left-0 right-0 z-20 bg-gradient-to-t from-background-main via-background-main/90 to-transparent px-4 pb-5 pt-14">
        <div className="pointer-events-auto mx-auto flex max-w-[860px] items-center justify-between gap-3 rounded-lg border border-white/[0.07] bg-background-secondary/88 px-4 py-3 shadow-[0_18px_44px_rgba(0,0,0,0.32)] backdrop-blur-xl">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-text-primary">
              {isDone ? 'Demo complete' : 'Playing scripted conversation'}
            </div>
            <div className="truncate text-xs text-text-secondary">
              {isDone
                ? 'Prism is available as the full desktop app.'
                : 'Input is disabled for this demo.'}
            </div>
          </div>
          <button
            onClick={onDownload}
            className="flex h-9 shrink-0 items-center gap-2 rounded-lg bg-accent-secondary px-4 text-sm font-semibold text-background-main transition-opacity hover:opacity-90"
          >
            <DownloadSimple size={16} weight="bold" />
            Download
          </button>
        </div>
      </div>
    </main>
  )
}
