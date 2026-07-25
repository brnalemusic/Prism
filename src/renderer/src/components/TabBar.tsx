import React, { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { Plus, X, Columns, ChatTeardropText, StopCircle } from '@phosphor-icons/react'
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
  onNewTab: () => void
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
  onNewTab,
  onToggleSplitTab,
  onStopAgent,
  onReorderTabs
}) => {
  const isMaxTabs = tabs.length >= 10
  const visibleCount = visibleTabIds.length
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null)
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null)
  const [isPlusAnimating, setIsPlusAnimating] = useState<boolean>(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setContextMenu(null)
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

  const handleNewTabClick = (): void => {
    if (isMaxTabs) return
    setIsPlusAnimating(true)
    onNewTab()
    setTimeout(() => setIsPlusAnimating(false), 300)
  }

  const contextTab = contextMenu ? tabs.find((t) => t.id === contextMenu.tabId) : null
  const isContextTabVisible = contextMenu ? visibleTabIds.includes(contextMenu.tabId) : false

  return (
    <div className="flex h-11 w-full items-center justify-between border-b border-white/[0.06] bg-background-main/90 px-3 select-none backdrop-blur-md z-30 relative">
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
                'group relative flex h-8 items-center gap-2 rounded-xl px-2.5 text-xs font-medium transition-all duration-200 cursor-pointer shrink flex-1 min-w-[80px] max-w-[170px] border animate-tab-appear',
                isDragging
                  ? 'opacity-30 scale-95 border-dashed border-accent-primary/40 bg-white/[0.02]'
                  : isDragOver
                    ? 'bg-accent-primary/15 border-accent-primary text-text-primary shadow-[0_0_12px_rgba(255,255,255,0.15)] scale-[1.03] z-10'
                    : isActive
                      ? 'bg-white/[0.08] text-text-primary border-accent-primary/40 shadow-sm'
                      : isVisible
                        ? 'bg-white/[0.04] text-text-secondary hover:bg-white/[0.06] border-white/[0.08]'
                        : 'bg-transparent text-text-muted hover:bg-white/[0.025] hover:text-text-secondary border-transparent'
              )}
            >
              {/* Status icon / spinner */}
              <div className="flex items-center gap-1 shrink-0">
                <ChatTeardropText
                  size={14}
                  className={clsx(
                    isActive ? 'text-accent-primary' : isVisible ? 'text-text-secondary' : 'text-text-muted'
                  )}
                />
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

        {/* Plus (+) Button */}
        <button
          type="button"
          onClick={handleNewTabClick}
          disabled={isMaxTabs}
          title={isMaxTabs ? 'Maximum 10 tabs reached' : 'New tab'}
          className={clsx(
            'flex h-8 w-8 items-center justify-center rounded-xl border border-white/[0.06] transition-all duration-300 shrink-0 cursor-pointer',
            isPlusAnimating ? 'rotate-90 scale-90 border-accent-primary/50 text-accent-primary bg-accent-primary/10' : '',
            isMaxTabs
              ? 'opacity-30 cursor-not-allowed text-text-muted bg-transparent border-transparent'
              : 'bg-white/[0.02] text-text-secondary hover:bg-white/[0.07] hover:text-text-primary active:scale-95'
          )}
        >
          <Plus size={14} className={clsx('transition-transform duration-300', isPlusAnimating && 'rotate-90')} />
        </button>
      </div>

      {/* Model Selector Dropdown */}
      <div className="shrink-0 flex items-center">
        <ModelSelector
          selectedModel={selectedModel}
          onModelChange={onModelChange}
          align="right"
        />
      </div>

      {/* Custom Right-Click Context Menu rendered via Portal at top level */}
      {contextMenu && contextTab && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[99999] w-48 rounded-2xl border border-white/[0.12] bg-surface/95 backdrop-blur-2xl shadow-2xl p-1.5 flex flex-col gap-0.5 animate-soft-pop text-xs select-none pointer-events-auto"
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
        </div>,
        document.body
      )}
    </div>
  )
}
