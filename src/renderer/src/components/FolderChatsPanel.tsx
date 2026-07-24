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
    <div className="w-[320px] h-full flex flex-col shrink-0 bg-black/40">
      {/* Header */}
      <div className="p-4 pb-3 shrink-0 flex items-center justify-between border-b border-white/[0.03] mt-8">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={clsx(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
              isGeneral
                ? 'bg-white/[0.08] text-white'
                : 'bg-white/[0.04] text-text-secondary'
            )}
          >
            <Icon size={15} weight={isGeneral ? 'fill' : 'regular'} />
          </div>
          <div className="flex flex-col min-w-0">
            <h2 className="text-xs font-semibold text-text-primary truncate">
              {isGeneral ? 'General Chats' : folderName}
            </h2>
            <span className="text-[10px] font-medium text-text-muted/70">
              {chats.length} chat{chats.length !== 1 ? 's' : ''} in total
            </span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-text-muted hover:bg-white/[0.05] hover:text-text-primary transition-all duration-200 cursor-pointer shrink-0"
          title="Close panel"
        >
          <X size={15} />
        </button>
      </div>

      {/* Search filter inside folder */}
      {chats.length > 5 && (
        <div className="px-4 pt-3 pb-1 shrink-0">
          <div className="relative flex items-center">
            <input
              type="text"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="Filter chats..."
              className="w-full rounded-lg bg-white/[0.03] pl-8 pr-10 py-1.5 text-xs text-text-primary placeholder:text-text-muted/60 transition-all focus:outline-none focus:bg-white/[0.05]"
            />
            <MagnifyingGlass
              size={12}
              className="absolute left-2.5 text-text-muted/50 pointer-events-none"
            />
            {filterQuery && (
              <button
                onClick={() => setFilterQuery('')}
                className="absolute right-2 text-text-muted hover:text-text-primary text-[10px] bg-white/[0.05] hover:bg-white/[0.1] px-1.5 py-0.5 rounded cursor-pointer font-mono"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      {/* Chats List */}
      <div className="flex-1 overflow-y-auto p-4 pt-2 flex flex-col gap-1 min-h-0 custom-scrollbar pb-20">
        {filteredChats.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center text-xs text-text-muted/50">
            <Clock size={18} className="mb-2 opacity-40 text-text-muted" />
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
                'group flex items-center justify-between gap-2.5 rounded-lg px-3 py-2.5 transition-all duration-200 cursor-pointer select-none',
                currentChatId === chat.id
                  ? 'bg-white/[0.06] text-text-primary font-medium'
                  : 'hover:bg-white/[0.025] text-text-secondary hover:text-text-primary'
              )}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className={clsx(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors',
                    currentChatId === chat.id
                      ? 'bg-white/10 text-white'
                      : 'bg-white/[0.03] text-text-muted group-hover:text-text-secondary'
                  )}
                >
                  <ChatTeardropText size={13} />
                </div>
                <div className="flex flex-col min-w-0">
                  <span
                    className={clsx(
                      'text-xs truncate transition-colors',
                      currentChatId === chat.id
                        ? 'text-white font-medium'
                        : 'text-text-primary group-hover:text-white'
                    )}
                  >
                    {chat.title || 'Untitled Chat'}
                  </span>
                  <span className="text-[10px] text-text-muted/60 flex items-center gap-1 mt-0.5">
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
                    'rounded-md p-1 text-text-muted opacity-0 group-hover:opacity-100 transition-all duration-200 hover:bg-white/[0.06] hover:text-status-error cursor-pointer',
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
