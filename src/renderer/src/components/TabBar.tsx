import React from 'react'
import clsx from 'clsx'
import { Plus, X, Columns, SquaresFour, ChatTeardropText } from '@phosphor-icons/react'
import type { TabSession } from '../types/tab'

interface TabBarProps {
  tabs: TabSession[]
  activeTabId: string
  visibleTabIds: string[]
  onSelectTab: (id: string) => void
  onCloseTab: (id: string) => void
  onNewTab: () => void
  onToggleSplitTab: (id: string) => void
}

export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTabId,
  visibleTabIds,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onToggleSplitTab
}) => {
  const isMaxTabs = tabs.length >= 10
  const visibleCount = visibleTabIds.length

  return (
    <div className="flex h-10 w-full items-center justify-between border-b border-white/[0.06] bg-background-main/90 px-3 select-none backdrop-blur-md z-30">
      {/* Scrollable Tabs List */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar flex-1 mr-2 py-1">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId
          const isVisible = visibleTabIds.includes(tab.id)

          return (
            <div
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              className={clsx(
                'group relative flex h-8 items-center gap-2 rounded-xl px-3 text-xs font-medium transition-all duration-200 cursor-pointer shrink-0 border max-w-[200px]',
                isActive
                  ? 'bg-white/[0.08] text-text-primary border-accent-primary/40 shadow-sm'
                  : isVisible
                    ? 'bg-white/[0.04] text-text-secondary hover:bg-white/[0.06] border-white/[0.08]'
                    : 'bg-transparent text-text-muted hover:bg-white/[0.025] hover:text-text-secondary border-transparent'
              )}
            >
              {/* Tab status indicator */}
              <div className="flex items-center gap-1.5 shrink-0">
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

              {/* Title */}
              <span className="truncate max-w-[110px] font-medium tracking-tight">
                {tab.title || 'New Chat'}
              </span>

              {/* Action badges: Split view toggle + Close tab */}
              <div className="flex items-center gap-1 shrink-0">
                {/* Split view toggle button */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleSplitTab(tab.id)
                  }}
                  title={
                    isVisible
                      ? 'Remove from split view'
                      : visibleCount >= 4
                        ? 'Split view limit reached (max 4)'
                        : 'Show in split view'
                  }
                  disabled={!isVisible && visibleCount >= 4}
                  className={clsx(
                    'flex h-5 w-5 items-center justify-center rounded-md transition-all duration-150',
                    isVisible
                      ? 'bg-accent-primary/20 text-accent-primary hover:bg-accent-primary/30'
                      : 'text-text-muted opacity-0 group-hover:opacity-100 hover:bg-white/[0.08] hover:text-text-secondary disabled:opacity-30 disabled:cursor-not-allowed'
                  )}
                >
                  <Columns size={12} weight={isVisible ? 'bold' : 'regular'} />
                </button>

                {/* Close Tab Button */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onCloseTab(tab.id)
                  }}
                  className="flex h-5 w-5 items-center justify-center rounded-md text-text-muted hover:bg-white/[0.1] hover:text-text-primary transition-colors duration-150"
                  title="Close tab"
                >
                  <X size={12} />
                </button>
              </div>
            </div>
          )
        })}

        {/* New Tab Button */}
        <button
          type="button"
          onClick={onNewTab}
          disabled={isMaxTabs}
          title={isMaxTabs ? 'Maximum 10 tabs reached' : 'New tab'}
          className={clsx(
            'flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium border border-white/[0.05] transition-all duration-200 shrink-0 cursor-pointer',
            isMaxTabs
              ? 'opacity-40 cursor-not-allowed text-text-muted bg-transparent'
              : 'bg-white/[0.02] text-text-secondary hover:bg-white/[0.06] hover:text-text-primary active:scale-95'
          )}
        >
          <Plus size={14} />
          <span className="hidden sm:inline">New Tab</span>
          <span className="text-[10px] text-text-muted font-mono bg-white/[0.04] px-1 rounded">
            {tabs.length}/10
          </span>
        </button>
      </div>

      {/* Split View Status Indicator */}
      <div className="flex items-center gap-2 text-xs text-text-muted font-mono shrink-0 bg-white/[0.02] px-2.5 py-1 rounded-xl border border-white/[0.04]">
        <SquaresFour size={14} className="text-accent-primary" />
        <span className="text-[11px]">
          Visible: <strong className="text-text-primary font-semibold">{visibleCount}</strong>/4
        </span>
      </div>
    </div>
  )
}
