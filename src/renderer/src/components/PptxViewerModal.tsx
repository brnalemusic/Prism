import React, { useState, useEffect, useRef, useCallback } from 'react'
import clsx from 'clsx'
import {
  FilePpt,
  PencilSimple,
  Eraser,
  ArrowUUpLeft,
  Trash,
  MagnifyingGlassPlus,
  MagnifyingGlassMinus,
  ArrowsIn,
  FolderOpen,
  ArrowSquareOut,
  Copy,
  Check,
  X,
  Code,
  Eye,
  SidebarSimple
} from '@phosphor-icons/react'
import type { ArtifactItem } from '../../../shared/types'

interface PptxViewerModalProps {
  artifact: ArtifactItem | null
  isOpen: boolean
  onClose: () => void
}

interface DrawingStroke {
  color: string
  width: number
  points: Array<{ x: number; y: number }>
  isEraser?: boolean
}

const COLOR_PALETTE = [
  { name: 'Red Pen', value: '#ef4444' },
  { name: 'Yellow Highlighter', value: '#facc15' },
  { name: 'Cyan Pen', value: '#06b6d4' },
  { name: 'Green Pen', value: '#10b981' },
  { name: 'Purple Pen', value: '#a855f7' }
]

const STROKE_WIDTHS = [
  { name: 'Fine', value: 2 },
  { name: 'Medium', value: 4 },
  { name: 'Thick', value: 8 }
]

