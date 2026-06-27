import { useEffect, useState } from 'react'
import { Folder, Lightning, ChatTeardropText, Trash, X, Clock, MagnifyingGlass } from '@phosphor-icons/react'
import clsx from 'clsx'
import { Spinner } from './Spinner'
import type { SessionMode } from '../../../shared/types'

interface ChatSession {
  id: string
  title: string
  lastUpdated: number
  sessionMode?: SessionMode
  disciplinePath?: string
}

interface FolderChatsPanelProps {
  folderName: string
  folderPath: string
  chats: ChatSession[]
  currentChatId?: string
  runningChats?: Record<string, boolean>
  deletingChatId?: string | null
  onLoadChat: (id: string) => void
  onViewChange: (view: string) => void
  onDeleteChat: (e: React.MouseEvent, id: string) => Promise<void>
  onClose: () => void
}

export function FolderChatsPanel({
  folderName,
  folderPath,
  chats,
  currentChatId,
  runningChats = {},
  deletingChatId,
  onLoadChat,
  onViewChange,
  onDeleteChat,
  onClose
}: FolderChatsPanelProps): React.JSX.Element {
  const [filterQuery, setFilterQuery] = useState('')

  useEffect(() => {
    setFilterQuery('')
  }, [folderPath])

  const isGeneral = folderPath === '__general__'
  const Icon = isGeneral ? Lightning : Folder

  const filteredChats = chats.filter((chat) =>
    chat.title.toLowerCase().includes(filterQuery.toLowerCase())
  )

  const formatLastUpdated = (timestamp: number): string => {
    const date = new Date(timestamp)
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    })}`
  }

  return (
    <div className="w-[328px] h-full flex flex-col shrink-0 bg-background-main/40">
      {/* Header */}
      <div className="p-5 pb-4 shrink-0 flex items-center justify-between border-b border-white/[0.04] mt-10">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={clsx(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border',
              isGeneral
                ? 'border-accent-primary/20 bg-accent-primary/[0.08] text-accent-primary'
                : 'border-white/[0.08] bg-white/[0.02] text-text-secondary'
            )}
          >
            <Icon size={16} weight={isGeneral ? 'fill' : 'regular'} />
          </div>
          <div className="flex flex-col min-w-0">
            <h2 className="text-sm font-semibold text-text-primary truncate">
              {isGeneral ? 'General Chats' : folderName}
            </h2>
            <span className="text-[10px] font-medium text-text-muted/80">
              {chats.length} chat{chats.length !== 1 ? 's' : ''} in total
            </span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-xl p-1.5 text-text-secondary/50 transition-colors hover:bg-white/[0.06] hover:text-text-primary cursor-pointer shrink-0"
          title="Close panel"
        >
          <X size={16} />
        </button>
      </div>

      {/* Search filter inside folder */}
      {chats.length > 5 && (
        <div className="px-5 pt-4 pb-2 shrink-0">
          <div className="relative flex items-center">
            <input
              type="text"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="Search chats in this folder..."
              className="w-full rounded-xl border border-white/[0.06] bg-white/[0.02] pl-9 pr-12 py-2 text-xs text-text-primary placeholder:text-text-muted transition-all focus:border-accent-primary/30 focus:outline-none"
            />
            <MagnifyingGlass
              size={12}
              className="absolute left-3 text-text-secondary/40 pointer-events-none"
            />
            {filterQuery && (
              <button
                onClick={() => setFilterQuery('')}
                className="absolute right-2 text-text-secondary/40 hover:text-text-primary text-[10px] bg-white/[0.05] hover:bg-white/[0.1] px-1.5 py-0.5 rounded cursor-pointer font-mono"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      {/* Chats List */}
      <div className="flex-1 overflow-y-auto p-5 pt-2 flex flex-col gap-2 min-h-0 custom-scrollbar pb-20">
        {filteredChats.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center text-xs text-text-muted/60">
            <Clock size={20} className="mb-2 opacity-40 text-text-muted" />
            {filterQuery ? 'No chats match search' : 'No chats in folder'}
          </div>
        ) : (
          filteredChats.map((chat) => (
            <div
              key={chat.id}
              onClick={() => {
                onViewChange('chat')
                onLoadChat(chat.id)
              }}
              className={clsx(
                'group flex items-center justify-between gap-3 rounded-xl border p-3 transition-all duration-200 cursor-pointer select-none',
                currentChatId === chat.id
                  ? 'border-accent-primary/20 bg-accent-primary/[0.03] hover:bg-accent-primary/[0.05]'
                  : 'border-white/[0.04] bg-white/[0.015] hover:bg-white/[0.03] hover:border-white/[0.08]'
              )}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className={clsx(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-colors',
                    currentChatId === chat.id
                      ? 'border-accent-primary/20 bg-accent-primary/[0.06] text-accent-primary'
                      : 'border-white/[0.06] bg-white/[0.02] text-text-secondary group-hover:text-text-primary'
                  )}
                >
                  <ChatTeardropText size={14} />
                </div>
                <div className="flex flex-col min-w-0">
                  <span
                    className={clsx(
                      'text-xs truncate transition-colors',
                      currentChatId === chat.id
                        ? 'text-accent-primary font-medium'
                        : 'text-text-primary group-hover:text-white'
                    )}
                  >
                    {chat.title || 'Untitled Chat'}
                  </span>
                  <span className="text-[10px] text-text-muted/70 flex items-center gap-1 mt-0.5">
                    <Clock size={9} />
                    {formatLastUpdated(chat.lastUpdated)}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {runningChats[chat.id] && <Spinner size="xs" />}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onDeleteChat(e, chat.id)
                  }}
                  disabled={deletingChatId === chat.id}
                  className={clsx(
                    'rounded-lg p-1 text-text-secondary/50 opacity-0 group-hover:opacity-100 transition-all duration-200 hover:bg-white/[0.06] hover:text-status-error cursor-pointer',
                    deletingChatId === chat.id && 'opacity-100 animate-pulse text-status-error'
                  )}
                  title="Delete chat"
                >
                  {deletingChatId === chat.id ? <Spinner size="xxs" /> : <Trash size={12} />}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
