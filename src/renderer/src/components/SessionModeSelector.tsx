import React from 'react'
import { ChatTeardropText, Lightning, Folder } from '@phosphor-icons/react'
import { SessionMode } from '../../../shared/types'
import { clsx } from 'clsx'

interface SessionModeSelectorProps {
  mode: SessionMode
  disciplinePath: string
  onModeChange: (mode: SessionMode) => void
  onSelectFolder: () => void
}

export const SessionModeSelector: React.FC<SessionModeSelectorProps> = ({
  mode,
  disciplinePath,
  onModeChange,
  onSelectFolder
}) => {
  // Extract folder name (basename)
  const getFolderBasename = (fullPath: string) => {
    if (!fullPath) return ''
    // Handle both Windows and POSIX separators
    const parts = fullPath.split(/[\\/]/)
    return parts[parts.length - 1] || fullPath
  }

  const folderName = getFolderBasename(disciplinePath)

  return (
    <div className="session-mode-container">
      <div className="session-mode-tabs">
        <div
          className={clsx('session-mode-indicator', {
            'pos-conversation': mode === 'conversation',
            'pos-execution': mode === 'execution',
            'pos-discipline': mode === 'discipline'
          })}
        />
        <button
          type="button"
          className={clsx('session-mode-tab', mode === 'conversation' && 'active')}
          onClick={() => onModeChange('conversation')}
          title="Conversation Mode: Chat only, no tools or command execution."
        >
          <ChatTeardropText size={18} weight={mode === 'conversation' ? 'fill' : 'regular'} />
          <span>Conversation</span>
        </button>
        <button
          type="button"
          className={clsx('session-mode-tab', mode === 'execution' && 'active')}
          onClick={() => onModeChange('execution')}
          title="Execution Mode: Execute tools and commands in your user profile folder."
        >
          <Lightning size={18} weight={mode === 'execution' ? 'fill' : 'regular'} />
          <span>Execution</span>
        </button>
        <button
          type="button"
          className={clsx('session-mode-tab', mode === 'discipline' && 'active')}
          onClick={() => onModeChange('discipline')}
          title="Discipline Mode: Operate and run commands directly in a specific project folder."
        >
          <Folder size={18} weight={mode === 'discipline' ? 'fill' : 'regular'} />
          <span>Discipline</span>
        </button>
      </div>

      {mode === 'discipline' && (
        <div className="session-mode-discipline-path anim-fade-in">
          <div className="path-display" title={disciplinePath || 'No folder selected'}>
            <Folder size={16} className="folder-icon" />
            <span className="path-text">
              {folderName ? `Project: ${folderName}` : 'Select a folder to operate in'}
            </span>
          </div>
          <button type="button" className="change-folder-btn" onClick={onSelectFolder}>
            {disciplinePath ? 'Change' : 'Browse'}
          </button>
        </div>
      )}
    </div>
  )
}