export const PptxViewerModal: React.FC<PptxViewerModalProps> = ({ artifact, isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<'visual' | 'code'>('visual')
  const [zoomLevel, setZoomLevel] = useState<number>(100)
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(true)
  const [copied, setCopied] = useState<boolean>(false)

  // Pen Tool States
  const [isPenActive, setIsPenActive] = useState<boolean>(false)
  const [selectedColor, setSelectedColor] = useState<string>('#ef4444')
  const [selectedWidth, setSelectedWidth] = useState<number>(4)
  const [isEraser, setIsEraser] = useState<boolean>(false)
  const [strokes, setStrokes] = useState<DrawingStroke[]>([])

  // Drawing Canvas Ref
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const isDrawingRef = useRef<boolean>(false)
  const currentStrokeRef = useRef<Array<{ x: number; y: number }>>([])

  // Reset state when opening a new artifact
  useEffect(() => {
    if (isOpen) {
      setZoomLevel(100)
      setActiveTab('visual')
      setStrokes([])
      setIsPenActive(false)
      setIsEraser(false)
    }
  }, [isOpen, artifact?.id])

  // ESC key listener to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // Canvas redraw effect
  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    strokes.forEach((stroke) => {
      if (stroke.points.length < 2) return
      ctx.beginPath()
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y)
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y)
      }
      ctx.strokeStyle = stroke.isEraser ? 'rgba(0,0,0,1)' : stroke.color
      ctx.lineWidth = stroke.width
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'

      if (stroke.isEraser) {
        ctx.globalCompositeOperation = 'destination-out'
      } else {
        ctx.globalCompositeOperation = 'source-over'
      }
      ctx.stroke()
    })
    ctx.globalCompositeOperation = 'source-over'
  }, [strokes])

  useEffect(() => {
    redrawCanvas()
  }, [redrawCanvas])

  if (!isOpen || !artifact) return null

  // Canvas Mouse Event Handlers for Freehand Drawing
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isPenActive) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = (e.clientX - rect.left) * (canvas.width / rect.width)
    const y = (e.clientY - rect.top) * (canvas.height / rect.height)

    isDrawingRef.current = true
    currentStrokeRef.current = [{ x, y }]
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current || !isPenActive) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = (e.clientX - rect.left) * (canvas.width / rect.width)
    const y = (e.clientY - rect.top) * (canvas.height / rect.height)

    currentStrokeRef.current.push({ x, y })

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const points = currentStrokeRef.current
    if (points.length < 2) return

    ctx.beginPath()
    ctx.moveTo(points[points.length - 2].x, points[points.length - 2].y)
    ctx.lineTo(x, y)
    ctx.strokeStyle = isEraser ? 'rgba(0,0,0,1)' : selectedColor
    ctx.lineWidth = selectedWidth
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    if (isEraser) {
      ctx.globalCompositeOperation = 'destination-out'
    } else {
      ctx.globalCompositeOperation = 'source-over'
    }
    ctx.stroke()
  }

  const handleMouseUp = () => {
    if (!isDrawingRef.current) return
    isDrawingRef.current = false
    if (currentStrokeRef.current.length > 1) {
      setStrokes((prev) => [
        ...prev,
        {
          color: selectedColor,
          width: selectedWidth,
          points: [...currentStrokeRef.current],
          isEraser
        }
      ])
    }
    currentStrokeRef.current = []
  }

  const handleUndo = () => {
    setStrokes((prev) => prev.slice(0, -1))
  }

  const handleClearAll = () => {
    setStrokes([])
  }

  const handleCopyPath = () => {
    if (artifact?.path) {
      navigator.clipboard.writeText(artifact.path)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleOpenFile = () => {
    if (artifact?.path && window.api?.openArtifactFile) {
      window.api.openArtifactFile(artifact.path)
    }
  }

  const handleOpenFolder = () => {
    if (artifact?.path && window.api?.showArtifactInFolder) {
      window.api.showArtifactInFolder(artifact.path)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="w-full h-full max-w-[96vw] max-h-[94vh] flex flex-col rounded-2xl border border-white/[0.12] bg-[#0d0e12] shadow-2xl overflow-hidden select-none">
        {/* HEADER TOOLBAR */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.08] bg-white/[0.03] shrink-0">
          {/* Left info: Icon, Title, ID */}
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-500/20 text-orange-400 border border-orange-500/30">
              <FilePpt size={20} weight="bold" />
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-text-primary tracking-wide">
                  {artifact.filename}
                </h3>
                <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  #{artifact.id}
                </span>
              </div>
              <span className="text-[11px] text-text-muted">
                PowerPoint Presentation Artifact (16:9 Widescreen)
              </span>
            </div>
          </div>

          {/* Center Tools: Pen Annotations & Zoom */}
          <div className="flex items-center gap-3 bg-black/40 px-3 py-1.5 rounded-xl border border-white/[0.08]">
            {/* Pen Toggle */}
            <button
              type="button"
              onClick={() => {
                setIsPenActive((prev) => !prev)
                setIsEraser(false)
              }}
              className={clsx(
                'flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg transition-colors cursor-pointer',
                isPenActive && !isEraser
                  ? 'bg-amber-500 text-black font-semibold shadow-md'
                  : 'text-text-muted hover:text-text-primary hover:bg-white/[0.06]'
              )}
              title="Toggle Freehand Pen Annotation"
            >
              <PencilSimple size={14} weight="bold" />
              <span>Pen Tool</span>
            </button>

            {/* Eraser */}
            <button
              type="button"
              onClick={() => {
                setIsEraser((prev) => !prev)
                setIsPenActive(true)
              }}
              className={clsx(
                'p-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer',
                isPenActive && isEraser
                  ? 'bg-amber-500 text-black font-semibold shadow-md'
                  : 'text-text-muted hover:text-text-primary hover:bg-white/[0.06]'
              )}
              title="Eraser Tool"
            >
              <Eraser size={14} weight="bold" />
            </button>

            {/* Color & Width Controls (Visible when Pen active) */}
            {isPenActive && (
              <div className="flex items-center gap-2 pl-2 border-l border-white/[0.1]">
                {/* Colors */}
                <div className="flex items-center gap-1">
                  {COLOR_PALETTE.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => {
                        setSelectedColor(c.value)
                        setIsEraser(false)
                      }}
                      className={clsx(
                        'w-4 h-4 rounded-full transition-transform cursor-pointer',
                        selectedColor === c.value && !isEraser
                          ? 'scale-125 ring-2 ring-white'
                          : 'hover:scale-110 opacity-80'
                      )}
                      style={{ backgroundColor: c.value }}
                      title={c.name}
                    />
                  ))}
                </div>

                {/* Widths */}
                <div className="flex items-center gap-1 ml-1">
                  {STROKE_WIDTHS.map((sw) => (
                    <button
                      key={sw.value}
                      type="button"
                      onClick={() => setSelectedWidth(sw.value)}
                      className={clsx(
                        'px-1.5 py-0.5 text-[10px] font-mono rounded transition-colors cursor-pointer',
                        selectedWidth === sw.value
                          ? 'bg-white/20 text-white font-bold'
                          : 'text-text-muted hover:text-text-secondary'
                      )}
                    >
                      {sw.name}
                    </button>
                  ))}
                </div>

                {/* Undo & Clear */}
                <div className="flex items-center gap-1 ml-1 pl-1 border-l border-white/[0.1]">
                  <button
                    type="button"
                    onClick={handleUndo}
                    disabled={strokes.length === 0}
                    className="p-1 rounded text-text-muted hover:text-text-primary disabled:opacity-30 cursor-pointer"
                    title="Undo stroke"
                  >
                    <ArrowUUpLeft size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={handleClearAll}
                    disabled={strokes.length === 0}
                    className="p-1 rounded text-red-400 hover:text-red-300 disabled:opacity-30 cursor-pointer"
                    title="Clear all annotations"
                  >
                    <Trash size={14} />
                  </button>
                </div>
              </div>
            )}

            {/* Separator */}
            <div className="h-4 w-px bg-white/[0.1]" />

            {/* Zoom Controls */}
            <div className="flex items-center gap-1.5 text-xs text-text-muted">
              <button
                type="button"
                onClick={() => setZoomLevel((z) => Math.max(50, z - 15))}
                className="p-1 rounded hover:bg-white/[0.08] hover:text-text-primary transition-colors cursor-pointer"
                title="Zoom Out"
              >
                <MagnifyingGlassMinus size={15} />
              </button>

              <span className="w-12 text-center font-mono text-[11px] font-medium text-text-primary">
                {zoomLevel}%
              </span>

              <button
                type="button"
                onClick={() => setZoomLevel((z) => Math.min(200, z + 15))}
                className="p-1 rounded hover:bg-white/[0.08] hover:text-text-primary transition-colors cursor-pointer"
                title="Zoom In"
              >
                <MagnifyingGlassPlus size={15} />
              </button>

              <button
                type="button"
                onClick={() => setZoomLevel(100)}
                className="p-1 rounded hover:bg-white/[0.08] hover:text-text-primary transition-colors cursor-pointer text-[10px] font-mono"
                title="Reset Zoom (100%)"
              >
                <ArrowsIn size={14} />
              </button>
            </div>
          </div>

          {/* Right Controls: View Mode & Document Actions */}
          <div className="flex items-center gap-2">
            {/* View Mode Switcher */}
            <div className="flex items-center p-0.5 rounded-lg bg-black/40 border border-white/[0.08]">
              <button
                type="button"
                onClick={() => setActiveTab('visual')}
                className={clsx(
                  'flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer',
                  activeTab === 'visual'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    : 'text-text-muted hover:text-text-primary'
                )}
              >
                <Eye size={13} />
                <span>Presentation</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('code')}
                className={clsx(
                  'flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer',
                  activeTab === 'code'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    : 'text-text-muted hover:text-text-primary'
                )}
              >
                <Code size={13} />
                <span>HTML</span>
              </button>
            </div>

            {/* Actions */}
            <button
              type="button"
              onClick={handleOpenFile}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary bg-white/[0.04] hover:bg-white/[0.08] rounded-lg transition-colors cursor-pointer border border-white/[0.06]"
              title="Open presentation in OS app"
            >
              <ArrowSquareOut size={14} />
              <span>Open Presentation</span>
            </button>
            <button
              type="button"
              onClick={handleOpenFolder}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary bg-white/[0.04] hover:bg-white/[0.08] rounded-lg transition-colors cursor-pointer border border-white/[0.06]"
              title="Show in File Explorer"
            >
              <FolderOpen size={14} />
              <span>Folder</span>
            </button>

            {/* Close Modal */}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-text-muted hover:text-text-primary rounded-lg hover:bg-white/[0.1] transition-colors cursor-pointer ml-1"
              title="Close Viewer (Esc)"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* WORKSPACE BODY */}
        <div className="flex-1 flex overflow-hidden relative bg-[#08090b]">
          {/* Sidebar Toggle & Slide Index Panel */}
          <div
            className={clsx(
              'border-r border-white/[0.08] bg-black/30 flex flex-col transition-all duration-300 shrink-0 select-none',
              isSidebarOpen ? 'w-48' : 'w-10'
            )}
          >
            <div className="p-2 border-b border-white/[0.06] flex items-center justify-between">
              {isSidebarOpen && (
                <span className="text-[11px] font-semibold text-text-muted tracking-wider uppercase pl-2">
                  Slides
                </span>
              )}
              <button
                type="button"
                onClick={() => setIsSidebarOpen((prev) => !prev)}
                className="p-1 text-text-muted hover:text-text-primary rounded hover:bg-white/[0.06] transition-colors mx-auto"
                title={isSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
              >
                <SidebarSimple size={14} />
              </button>
            </div>

            {isSidebarOpen && (
              <div className="p-2 flex flex-col gap-2 overflow-y-auto">
                <div className="flex flex-col items-center gap-1.5 p-2 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-300 cursor-pointer">
                  <div className="w-full aspect-video bg-white/90 rounded border border-white/20 shadow-md overflow-hidden flex items-center justify-center text-[10px] text-black/60 font-bold">
                    Slide Deck
                  </div>
                  <span className="text-[11px] font-medium">Slide Deck Preview</span>
                </div>
              </div>
            )}
          </div>

          {/* MAIN DOCUMENT WORKSPACE */}
          <div className="flex-1 overflow-auto flex flex-col items-center p-8 bg-[#090a0d] custom-scrollbar relative">
            {activeTab === 'visual' ? (
              <div
                className="relative transition-transform duration-200 ease-out origin-top shadow-[0_20px_50px_rgba(0,0,0,0.7)] rounded-xl overflow-hidden"
                style={{
                  transform: `scale(${zoomLevel / 100})`,
                  width: '960px',
                  minHeight: '540px'
                }}
              >
                {/* HTML Rendered Presentation Slide Deck */}
                <iframe
                  title={artifact.filename}
                  srcDoc={artifact.htmlContent}
                  className="w-[960px] min-h-[540px] border-0 bg-white"
                  style={{ width: '960px', height: '540px' }}
                />

                {/* Freehand Canvas Drawing Overlay */}
                <canvas
                  ref={canvasRef}
                  width={960}
                  height={540}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                  className={clsx(
                    'absolute inset-0 w-full h-full pointer-events-auto',
                    isPenActive ? 'cursor-crosshair' : 'pointer-events-none'
                  )}
                />
              </div>
            ) : (
              /* SOURCE CODE MODE */
              <div className="w-full max-w-4xl h-full flex flex-col rounded-xl border border-white/[0.08] bg-black/60 overflow-hidden shadow-2xl">
                <div className="flex items-center justify-between px-4 py-2 bg-white/[0.03] border-b border-white/[0.06] text-xs text-text-muted">
                  <span className="font-mono">HTML + CSS Presentation Code</span>
                  <button
                    type="button"
                    onClick={handleCopyPath}
                    className="flex items-center gap-1 text-text-muted hover:text-text-primary transition-colors cursor-pointer"
                  >
                    {copied ? <Check size={12} className="text-status-success" /> : <Copy size={12} />}
                    <span>{copied ? 'Copied Path' : 'Copy Path'}</span>
                  </button>
                </div>
                <div className="p-4 overflow-auto font-mono text-xs text-amber-300 select-all leading-relaxed flex-1">
                  <pre>{artifact.htmlContent}</pre>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* BOTTOM STATUS BAR */}
        <div className="px-5 py-2 border-t border-white/[0.08] bg-white/[0.02] flex items-center justify-between text-[11px] text-text-muted shrink-0">
          <div className="flex items-center gap-2">
            <span>16:9 Presentation Slide Layout</span>
            <span>•</span>
            <span>{isPenActive ? 'Pen Mode Active — Draw on slides' : 'Navigation Mode'}</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleCopyPath}
              className="flex items-center gap-1 hover:text-text-primary transition-colors cursor-pointer"
            >
              {copied ? <Check size={12} className="text-status-success" /> : <Copy size={12} />}
              <span>{copied ? 'Copied Path' : 'Copy File Path'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
