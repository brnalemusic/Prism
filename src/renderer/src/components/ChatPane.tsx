import React, { useRef, useEffect, useState, useMemo } from 'react'
import clsx from 'clsx'
import { CaretDown, ChatTeardropText, Columns, X, ArrowsLeftRight, DotsSixVertical } from '@phosphor-icons/react'
import { InputBar, InputBarHandle } from './InputBar'
import TodoPanel from './TodoPanel'
import { QuestionnaireWizard } from './QuestionnaireRenderer'
import type { TabSession } from '../types/tab'
import type { AppConfig, SlashWorkflow } from '../../../main/config'
import type { TodoState } from '../../../shared/types'

interface ChatPaneProps {
  tab: TabSession
  isFocused: boolean
  isSplitView: boolean
  todo: TodoState | null
  config: AppConfig | null
  isKeyMissing: boolean
  isOnline: boolean
  onFocus: (id: string) => void
  onCloseTab: (id: string) => void
  onToggleSplitTab: (id: string) => void
  onSend: (text: string, file?: TabSession['attachedFile'], overrideModel?: string, overrideSessionMode?: TabSession['sessionMode'], forceYoutube?: boolean) => void
  onCancel: () => void
  onModelChange: (model: string) => void
  onReasoningLevelChange: (model: string, level: string) => void
  onModeChange: (mode: TabSession['sessionMode']) => void
  onSelectFolder: () => void
  onUpdateTabInput: (id: string, text: string) => void
  onUpdateTabFile: (id: string, file: TabSession['attachedFile']) => void
  onOpenScreenshotModal: () => void
  onOpenYoutubeModal: () => void
  activeWorkflow: SlashWorkflow | null
  setActiveWorkflow: (wf: SlashWorkflow | null) => void
  renderedMessages: React.ReactNode
  onSwapSplitTabs?: (sourceTabId: string, targetTabId: string) => void
}

