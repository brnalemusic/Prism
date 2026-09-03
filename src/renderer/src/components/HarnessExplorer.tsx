import React, { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import {
  CaretDown,
  CaretRight,
  File,
  Folder,
  FolderOpen,
  PaperPlaneTilt,
  Path,
  ArrowClockwise,
  Warning
} from '@phosphor-icons/react'
import type {
  HarnessExplorerItem,
  HarnessExplorerSelection
} from '../../../shared/types'

export const HARNESS_EXPLORER_MIME = 'application/x-prism-harness-explorer-item'

interface HarnessExplorerProps {
  projectPath?: string
  selections: HarnessExplorerSelection[]
  onAdd: (selection: HarnessExplorerSelection) => boolean
  onRemove: (relativePath: string) => void
}

interface TreeNodeProps {
  item: HarnessExplorerItem
  projectPath: string
  depth: number
  selectedPaths: Set<string>
  onToggleSelection: (item: HarnessExplorerItem) => void
  refreshKey: number
}

function selectionFromItem(item: HarnessExplorerItem): HarnessExplorerSelection {
  return { name: item.name, kind: item.kind, relativePath: item.relativePath }
}

function TreeNode({
  item,
  projectPath,
  depth,
  selectedPaths,
  onToggleSelection,
  refreshKey
}: TreeNodeProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState<HarnessExplorerItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const selected = selectedPaths.has(item.relativePath.toLowerCase())

  const loadChildren = useCallback(async (): Promise<void> => {
    if (item.kind !== 'directory') return
    setLoading(true)
    setError('')
    const result = await window.api.listHarnessDirectory(projectPath, item.relativePath)
    setLoading(false)
    if (result.ok) setChildren(result.items)
    else setError(result.error || 'Unable to load this directory.')
  }, [item.kind, item.relativePath, projectPath])

  useEffect(() => {
    if (expanded) void loadChildren()
  }, [expanded, refreshKey, loadChildren])

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [menu])

  const selection = selectionFromItem(item)
  const runAction = async (
    action: 'open' | 'copy' | 'show'
  ): Promise<void> => {
    const result =
      action === 'open'
        ? await window.api.openHarnessExplorerFile(projectPath, selection)
        : action === 'copy'
          ? await window.api.copyHarnessExplorerPath(projectPath, selection)
          : await window.api.showHarnessExplorerItem(projectPath, selection)
    if (!result.ok) setError(result.error || 'The Explorer action failed.')
  }

  return (
    <div>
      <button
        type="button"
        draggable={item.kind === 'file'}
        onDragStart={(event) => {
          if (item.kind !== 'file') return
          event.dataTransfer.setData(HARNESS_EXPLORER_MIME, JSON.stringify(selection))
          event.dataTransfer.effectAllowed = 'copy'
        }}
        onClick={() => {
          if (item.kind === 'directory') setExpanded((value) => !value)
        }}
        onDoubleClick={() => {
          if (item.kind === 'file') void runAction('open')
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          setMenu({
            x: Math.min(event.clientX, window.innerWidth - 190),
            y: Math.min(event.clientY, window.innerHeight - 190)
          })
        }}
        className={clsx(
          'group flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-left text-[11.5px] transition-colors',
          selected
            ? 'border border-accent-primary/30 bg-accent-primary/10 text-text-primary'
            : 'border border-transparent text-text-secondary hover:bg-white/[0.045] hover:text-text-primary'
        )}
        style={{ paddingLeft: 6 + depth * 12 }}
        title={item.relativePath}
      >
        {item.kind === 'directory' ? (
          expanded ? <CaretDown size={10} /> : <CaretRight size={10} />
        ) : (
          <span className="w-[10px]" />
        )}
        {item.kind === 'directory' ? (
          expanded ? (
            <FolderOpen size={13} weight="fill" className="shrink-0 text-accent-primary/80" />
          ) : (
            <Folder size={13} weight="fill" className="shrink-0 text-text-muted" />
          )
        ) : (
          <File size={13} className="shrink-0 text-text-muted group-hover:text-text-secondary" />
        )}
        <span className="min-w-0 flex-1 truncate">{item.name}</span>
        {selected && <PaperPlaneTilt size={11} weight="fill" className="shrink-0 text-accent-primary" />}
      </button>
      {error && <p className="py-1 pl-6 pr-2 text-[10px] leading-snug text-status-error">{error}</p>}
      {expanded && (
        <div>
          {loading && <p className="py-1 pl-8 text-[10px] text-text-muted">Loading...</p>}
          {!loading && children.length === 0 && !error && (
            <p className="py-1 pl-8 text-[10px] italic text-text-muted/70">Empty</p>
          )}
          {!loading && children.map((child) => (
            <TreeNode
              key={child.relativePath}
              item={child}
              projectPath={projectPath}
              depth={depth + 1}
              selectedPaths={selectedPaths}
              onToggleSelection={onToggleSelection}
              refreshKey={refreshKey}
            />
          ))}
        </div>
      )}
      {menu && (
        <div
          onMouseDown={(event) => event.stopPropagation()}
          className="fixed z-[120] w-44 rounded-xl border border-white/[0.13] bg-[#0b0d12]/98 p-1.5 shadow-[0_18px_50px_rgba(0,0,0,0.65)] backdrop-blur-2xl"
          style={{ left: menu.x, top: menu.y }}
        >
          <MenuButton
            label={selected ? 'Remove from agent' : 'Send to agent'}
            accent
            onClick={() => {
              onToggleSelection(item)
              setMenu(null)
            }}
          />
          <div className="my-1 h-px bg-white/[0.08]" />
          {item.kind === 'file' && <MenuButton label="Open file" onClick={() => void runAction('open')} />}
          <MenuButton label="Copy path" onClick={() => void runAction('copy')} />
          <MenuButton label="Open in file explorer" onClick={() => void runAction('show')} />
        </div>
      )}
    </div>
  )
}

