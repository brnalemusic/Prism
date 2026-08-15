import React, { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import {
  Plus,
  X,
  Columns,
  ChatTeardropText,
  StopCircle,
  GlobeSimple,
  CaretDown,
  SquaresFour
} from '@phosphor-icons/react'
import { ModelSelector } from './ModelSelector'
import type { TabSession } from '../types/tab'

interface TabBarProps {
  tabs: TabSession[]
  activeTabId: string
  visibleTabIds: string[]
  selectedModel: string
  onModelChange: (modelKey: string) => void
  onSelectTab: (id: string) => void
  onCloseTab: (id: string) => void
  onCloseOtherTabs: (keepTabId: string) => void
  onNewTab: () => void
  onOpenBrowserTab: () => void
  onToggleSplitTab: (id: string) => void
  onStopAgent: (id: string) => void
  onReorderTabs?: (sourceTabId: string, targetTabId: string) => void
}

interface ContextMenuState {
  x: number
  y: number
  tabId: string
}

export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTabId,
  visibleTabIds,
  selectedModel,
  onModelChange,
  onSelectTab,
  onCloseTab,
  onCloseOtherTabs,
  onNewTab,
  onOpenBrowserTab,
  onToggleSplitTab,
  onStopAgent,
  onReorderTabs
}) => {
  const isMaxTabs = tabs.length >= 10
  const visibleCount = visibleTabIds.length
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null)
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null)
  const [isPlusMenuOpen, setIsPlusMenuOpen] = useState<boolean>(false)
  const [plusMenuPos, setPlusMenuPos] = useState<{ x: number; y: number } | null>(null)

  const menuRef = useRef<HTMLDivElement>(null)
  const plusMenuRef = useRef<HTMLDivElement>(null)
  const plusBtnGroupRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
      }
      if (
        plusMenuRef.current &&
        !plusMenuRef.current.contains(e.target as Node) &&
        plusBtnGroupRef.current &&
        !plusBtnGroupRef.current.contains(e.target as Node)
      ) {
        setIsPlusMenuOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setContextMenu(null)
        setIsPlusMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  const handleContextMenu = (e: React.MouseEvent, tabId: string): void => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      tabId
    })
  }

  const togglePlusMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    if (isPlusMenuOpen) {
      setIsPlusMenuOpen(false)
    } else {
      const targetElem = plusBtnGroupRef.current || (e.currentTarget as HTMLElement)
      const rect = targetElem.getBoundingClientRect()
      setPlusMenuPos({
        x: rect.left,
        y: rect.bottom + 6
      })
      setIsPlusMenuOpen(true)
    }
  }

  const handleNewTabClick = (): void => {
    if (isMaxTabs) return
    onNewTab()
  }

  const contextTab = contextMenu ? tabs.find((t) => t.id === contextMenu.tabId) : null
  const isContextTabVisible = contextMenu ? visibleTabIds.includes(contextMenu.tabId) : false

  return (
    <div className="flex h-12 w-full items-center justify-between border-b border-[var(--border-subtle)] bg-black px-4 select-none z-30 relative">
      {/* Tabs Container */}
      <div className="flex items-center gap-1.5 flex-1 min-w-0 mr-3 py-1 overflow-hidden">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId
          const isVisible = visibleTabIds.includes(tab.id)
          const isDragging = tab.id === draggedTabId
          const isDragOver = tab.id === dragOverTabId

          return (
            <div
              key={tab.id}
              draggable
              onClick={() => onSelectTab(tab.id)}
              onContextMenu={(e) => handleContextMenu(e, tab.id)}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/prism-tab-id', tab.id)
                e.dataTransfer.effectAllowed = 'move'
                setDraggedTabId(tab.id)
              }}
              onDragEnd={() => {
                setDraggedTabId(null)
                setDragOverTabId(null)
              }}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes('text/prism-tab-id')) {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  if (draggedTabId && draggedTabId !== tab.id && dragOverTabId !== tab.id) {
                    setDragOverTabId(tab.id)
                  }
                }
              }}
              onDragLeave={(e) => {
                if (e.currentTarget.contains(e.relatedTarget as Node)) return
                if (dragOverTabId === tab.id) setDragOverTabId(null)
              }}
              onDrop={(e) => {
                e.preventDefault()
                setDragOverTabId(null)
                const sourceId = e.dataTransfer.getData('text/prism-tab-id')
                if (sourceId && sourceId !== tab.id && onReorderTabs) {
                  onReorderTabs(sourceId, tab.id)
                }
                setDraggedTabId(null)
              }}
              className={clsx(
                'group relative flex h-8 items-center gap-2 rounded-lg px-2.5 text-xs font-medium transition-colors duration-200 cursor-pointer shrink flex-1 min-w-[80px] max-w-[180px] border animate-tab-appear',
                isDragging
                  ? 'opacity-30 scale-95 border-dashed border-accent-primary/40 bg-white/[0.02]'
                  : isDragOver
                    ? 'bg-accent-primary/15 border-accent-primary text-text-primary shadow-[0_0_12px_rgba(255,255,255,0.15)] scale-[1.03] z-10'
                    : isActive
                      ? 'bg-[var(--surface-raised)] text-text-primary border-accent-primary/45'
                      : isVisible
                        ? 'bg-[var(--surface)] text-text-secondary hover:bg-[var(--surface-raised)] border-[var(--border-default)]'
                        : 'bg-transparent text-text-muted hover:bg-[var(--surface)] hover:text-text-secondary border-transparent'
              )}
            >
              {/* Status icon / spinner */}
              <div className="flex items-center gap-1 shrink-0">
                {tab.tabType === 'browser' ? (
                  <GlobeSimple
                    size={14}
                    className={clsx(
                      isActive
                        ? 'text-accent-primary'
                        : isVisible
                          ? 'text-text-secondary'
                          : 'text-text-muted'
                    )}
                  />
                ) : (
                  <ChatTeardropText
                    size={14}
                    className={clsx(
                      isActive
                        ? 'text-accent-primary'
                        : isVisible
                          ? 'text-text-secondary'
                          : 'text-text-muted'
                    )}
                  />
                )}
                {tab.isProcessing && (
                  <span className="h-1.5 w-1.5 rounded-full bg-accent-primary animate-pulse" />
                )}
              </div>

              {/* Tab Title */}
              <span className="truncate flex-1 font-medium tracking-tight text-[11.5px]">
                {tab.title || 'New Chat'}
              </span>

              {/* Close Tab Button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onCloseTab(tab.id)
                }}
                className="flex h-4.5 w-4.5 items-center justify-center rounded text-text-muted opacity-0 group-hover:opacity-100 hover:bg-white/[0.12] hover:text-text-primary transition-all duration-150 shrink-0"
                title="Close tab"
              >
                <X size={11} />
              </button>
            </div>
          )
        })}

        {/* Attached Plus (+) & Dropdown Button Group */}
        <div ref={plusBtnGroupRef} className="shrink-0 flex items-center">
          <div className="flex items-center rounded-lg border border-[var(--border-default)] bg-[var(--surface)] transition-colors duration-200 hover:border-[var(--border-strong)] overflow-hidden">
            {/* Left Button: Plus (+) */}
            <button
              type="button"
              onClick={handleNewTabClick}
              onContextMenu={togglePlusMenu}
              disabled={isMaxTabs}
              title={isMaxTabs ? 'Maximum 10 tabs reached' : 'New tab'}
              className={clsx(
                'flex h-8 px-2.5 items-center justify-center transition-all duration-200 cursor-pointer text-text-secondary hover:bg-white/[0.07] hover:text-text-primary active:scale-95 border-r border-white/[0.06]',
                isMaxTabs && 'opacity-30 cursor-not-allowed hover:bg-transparent text-text-muted'
              )}
            >
              <Plus size={14} />
            </button>

            {/* Right Button: CaretDown Dropdown Toggle */}
            <button
              type="button"
              onClick={togglePlusMenu}
              onContextMenu={togglePlusMenu}
              title="More options"
              className={clsx(
                'flex h-8 px-1.5 items-center justify-center transition-all duration-200 cursor-pointer text-text-secondary hover:bg-white/[0.07] hover:text-text-primary active:scale-95',
                isPlusMenuOpen && 'bg-white/[0.08] text-text-primary'
              )}
            >
              <CaretDown
                size={12}
                className={clsx(
                  'transition-transform duration-200',
                  isPlusMenuOpen && 'rotate-180'
                )}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Model Selector Dropdown */}
      <div className="shrink-0 flex items-center">
        <ModelSelector selectedModel={selectedModel} onModelChange={onModelChange} align="right" />
      </div>

      {/* Plus / New Options Dropdown Menu (Rendered at top-level via Portal) */}
      {isPlusMenuOpen &&
        plusMenuPos &&
        createPortal(
          <div
            ref={plusMenuRef}
            className="fixed z-[99999] w-44 rounded-xl border border-[var(--border-default)] bg-[var(--surface-raised)] shadow-[0_20px_48px_rgba(0,0,0,0.5)] p-1.5 flex flex-col gap-0.5 animate-soft-pop text-xs select-none pointer-events-auto"
            style={{
              left: `${Math.min(plusMenuPos.x, window.innerWidth - 180)}px`,
              top: `${Math.min(plusMenuPos.y, window.innerHeight - 120)}px`
            }}
          >
            {/* New tab */}
            <button
              type="button"
              disabled={isMaxTabs}
              onClick={() => {
                handleNewTabClick()
                setIsPlusMenuOpen(false)
              }}
              className={clsx(
                'flex items-center gap-2.5 px-3 py-2 rounded-xl text-left font-medium transition-colors w-full cursor-pointer',
                isMaxTabs
                  ? 'opacity-40 cursor-not-allowed text-text-muted'
                  : 'text-text-secondary hover:bg-white/[0.08] hover:text-text-primary'
              )}
            >
              <Plus size={14} className="text-accent-primary shrink-0" />
              <span>New tab</span>
            </button>

            {/* AI Browser */}
            <button
              type="button"
              disabled={tabs.some((t) => t.tabType === 'browser')}
              onClick={() => {
                if (!tabs.some((t) => t.tabType === 'browser')) {
                  onOpenBrowserTab()
                }
                setIsPlusMenuOpen(false)
              }}
              title={
                tabs.some((t) => t.tabType === 'browser')
                  ? 'An AI Browser tab is already open'
                  : 'AI Browser'
              }
              className={clsx(
                'flex items-center gap-2.5 px-3 py-2 rounded-xl text-left font-medium transition-colors w-full',
                tabs.some((t) => t.tabType === 'browser')
                  ? 'opacity-40 cursor-not-allowed text-text-muted'
                  : 'text-text-secondary hover:bg-white/[0.08] hover:text-text-primary cursor-pointer'
              )}
            >
              <GlobeSimple size={14} className="text-accent-primary shrink-0" />
              <span className="flex-1">AI Browser</span>
              {tabs.some((t) => t.tabType === 'browser') && (
                <span className="text-[10px] opacity-60 font-normal">Active</span>
              )}
            </button>
          </div>,
          document.body
        )}

      {/* Custom Right-Click Context Menu for Tabs (Rendered via Portal) */}
      {contextMenu &&
        contextTab &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-[99999] w-48 rounded-xl border border-[var(--border-default)] bg-[var(--surface-raised)] shadow-[0_20px_48px_rgba(0,0,0,0.5)] p-1.5 flex flex-col gap-0.5 animate-soft-pop text-xs select-none pointer-events-auto"
            style={{
              left: `${Math.min(contextMenu.x, window.innerWidth - 200)}px`,
              top: `${Math.min(contextMenu.y, window.innerHeight - 160)}px`
            }}
          >
            {/* Split View Toggle */}
            <button
              type="button"
              disabled={!isContextTabVisible && visibleCount >= 4}
              onClick={() => {
                onToggleSplitTab(contextTab.id)
                setContextMenu(null)
              }}
              className={clsx(
                'flex items-center gap-2.5 px-3 py-2 rounded-xl text-left font-medium transition-colors w-full cursor-pointer',
                !isContextTabVisible && visibleCount >= 4
                  ? 'opacity-40 cursor-not-allowed text-text-muted'
                  : 'text-text-secondary hover:bg-white/[0.08] hover:text-text-primary'
              )}
            >
              <Columns size={14} className="text-accent-primary shrink-0" />
              <span>{isContextTabVisible ? 'Remove from split view' : 'Split view'}</span>
            </button>

            {/* Stop Agent (Always present) */}
            <button
              type="button"
              onClick={() => {
                onStopAgent(contextTab.id)
                setContextMenu(null)
              }}
              className={clsx(
                'flex items-center gap-2.5 px-3 py-2 rounded-xl text-left font-medium transition-colors w-full cursor-pointer',
                contextTab.isProcessing
                  ? 'text-status-error hover:bg-status-error/10'
                  : 'text-text-muted hover:bg-white/[0.05] hover:text-text-secondary'
              )}
              title={contextTab.isProcessing ? 'Stop agent processing' : 'Agent is not processing'}
            >
              <StopCircle size={14} className="shrink-0" />
              <span>Stop agent</span>
            </button>

            <div className="h-[1px] bg-white/[0.06] my-0.5" />

            {/* Close Tab */}
            <button
              type="button"
              onClick={() => {
                onCloseTab(contextTab.id)
                setContextMenu(null)
              }}
              className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-left font-medium text-text-secondary hover:bg-white/[0.08] hover:text-text-primary transition-colors w-full cursor-pointer"
            >
              <X size={14} className="shrink-0" />
              <span>Close tab</span>
            </button>

            {/* Close Other Tabs */}
            <button
              type="button"
              disabled={tabs.length <= 1}
              onClick={() => {
                onCloseOtherTabs(contextTab.id)
                setContextMenu(null)
              }}
              className={clsx(
                'flex items-center gap-2.5 px-3 py-2 rounded-xl text-left font-medium transition-colors w-full cursor-pointer',
                tabs.length <= 1
                  ? 'opacity-40 cursor-not-allowed text-text-muted'
                  : 'text-status-error hover:bg-status-error/10'
              )}
            >
              <SquaresFour size={14} className="shrink-0" />
              <span>Close other tabs</span>
            </button>
          </div>,
          document.body
        )}
    </div>
  )
}
