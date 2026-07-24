import React, { useRef, useEffect, useState } from 'react'
import clsx from 'clsx'
import { CaretDown, ChatTeardropText, Columns, X } from '@phosphor-icons/react'
import { InputBar, InputBarHandle } from './InputBar'
import TodoPanel from './TodoPanel'
import { LandingBackgroundEffects } from './LandingBackgroundEffects'
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
  onToggleTodo: (id: string) => void
  onCloseTodo: (id: string) => void
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
  onToggleTodo,
  onCloseTodo,
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
  renderedMessages
}) => {
  const inputBarRef = useRef<InputBarHandle>(null)
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
      className={clsx(
        'relative flex h-full w-full flex-col overflow-hidden bg-background-main/60 transition-all duration-200 rounded-xl border',
        isFocused
          ? 'border-accent-primary/50 shadow-[0_0_20px_rgba(255,255,255,0.03)] ring-1 ring-accent-primary/30'
          : 'border-white/[0.06] hover:border-white/[0.12]'
      )}
    >
      {/* Pane Sub-Header (Only visible in Split View) */}
      {isSplitView && (
        <div
          className={clsx(
            'flex h-8 w-full items-center justify-between border-b px-3 text-xs select-none backdrop-blur-md shrink-0',
            isFocused
              ? 'bg-accent-primary/10 border-accent-primary/30 text-text-primary'
              : 'bg-white/[0.02] border-white/[0.05] text-text-secondary'
          )}
        >
          <div className="flex items-center gap-2 truncate">
            <ChatTeardropText
              size={14}
              className={isFocused ? 'text-accent-primary' : 'text-text-muted'}
            />
            <span className="font-medium truncate">{tab.title || 'New Chat'}</span>
            {tab.isProcessing && (
              <span className="h-1.5 w-1.5 rounded-full bg-accent-primary animate-pulse" />
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
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
              <LandingBackgroundEffects />
              <div className="w-full max-w-[720px] flex flex-col items-center gap-6 z-10 my-auto">
                <div className="flex flex-col items-center text-center space-y-2">
                  <h1 className="text-2xl font-bold tracking-tight text-text-primary">
                    What would you like to build?
                  </h1>
                  <p className="text-sm text-text-muted">
                    Prism session is ready. Type your request or choose a mode.
                  </p>
                </div>

                <div className="w-full">
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
            <div className="w-full flex-grow flex flex-col pb-36 pt-4">
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

            <div className="pointer-events-auto max-w-[800px] mx-auto">
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

        {/* Tab-Scoped Todo Drawer */}
        <TodoPanel
          todo={todo}
          isOpen={tab.isTodoOpen}
          onToggle={() => onToggleTodo(tab.id)}
          onClose={() => onCloseTodo(tab.id)}
        />
      </div>
    </div>
  )
})