function MenuButton({ label, onClick, accent = false }: { label: string; onClick: () => void; accent?: boolean }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'w-full rounded-lg px-2.5 py-1.5 text-left text-[11px] transition-colors hover:bg-white/[0.07]',
        accent ? 'font-semibold text-accent-primary' : 'text-text-secondary hover:text-text-primary'
      )}
    >
      {label}
    </button>
  )
}

export function HarnessExplorer({ projectPath, selections, onAdd, onRemove }: HarnessExplorerProps): React.JSX.Element {
  const [items, setItems] = useState<HarnessExplorerItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const selectedPaths = useMemo(
    () => new Set(selections.map((selection) => selection.relativePath.toLowerCase())),
    [selections]
  )

  const refresh = useCallback(async (): Promise<void> => {
    if (!projectPath) {
      setItems([])
      return
    }
    setLoading(true)
    setError('')
    const result = await window.api.listHarnessDirectory(projectPath, '.')
    setLoading(false)
    if (result.ok) {
      setItems(result.items)
      setRefreshKey((value) => value + 1)
    } else {
      setItems([])
      setError(result.error || 'Unable to load this project.')
    }
  }, [projectPath])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const toggleSelection = (item: HarnessExplorerItem): void => {
    if (selectedPaths.has(item.relativePath.toLowerCase())) {
      if (window.confirm(`Remove "${item.name}" from the next agent message?`)) {
        onRemove(item.relativePath)
      }
      return
    }
    if (!onAdd(selectionFromItem(item))) setError('You can send up to 5 files or folders per Harness tab.')
  }

  const projectName = projectPath?.split(/[\\/]/).filter(Boolean).pop() || 'Explorer'
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 py-3">
      <div className="mb-2 flex shrink-0 items-center gap-2 px-1">
        <Folder size={12} weight="fill" className="text-text-muted" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-text-secondary">{projectName}</p>
          {projectPath && <p className="truncate font-mono text-[9px] text-text-muted/70" title={projectPath}>{projectPath}</p>}
        </div>
        <span className="rounded-md bg-white/[0.045] px-1.5 py-0.5 font-mono text-[9px] text-text-muted">{selections.length}/5</span>
        <button type="button" onClick={() => void refresh()} disabled={!projectPath || loading} className="rounded-md p-1 text-text-muted transition-colors hover:bg-white/[0.06] hover:text-text-primary disabled:opacity-30" title="Refresh Explorer">
          <ArrowClockwise size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
        {!projectPath ? (
          <div className="flex h-full flex-col items-center justify-center px-3 text-center text-[11px] leading-relaxed text-text-muted">
            <Path size={19} className="mb-2" />
            Choose a Harness project to browse its files.
          </div>
        ) : error && items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-3 text-center text-[11px] leading-relaxed text-status-error">
            <Warning size={18} className="mb-2" />
            {error}
          </div>
        ) : items.length === 0 && !loading ? (
          <p className="py-8 text-center text-[11px] text-text-muted">No visible project files.</p>
        ) : (
          items.map((item) => (
            <TreeNode key={item.relativePath} item={item} projectPath={projectPath} depth={0} selectedPaths={selectedPaths} onToggleSelection={toggleSelection} refreshKey={refreshKey} />
          ))
        )}
      </div>
      {error && items.length > 0 && <p className="mt-2 shrink-0 rounded-lg border border-status-error/20 bg-status-error/5 px-2 py-1.5 text-[10px] text-status-error">{error}</p>}
    </div>
  )
}
