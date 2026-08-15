import React, { useState, useEffect, useRef, useMemo } from 'react'
import {
  MagnifyingGlass,
  Sparkle,
  X,
  Brain,
  Clock,
  ChatTeardropText,
  Stop,
  Microphone,
  PaperPlaneRight,
  StopCircle,
  Warning
} from '@phosphor-icons/react'
import { useSpeechToText } from '../hooks/useSpeechToText'
import clsx from 'clsx'
import { ToolCall } from './ActionLoader'
import { RenderChatHistory } from './RenderChatHistory'
import { Spinner } from './Spinner'

import { isShortcutPressed } from '../utils'
import { AppConfig } from '../../../main/config'
import { applyToolCallEnd, applyToolCallStart } from '../toolCallState'

interface SearchModalProps {
  isOpen: boolean
  onClose: () => void
  onOpenChat: (id: string) => void
}

interface QuickSearchResult {
  id: string
  title: string
  lastUpdated: number
  matchedTitle: boolean
  messageMatches: Array<{
    role: 'user' | 'model' | 'system'
    text: string
    snippet: string
  }>
}

interface AiSearchOutputProps {
  renderChatIds: string[]
  onClose: () => void
  onOpenChat: (id: string) => void
}

const AiSearchOutput = React.memo(function AiSearchOutput({
  renderChatIds,
  onClose,
  onOpenChat
}: AiSearchOutputProps) {
  if (!renderChatIds.length) {
    return null
  }

  return (
    <div className="flex flex-col gap-3 items-center w-full animate-fade-in pr-2 select-text">
      {renderChatIds.map((chatId, idx) => (
        <RenderChatHistory
          key={`${chatId}-${idx}`}
          chatId={chatId}
          onOpenChat={(id) => {
            onClose()
            onOpenChat(id)
          }}
        />
      ))}
    </div>
  )
})