export const ChatPane: React.FC<ChatPaneProps> = React.memo(({
  tab,
  isFocused,
  isSplitView,
  todo,
  config,
  isKeyMissing,
  isOnline,
  onFocus,
  onCloseTab,
  onToggleSplitTab,
  onSend,
  onCancel,
  onModelChange,
  onReasoningLevelChange,
  onModeChange,
  onSelectFolder,
  onUpdateTabInput,
  onUpdateTabFile,
  onOpenScreenshotModal,
  onOpenYoutubeModal,
  activeWorkflow,
  setActiveWorkflow,
  renderedMessages,
  onSwapSplitTabs
}) => {
  const inputBarRef = useRef<InputBarHandle>(null)
  const [isDraggingSplit, setIsDraggingSplit] = useState(false)
  const [isDragTargetSplit, setIsDragTargetSplit] = useState(false)

  // Find the active to_ask tool call from the latest AI message (status running or writing)
  const activeQuestionnaire = useMemo(() => {
    for (let i = tab.messages.length - 1; i >= 0; i--) {
      const msg = tab.messages[i]
      if (msg.role !== 'ai') continue
      const tc = (msg.toolCalls || []).find(
        (t) => t.name === 'to_ask' && (t.status === 'running' || t.status === 'writing')
      )
      if (tc) return { toolCall: { name: tc.name, status: tc.status, args: tc.args || {} }, chatId: tab.chatId || '' }
    }
    return null
  }, [tab.messages, tab.chatId])
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [showScrollButton, setShowScrollButton] = useState(false)
  const isAtBottomRef = useRef(true)

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth'): void => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior
      })
    }
  }

  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return

    const handleScroll = (): void => {
      const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      const atBottom = distanceToBottom < 80
      isAtBottomRef.current = atBottom
      setShowScrollButton(!atBottom)
    }

    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    if (isAtBottomRef.current) {
      scrollToBottom('smooth')
    }
  }, [tab.messages.length, tab.messages[tab.messages.length - 1]?.content])

  useEffect(() => {
    if (!isFocused) return
    const timer = setTimeout(() => {
      inputBarRef.current?.focus()
    }, 50)
    return () => clearTimeout(timer)
  }, [isFocused, tab.id])

  const handleSendInputBar = (
    message: string,
    _searchEnabled?: boolean,
    _screenshot?: string,
    attachedFile?: TabSession['attachedFile']
  ) => {
    onSend(message, attachedFile || tab.attachedFile || undefined)
  }

  const handleSetTextInputBar = (
    val: string | ((prev: string) => string)
  ) => {
    const nextText = typeof val === 'function' ? val(tab.inputText) : val
    onUpdateTabInput(tab.id, nextText)
  }

  return (
    <div
      onClick={() => onFocus(tab.id)}
      onDragOver={(e) => {
        if (isSplitView && e.dataTransfer.types.includes('text/prism-split-tab-id')) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          if (!isDragTargetSplit) {
            setIsDragTargetSplit(true)
          }
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return
        setIsDragTargetSplit(false)
      }}
      onDrop={(e) => {
        if (!isSplitView) return
        e.preventDefault()
        setIsDragTargetSplit(false)
        const sourceId = e.dataTransfer.getData('text/prism-split-tab-id')
        if (sourceId && sourceId !== tab.id && onSwapSplitTabs) {
          onSwapSplitTabs(sourceId, tab.id)
        }
      }}
      className={clsx(
        'relative flex h-full w-full flex-col overflow-hidden bg-background-main/60 transition-all duration-200 rounded-xl border',
        isDraggingSplit && 'opacity-40 scale-[0.99] border-dashed border-accent-primary/50',
        isDragTargetSplit
          ? 'border-accent-primary shadow-[0_0_25px_rgba(255,255,255,0.12)] ring-2 ring-accent-primary/60 scale-[1.005]'
          : isFocused
            ? 'border-accent-primary/50 shadow-[0_0_20px_rgba(255,255,255,0.03)] ring-1 ring-accent-primary/30'
            : 'border-white/[0.06] hover:border-white/[0.12]'
      )}
    >
      {/* Pane Sub-Header (Only visible in Split View) */}
      {isSplitView && (
        <div
          draggable
          onDragStart={(e) => {
            e.stopPropagation()
            e.dataTransfer.setData('text/prism-split-tab-id', tab.id)
            e.dataTransfer.effectAllowed = 'move'
            setIsDraggingSplit(true)
          }}
          onDragEnd={() => setIsDraggingSplit(false)}
          className={clsx(
            'flex h-8 w-full items-center justify-between border-b px-3 text-xs select-none backdrop-blur-md shrink-0 cursor-grab active:cursor-grabbing transition-colors',
            isFocused
              ? 'bg-accent-primary/10 border-accent-primary/30 text-text-primary'
              : 'bg-white/[0.02] border-white/[0.05] text-text-secondary hover:bg-white/[0.05]'
          )}
          title="Drag to swap split view window"
        >
          <div className="flex items-center gap-2 truncate">
            <DotsSixVertical size={14} className="text-text-muted hover:text-text-primary shrink-0" />
            <ChatTeardropText
              size={14}
              className={isFocused ? 'text-accent-primary' : 'text-text-muted'}
            />
            <span className="font-medium truncate">{tab.title || 'New Chat'}</span>
            {tab.isProcessing && (
              <span className="h-1.5 w-1.5 rounded-full bg-accent-primary animate-pulse" />
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onToggleSplitTab(tab.id)
              }}
              title="Remove from split view"
              className="flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-white/[0.1] hover:text-text-primary transition-colors cursor-pointer"
            >
              <Columns size={12} weight="bold" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onCloseTab(tab.id)
              }}
              title="Close tab"
              className="flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-white/[0.1] hover:text-text-primary transition-colors cursor-pointer"
            >
              <X size={12} />
            </button>
          </div>
        </div>
      )}

      {/* Swap drop target overlay */}
      {isDragTargetSplit && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-accent-primary/10 border-2 border-dashed border-accent-primary/60 backdrop-blur-md rounded-xl animate-drop-target pointer-events-none transition-all duration-200">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface/90 border border-white/20 shadow-2xl mb-2 text-accent-primary animate-bounce">
            <ArrowsLeftRight size={24} />
          </div>
          <span className="text-xs font-semibold text-text-primary bg-background-secondary/90 px-3 py-1.5 rounded-xl border border-white/10 shadow-lg tracking-wide">
            Swap window
          </span>
        </div>
      )}

      {/* Main Content Area */}
      <div className="relative flex flex-1 w-full overflow-hidden">
        {/* Chat scroll area */}
        <div
          ref={scrollContainerRef}
          className="relative flex-1 h-full overflow-y-auto no-scrollbar flex flex-col"
        >
          {/* Landing State when tab has no messages */}
          {tab.messages.length === 0 && (
            <div className="flex-1 flex flex-col items-center justify-center p-4 min-h-full">
              <div className="w-full max-w-[720px] flex flex-col items-center gap-6 z-10 my-auto">
                <div className="flex flex-col items-center text-center space-y-2">
                  <h1 className="text-2xl font-bold tracking-tight text-text-primary">
                    What would you like to build?
                  </h1>
                  <p className="text-sm text-text-muted">
                    Prism session is ready. Type your request or choose a mode.
                  </p>
                </div>

                <div className="w-full flex flex-col gap-0">
                  {/* AI Todo card docked above InputBar (landing state) */}
                  {todo && <TodoPanel todo={todo} />}
                  {/* Questionnaire wizard card docked above InputBar (landing state) */}
                  {activeQuestionnaire && (
                    <QuestionnaireWizard
                      toolCall={activeQuestionnaire.toolCall}
                      chatId={activeQuestionnaire.chatId}
                    />
                  )}
                  <InputBar
                    ref={inputBarRef}
                    onSend={handleSendInputBar}
                    onCancel={onCancel}
                    isProcessing={tab.isProcessing}
                    isKeyMissing={isKeyMissing}
                    disabled={tab.isProcessing || isKeyMissing || !isOnline}
                    selectedModel={tab.selectedModel}
                    onModelChange={onModelChange}
                    reasoningLevel={config?.modelReasoningLevels?.[tab.selectedModel] || 'off'}
                    onReasoningLevelChange={(level) => onReasoningLevelChange(tab.selectedModel, level)}
                    text={tab.inputText}
                    setText={handleSetTextInputBar}
                    isSearchEnabled={tab.isSearchEnabled}
                    setIsSearchEnabled={() => {}}
                    isFullscreen={false}
                    onFullscreenToggle={() => {}}
                    attachedFile={tab.attachedFile}
                    onRemoveFile={() => onUpdateTabFile(tab.id, null)}
                    onAttachFile={(f) => onUpdateTabFile(tab.id, f)}
                    onOpenScreenshotModal={onOpenScreenshotModal}
                    onOpenYoutubeModal={onOpenYoutubeModal}
                    activeWorkflow={activeWorkflow}
                    setActiveWorkflow={setActiveWorkflow}
                    sessionMode={tab.sessionMode}
                    disciplinePath={tab.disciplinePath}
                    onModeChange={onModeChange}
                    onSelectFolder={onSelectFolder}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Messages list when tab has messages */}
          {tab.messages.length > 0 && (
            <div className="w-full flex-grow flex flex-col pb-[22vh] pt-4">
              {renderedMessages}
            </div>
          )}
        </div>

        {/* Input Bar Overlay when tab has messages */}
        {tab.messages.length > 0 && (
          <div className="absolute bottom-0 left-0 right-0 pb-6 pt-10 z-20 pointer-events-none bg-gradient-to-t from-background-main via-background-main/90 to-transparent px-4">
            {showScrollButton && (
              <div className="absolute left-0 right-0 -top-10 flex justify-center pointer-events-none z-20 animate-soft-pop">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    isAtBottomRef.current = true
                    scrollToBottom('smooth')
                    setShowScrollButton(false)
                  }}
                  className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-background-secondary/90 text-text-secondary shadow-lg backdrop-blur-md transition-all duration-200 hover:bg-white/[0.08] hover:text-text-primary active:scale-95 cursor-pointer"
                  title="Scroll to bottom"
                >
                  <CaretDown size={14} />
                </button>
              </div>
            )}

            <div className="pointer-events-auto max-w-[800px] mx-auto flex flex-col gap-0">
              {/* AI Todo card docked above InputBar */}
              {todo && <TodoPanel todo={todo} />}
              {/* Questionnaire wizard card docked above InputBar */}
              {activeQuestionnaire && (
                <QuestionnaireWizard
                  toolCall={activeQuestionnaire.toolCall}
                  chatId={activeQuestionnaire.chatId}
                />
              )}
              <InputBar
                ref={inputBarRef}
                onSend={handleSendInputBar}
                onCancel={onCancel}
                isProcessing={tab.isProcessing}
                isKeyMissing={isKeyMissing}
                disabled={tab.isProcessing || isKeyMissing || !isOnline}
                selectedModel={tab.selectedModel}
                onModelChange={onModelChange}
                reasoningLevel={config?.modelReasoningLevels?.[tab.selectedModel] || 'off'}
                onReasoningLevelChange={(level) => onReasoningLevelChange(tab.selectedModel, level)}
                text={tab.inputText}
                setText={handleSetTextInputBar}
                isSearchEnabled={tab.isSearchEnabled}
                setIsSearchEnabled={() => {}}
                isFullscreen={false}
                onFullscreenToggle={() => {}}
                attachedFile={tab.attachedFile}
                onRemoveFile={() => onUpdateTabFile(tab.id, null)}
                onAttachFile={(f) => onUpdateTabFile(tab.id, f)}
                onOpenScreenshotModal={onOpenScreenshotModal}
                onOpenYoutubeModal={onOpenYoutubeModal}
                activeWorkflow={activeWorkflow}
                setActiveWorkflow={setActiveWorkflow}
                sessionMode={tab.sessionMode}
                disciplinePath={tab.disciplinePath}
                onModeChange={onModeChange}
                onSelectFolder={onSelectFolder}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
})
