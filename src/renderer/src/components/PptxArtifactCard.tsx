import React, { useState } from 'react'
import { FilePpt, FolderOpen, ArrowSquareOut, Copy, Check } from '@phosphor-icons/react'

interface PptxArtifactCardProps {
  id?: string
  filename?: string
  path?: string
  toolName?: 'write_pptx' | 'edit_pptx'
}

export const PptxArtifactCard: React.FC<PptxArtifactCardProps> = ({
  id,
  filename = 'presentation.pptx',
  path,
  toolName = 'write_pptx'
}) => {
  const [copied, setCopied] = useState(false)

  const handleCopyPath = () => {
    if (path) {
      navigator.clipboard.writeText(path)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleOpenFile = () => {
    if (path && window.api?.openArtifactFile) {
      window.api.openArtifactFile(path)
    }
  }

  const handleOpenFolder = () => {
    if (path && window.api?.showArtifactInFolder) {
      window.api.showArtifactInFolder(path)
    }
  }

  return (
    <div className="my-2 w-full overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--surface)] transition-colors duration-200 hover:border-[var(--border-strong)]">
      {/* Header Bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] bg-white/[0.02]">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-500/15 text-orange-400 shrink-0">
            <FilePpt size={18} weight="bold" />
          </div>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-text-primary truncate">{filename}</span>
              {id && (
                <span className="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded bg-white/[0.08] text-amber-400 border border-white/[0.06]">
                  ID: #{id}
                </span>
              )}
            </div>
            <span className="text-[11px] text-text-muted">
              {toolName === 'edit_pptx'
                ? 'Presentation Artifact updated'
                : 'Presentation Artifact generated'}
            </span>
          </div>
        </div>
      </div>

      {/* Path & Actions Body */}
      {path && (
        <div className="px-4 py-2.5 flex flex-col gap-2 bg-black/20">
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="text-text-muted truncate font-mono select-all" title={path}>
              {path}
            </span>
            <button
              type="button"
              onClick={handleCopyPath}
              className="text-text-muted hover:text-text-primary transition-colors shrink-0 p-1 rounded hover:bg-white/[0.06]"
              title="Copy path"
            >
              {copied ? <Check size={13} className="text-status-success" /> : <Copy size={13} />}
            </button>
          </div>

          <div className="flex items-center gap-2 pt-1 border-t border-white/[0.04]">
            <button
              type="button"
              onClick={handleOpenFile}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-text-secondary hover:text-text-primary bg-white/[0.04] hover:bg-white/[0.08] rounded-md transition-colors cursor-pointer"
            >
              <ArrowSquareOut size={13} />
              <span>Open Presentation</span>
            </button>
            <button
              type="button"
              onClick={handleOpenFolder}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-text-secondary hover:text-text-primary bg-white/[0.04] hover:bg-white/[0.08] rounded-md transition-colors cursor-pointer"
            >
              <FolderOpen size={13} />
              <span>Show in Folder</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