export function SearchModal({
  isOpen,
  onClose,
  onOpenChat
}: SearchModalProps): React.JSX.Element | null {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [activeTab, setActiveTab] = useState<'quick' | 'ai'>('quick')
  const [isVisible, setIsVisible] = useState(false)
  const [query, setQuery] = useState('')

  // Quick Search state
  const [quickResults, setQuickResults] = useState<QuickSearchResult[]>([])
  const [didYouMean, setDidYouMean] = useState<string | undefined>(undefined)
  const [isSearchingQuick, setIsSearchingQuick] = useState(false)

  // AI Search state
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiResponse, setAiResponse] = useState('')
  const [isAiProcessing, setIsAiProcessing] = useState(false)
  const [isWritingToolCall, setIsWritingToolCall] = useState(false)
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([])

  useEffect(() => {
    window.api.getConfig().then((cfg) => {
      if (cfg) setConfig(cfg)
    })
    const removeListener = window.api.onConfigChanged((cfg) => {
      if (cfg) setConfig(cfg)
    })
    return () => removeListener()
  }, [])
  const [aiError, setAiError] = useState<string | null>(null)
  const [hasSearched, setHasSearched] = useState(false)

  const activeTabRef = useRef(activeTab)
  const queryRef = useRef(query)
  const aiPromptRef = useRef(aiPrompt)

  useEffect(() => {
    activeTabRef.current = activeTab
  }, [activeTab])
  useEffect(() => {
    queryRef.current = query
  }, [query])
  useEffect(() => {
    aiPromptRef.current = aiPrompt
  }, [aiPrompt])

  const renderChatIds = useMemo(() => {
    const ids: string[] = []

    for (const tc of toolCalls) {
      if (tc.name === 'render_chat_history') {
        const q = (tc.args?.query || tc.args?.chatId || tc.args?.id) as string | undefined
        if (q && typeof q === 'string' && q.trim() && !ids.includes(q.trim())) {
          ids.push(q.trim())
        }
      }
    }

    if (aiResponse.includes('[PRISM_EXECUTE_TOOL]')) {
      const parts = aiResponse.split(
        /(\[PRISM_EXECUTE_TOOL\][\s\S]*?(?:\[\/PRISM_EXECUTE_TOOL\]|$))/gi
      )
      for (const part of parts) {
        if (part.startsWith('[PRISM_EXECUTE_TOOL]') && part.includes('[/PRISM_EXECUTE_TOOL]')) {
          try {
            const jsonText = part
              .replace(/\[PRISM_EXECUTE_TOOL\]/gi, '')
              .replace(/\[\/PRISM_EXECUTE_TOOL\]/gi, '')
              .trim()
            const tc = JSON.parse(jsonText)
            if (tc && (tc.type === 'render_chat_history' || tc.name === 'render_chat_history')) {
              const q = (tc.query || tc.args?.query || tc.chatId || tc.args?.chatId) as
                | string
                | undefined
              if (q && typeof q === 'string' && q.trim() && !ids.includes(q.trim())) {
                ids.push(q.trim())
              }
            }
          } catch {
            // ignore invalid JSON
          }
        }
      }
    }

    return ids
  }, [toolCalls, aiResponse])

  const hasRenderChat = renderChatIds.length > 0

  const hasNotFoundChat = useMemo(() => {
    return (
      toolCalls.some((tc) => tc.name === 'not_found_chat_history') ||
      /"type"\s*:\s*"not_found_chat_history"|"name"\s*:\s*"not_found_chat_history"/.test(aiResponse)
    )
  }, [toolCalls, aiResponse])

  const isPerformingToolCalls = useMemo(() => {
    return toolCalls.some((tc) => tc.status === 'running')
  }, [toolCalls])

  const showNotFound = hasNotFoundChat && !isPerformingToolCalls && !isAiProcessing
  const showResults = hasRenderChat && !isPerformingToolCalls && !isAiProcessing && !showNotFound
  const showWarning =
    hasSearched &&
    !isAiProcessing &&
    !isPerformingToolCalls &&
    !hasRenderChat &&
    !hasNotFoundChat &&
    !aiError
  const showSearching =
    (isAiProcessing || isPerformingToolCalls) &&
    !aiError &&
    !showNotFound &&
    !showResults &&
    !showWarning

  const {
    isRecording: isRecordingSTT,
    isTranscribing: isTranscribingSTT,
    toggleRecording: toggleRecordingSTT,
    stopRecording: stopRecordingSTT
  } = useSpeechToText((transcription, action) => {
    if (activeTabRef.current === 'quick') {
      const newQuery = queryRef.current.trim()
        ? queryRef.current + ' ' + transcription
        : transcription
      setQuery(newQuery)
    } else {
      const newPrompt = aiPromptRef.current.trim()
        ? aiPromptRef.current + ' ' + transcription
        : transcription
      setAiPrompt(newPrompt)
      if (action === 'send') {
        handleStartAiSearch(newPrompt)
      }
    }
  })

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent): void => {
      const dictationKey = config?.dictationShortcut || 'CommandOrControl+D'
      if (isShortcutPressed(e, dictationKey)) {
        e.preventDefault()
        toggleRecordingSTT()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isRecordingSTT, config])

  const aiResponseEndRef = useRef<HTMLDivElement>(null)

  const hasAiContent =
    hasSearched ||
    !!aiResponse.trim() ||
    toolCalls.length > 0 ||
    isWritingToolCall ||
    isAiProcessing ||
    !!aiError

  // Sync animation state
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen)
  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen)
    if (isOpen) {
      setQuery('')
      setQuickResults([])
      setDidYouMean(undefined)
      setAiPrompt('')
      setAiResponse('')
      setToolCalls([])
      setAiError(null)
      setIsAiProcessing(false)
      setHasSearched(false)
    }
  }

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => setIsVisible(true), 0)
      return () => clearTimeout(timer)
    } else {
      const timer = setTimeout(() => setIsVisible(false), 300)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  // Debounced Quick Search
  useEffect(() => {
    if (activeTab !== 'quick') return
    const trimmed = query.trim()
    if (!trimmed) {
      setQuickResults([])
      setDidYouMean(undefined)
      return
    }

    const delayDebounce = setTimeout(async () => {
      setIsSearchingQuick(true)
      try {
        const { results, didYouMean: spellingSuggestion } =
          await window.api.searchChatsOffline(trimmed)
        setQuickResults(results)
        setDidYouMean(spellingSuggestion)
      } catch (err) {
        console.error(err)
      } finally {
        setIsSearchingQuick(false)
      }
    }, 250)

    return () => clearTimeout(delayDebounce)
  }, [query, activeTab])

  // AI Search IPC hooks
  useEffect(() => {
    if (!isOpen) return

    const removeStart = window.api.onAiSearchStart(() => {
      console.log('[AI SEARCH DEBUG] Search started.')
      setAiResponse('')
      setToolCalls([])
      setAiError(null)
      setIsAiProcessing(true)
      setHasSearched(true)
    })

    const removeChunk = window.api.onAiSearchChunk((data) => {
      console.log('[AI SEARCH DEBUG] Received chunk data:', {
        hasThoughts: !!data.thoughts,
        thoughtsLength: data.thoughts?.length || 0,
        hasFinalResponse: !!data.finalResponse,
        finalResponseLength: data.finalResponse?.length || 0,
        isThinking: data.isThinking,
        isWritingToolCall: data.isWritingToolCall,
        toolType: data.toolType
      })
      setAiResponse(data.finalResponse || '')
      setIsWritingToolCall(!!data.isWritingToolCall)

      // Auto-scroll AI search results panel
      aiResponseEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    })

    const removeEnd = window.api.onAiSearchEnd((data) => {
      console.log('[AI SEARCH DEBUG] Search completed successfully.', {
        totalThoughtsLength: data.thoughts?.length || 0,
        totalResponseLength: data.finalResponse?.length || 0
      })
      setAiResponse(data.finalResponse || '')
      setIsAiProcessing(false)
    })

    const removeError = window.api.onAiSearchError((data) => {
      console.error('[AI SEARCH DEBUG] Search encountered error:', data.error)
      setAiError(data.error)
      setIsAiProcessing(false)
    })

    const removeToolStart = window.api.onAiSearchToolStart((data) => {
      console.log('[AI SEARCH DEBUG] Tool start:', data.name, 'with args:', data.args)
      setToolCalls((prev) => applyToolCallStart(prev, data))
    })

    const removeToolEnd = window.api.onAiSearchToolEnd((data) => {
      console.log(
        '[AI SEARCH DEBUG] Tool end:',
        data.name,
        'with result length:',
        data.result?.length || 0
      )
      setToolCalls((prev) => applyToolCallEnd(prev, data))
    })

    return () => {
      removeStart()
      removeChunk()
      removeEnd()
      removeError()
      removeToolStart()
      removeToolEnd()
    }
  }, [isOpen])

  if (!isVisible && !isOpen) return null

  const handleStartAiSearch = (overridePrompt?: string): void => {
    const targetPrompt = overridePrompt !== undefined ? overridePrompt : aiPrompt
    if (!targetPrompt.trim() || isAiProcessing) return
    console.log('[AI SEARCH DEBUG] Initiating search for prompt:', targetPrompt.trim())
    window.api.sendAiSearchMessage(targetPrompt.trim())
  }

  const handleCancelAiSearch = (): void => {
    console.log('[AI SEARCH DEBUG] User requested search cancellation.')
    window.api.cancelAiSearch()
    setIsAiProcessing(false)
  }

  const highlightText = (text: string, searchWords: string[]): React.ReactNode => {
    if (!searchWords.length) return text
    const escapedWords = searchWords
      .map((w) => w.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'))
      .filter((w) => w.length > 0)
    if (!escapedWords.length) return text

    const regex = new RegExp(`(${escapedWords.join('|')})`, 'gi')
    const parts = text.split(regex)

    return parts.map((part, i) =>
      regex.test(part) ? (
        <mark
          key={i}
          className="bg-accent-primary/30 text-text-primary px-0.5 rounded-sm font-semibold"
        >
          {part}
        </mark>
      ) : (
        part
      )
    )
  }

  return (
    <div
      className={clsx(
        'prism-modal-backdrop fixed inset-0 z-[100] flex items-center justify-center p-4 transition-all duration-300',
        isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
      )}
    >
      {/* Backdrop */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Modal Card */}
      <div
        role="dialog"
        aria-modal="true"
        className={clsx(
          'prism-modal-panel relative flex max-h-[min(760px,calc(100vh-32px))] w-full max-w-2xl flex-col overflow-hidden transition-all duration-300 transform',
          isOpen ? 'scale-100 translate-y-0' : 'scale-95 translate-y-4'
        )}
      >
        {/* Header */}
        <div className="p-6 pb-4 border-b border-white/[0.04] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.02] text-text-secondary">
              <MagnifyingGlass size={18} />
            </div>
            <h2 className="text-base font-semibold text-text-primary">Search Conversations</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-text-secondary/50 transition-colors hover:bg-white/[0.06] hover:text-text-primary"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tab Controls */}
        <div className="px-6 py-3 bg-white/[0.01] border-b border-white/[0.04] flex gap-2 shrink-0">
          <button
            onClick={() => setActiveTab('quick')}
            className={clsx(
              'flex items-center justify-center gap-2 rounded-xl px-4 py-2 w-36 text-xs font-semibold transition-all duration-200 active:scale-[0.98]',
              activeTab === 'quick'
                ? 'bg-white/[0.06] border border-white/[0.08] text-text-primary font-bold'
                : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.02]'
            )}
          >
            <MagnifyingGlass size={14} />
            Quick Search
          </button>
          <button
            onClick={() => setActiveTab('ai')}
            className={clsx(
              'flex items-center justify-center gap-2 rounded-xl px-4 py-2 w-36 text-xs font-semibold transition-all duration-200 active:scale-[0.98]',
              activeTab === 'ai'
                ? 'bg-white/[0.06] border border-white/[0.08] text-text-primary font-bold'
                : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.02]'
            )}
          >
            <Sparkle size={14} className="text-accent-secondary animate-pulse" />
            AI Search
          </button>
        </div>

        {/* Search Input Area */}
        <div className="px-6 py-4 shrink-0 bg-white/[0.005]">
          {activeTab === 'quick' ? (
            <div className="relative flex items-center">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Type keywords, phrases or chat titles..."
                className="w-full rounded-[18px] border border-white/[0.08] bg-white/[0.035] pl-11 pr-12 py-3 text-sm text-text-primary placeholder:text-text-muted transition-all focus:border-accent-primary/40 focus:outline-none"
                autoFocus
              />
              <MagnifyingGlass
                size={18}
                className="absolute left-4 text-text-secondary/50 pointer-events-none"
              />
              <div className="absolute right-3 flex items-center gap-2">
                {isSearchingQuick && <Spinner size="xs" />}
                <button
                  type="button"
                  onClick={() => {
                    if (isRecordingSTT) {
                      stopRecordingSTT('insert')
                    } else {
                      toggleRecordingSTT()
                    }
                  }}
                  disabled={isTranscribingSTT}
                  className={clsx(
                    'p-1.5 rounded-lg transition-all duration-200 border',
                    isRecordingSTT
                      ? 'bg-status-error/20 border-status-error/30 text-status-error animate-pulse'
                      : isTranscribingSTT
                        ? 'bg-accent-primary/20 border-accent-primary/30 text-accent-primary cursor-wait'
                        : 'bg-white/5 border-white/10 text-text-secondary/50 hover:bg-white/10 hover:text-text-primary'
                  )}
                  title={isRecordingSTT ? 'Stop and review' : 'Start Dictation'}
                >
                  {isTranscribingSTT ? (
                    <div className="flex items-center gap-0.5 px-0.5">
                      <span className="h-1 w-1 rounded-full bg-current animate-bounce [animation-delay:-0.3s]" />
                      <span className="h-1 w-1 rounded-full bg-current animate-bounce [animation-delay:-0.15s]" />
                      <span className="h-1 w-1 rounded-full bg-current animate-bounce" />
                    </div>
                  ) : isRecordingSTT ? (
                    <StopCircle size={16} weight="fill" />
                  ) : (
                    <Microphone size={16} />
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="relative flex items-center">
              <input
                type="text"
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="Describe the context of the chat you are looking for"
                className={clsx(
                  'w-full rounded-[18px] border border-white/[0.08] bg-white/[0.035] pl-4 py-3 text-sm text-text-primary placeholder:text-text-muted transition-all focus:border-accent-primary/40 focus:outline-none',
                  isRecordingSTT ? 'pr-[112px]' : 'pr-[76px]'
                )}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleStartAiSearch()
                  }
                }}
                disabled={isAiProcessing}
              />
              <div className="absolute right-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (isRecordingSTT) {
                      stopRecordingSTT('insert')
                    } else {
                      toggleRecordingSTT()
                    }
                  }}
                  disabled={isTranscribingSTT || isAiProcessing}
                  className={clsx(
                    'p-1.5 rounded-lg transition-all duration-200 border',
                    isRecordingSTT
                      ? 'bg-status-error/20 border-status-error/30 text-status-error animate-pulse'
                      : isTranscribingSTT
                        ? 'bg-accent-primary/20 border-accent-primary/30 text-accent-primary cursor-wait'
                        : 'bg-white/5 border-white/10 text-text-secondary/50 hover:bg-white/10 hover:text-text-primary'
                  )}
                  title={isRecordingSTT ? 'Stop and review' : 'Start Dictation'}
                >
                  {isTranscribingSTT ? (
                    <div className="flex items-center gap-0.5 px-0.5">
                      <span className="h-1 w-1 rounded-full bg-current animate-bounce [animation-delay:-0.3s]" />
                      <span className="h-1 w-1 rounded-full bg-current animate-bounce [animation-delay:-0.15s]" />
                      <span className="h-1 w-1 rounded-full bg-current animate-bounce" />
                    </div>
                  ) : isRecordingSTT ? (
                    <StopCircle size={16} weight="fill" />
                  ) : (
                    <Microphone size={16} />
                  )}
                </button>
                {isRecordingSTT && (
                  <button
                    type="button"
                    onClick={() => stopRecordingSTT('send')}
                    disabled={isTranscribingSTT || isAiProcessing}
                    className="p-1.5 rounded-lg bg-text-primary hover:bg-white text-black transition-all cursor-pointer active:scale-95 flex items-center justify-center"
                    title="Stop and run search"
                  >
                    <PaperPlaneRight size={16} weight="fill" />
                  </button>
                )}
                {isAiProcessing ? (
                  <button
                    onClick={handleCancelAiSearch}
                    className="p-1.5 rounded-lg bg-status-error/10 hover:bg-status-error/20 text-status-error transition-all cursor-pointer active:scale-95 flex items-center justify-center border border-status-error/20"
                    title="Cancel search"
                  >
                    <Stop size={16} weight="fill" />
                  </button>
                ) : (
                  <button
                    onClick={() => handleStartAiSearch()}
                    disabled={!aiPrompt.trim()}
                    className="p-1.5 rounded-lg bg-text-primary hover:bg-white text-black disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer active:scale-95 flex items-center justify-center"
                    title="Run AI Search"
                  >
                    <Sparkle size={16} weight="fill" />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Scrollable Results Area */}
        <div className="flex-1 overflow-y-auto px-6 pb-6 flex flex-col gap-4">
          {activeTab === 'quick' ? (
            <>
              {/* Spelling Suggestion */}
              {didYouMean && (
                <div className="rounded-xl border border-accent-secondary/10 bg-accent-secondary/[0.03] px-4 py-2.5 text-xs text-text-secondary flex gap-1.5 items-center shrink-0">
                  <Brain size={14} className="text-accent-secondary animate-pulse" />
                  <span>Did you mean:</span>
                  <button
                    onClick={() => setQuery(didYouMean)}
                    className="text-accent-secondary font-semibold underline hover:text-accent-secondary/80 transition-all cursor-pointer"
                  >
                    {didYouMean}
                  </button>
                  <span>?</span>
                </div>
              )}

              {/* Quick Search Result Cards */}
              {quickResults.length > 0 ? (
                <div className="flex flex-col gap-3">
                  {quickResults.map((res) => {
                    const queryWords = query.toLowerCase().split(/\s+/).filter(Boolean)
                    return (
                      <div
                        key={res.id}
                        onClick={() => {
                          onClose()
                          onOpenChat(res.id)
                        }}
                        className="premium-panel-soft group rounded-2xl border border-white/[0.05] bg-white/[0.02] p-4 flex flex-col gap-3 hover:border-white/10 hover:bg-white/[0.03] transition-all duration-300 cursor-pointer animate-fade-in"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-accent-secondary/20 bg-accent-secondary/[0.08] text-accent-secondary">
                              <ChatTeardropText size={15} />
                            </div>
                            <span className="text-sm font-semibold text-text-primary group-hover:text-accent-secondary transition-colors truncate">
                              {highlightText(res.title || 'Untitled Conversation', queryWords)}
                            </span>
                          </div>
                          <span className="flex items-center gap-1 text-[10px] text-text-muted font-medium uppercase tracking-wider shrink-0">
                            <Clock size={12} />
                            {new Date(res.lastUpdated).toLocaleDateString()}
                          </span>
                        </div>

                        {res.messageMatches.length > 0 && (
                          <div className="pl-9 flex flex-col gap-2 border-l border-white/[0.04]">
                            {res.messageMatches.slice(0, 2).map((match, mIdx) => (
                              <div
                                key={mIdx}
                                className="text-xs text-text-secondary leading-relaxed"
                              >
                                <span className="text-[10px] uppercase font-bold text-text-muted mr-1.5">
                                  {match.role === 'user' ? 'User:' : 'AI:'}
                                </span>
                                <span className="font-light italic text-text-secondary/80">
                                  {highlightText(match.snippet, queryWords)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : (
                query.trim() &&
                !isSearchingQuick && (
                  <div className="flex-1 flex flex-col items-center justify-center py-10 gap-2 text-text-muted select-none">
                    <X size={24} className="opacity-40" />
                    <span className="text-sm font-light">
                      No conversations match your search criteria.
                    </span>
                  </div>
                )
              )}
            </>
          ) : (
            /* AI Search Results / Thoughts output */
            hasAiContent && (
              <div className="flex-1 flex flex-col gap-4">
                <div className="flex-1">
                  {showResults && (
                    <AiSearchOutput
                      renderChatIds={renderChatIds}
                      onClose={onClose}
                      onOpenChat={onOpenChat}
                    />
                  )}

                  {showSearching && (
                    <div className="flex flex-col items-center justify-center py-12 gap-3 text-text-secondary select-none animate-fade-in">
                      <Spinner size="md" />
                      <span className="text-sm font-light animate-pulse text-text-secondary/70">
                        Searching...
                      </span>
                    </div>
                  )}

                  {showNotFound && (
                    <div className="rounded-2xl border border-status-error/25 bg-status-error/10 p-5 text-status-error text-sm mt-3 flex flex-col gap-2.5 max-w-md mx-auto items-center text-center animate-fade-in">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-status-error/15 text-status-error mb-1">
                        <X size={20} weight="bold" />
                      </div>
                      <p className="font-semibold text-text-primary">Chat Not Found</p>
                      <p className="text-xs text-text-secondary/80 leading-relaxed">
                        The AI did not find the specified chat. Please try again with a different
                        approach.
                      </p>
                    </div>
                  )}

                  {showWarning && (
                    <div className="rounded-2xl border border-status-warning/25 bg-status-warning/10 p-5 text-status-warning text-sm mt-3 flex flex-col gap-2.5 max-w-md mx-auto items-center text-center animate-fade-in">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-status-warning/15 text-status-warning mb-1">
                        <Warning size={20} weight="bold" />
                      </div>
                      <p className="font-semibold text-text-primary">Warning</p>
                      <p className="text-xs text-text-secondary/80 leading-relaxed">
                        AI terminated, but not generated valid output. Please try again with a
                        different approach.
                      </p>
                    </div>
                  )}

                  {aiError && (
                    <div className="rounded-xl border border-status-error/10 bg-status-error/[0.045] p-4 text-status-error text-xs mt-3">
                      Search Error: {aiError}
                    </div>
                  )}
                  <div ref={aiResponseEndRef} className="h-2" />
                </div>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  )
}
