import React, { useState, useEffect, useRef, useCallback } from 'react'
import clsx from 'clsx'
import {
  GlobeSimple,
  Terminal,
  CaretDown,
  ArrowSquareOut
} from '@phosphor-icons/react'
import type { BrowserAction } from '../../../shared/types'

interface ScriptEntry {
  script: string
  result?: string
  timestamp: number
}

interface BrowserPaneProps {
  /** Whether the originating chat tab is currently streaming/processing */
  isAiActive: boolean
}

export const BrowserPane = React.memo(function BrowserPane({ isAiActive }: BrowserPaneProps) {
  const [screenshot, setScreenshot] = useState<string | undefined>(undefined)
  const [currentUrl, setCurrentUrl] = useState<string>('')
  const [currentTitle, setCurrentTitle] = useState<string>('')
  const [sessionClosed, setSessionClosed] = useState(false)
  const [isTerminalOpen, setIsTerminalOpen] = useState(false)
  const [scriptLogs, setScriptLogs] = useState<ScriptEntry[]>([])
  const [clickRipple, setClickRipple] = useState<{
    x: number
    y: number
    key: number
  } | null>(null)

  const terminalBottomRef = useRef<HTMLDivElement>(null)
  const rippleKeyRef = useRef(0)

  useEffect(() => {
    const removeListener = window.api.onBrowserAction((action: BrowserAction) => {
      if (action.screenshot) {
        setScreenshot(action.screenshot)
      }
      if (action.url) {
        setCurrentUrl(action.url)
      }
      if (action.title) {
        setCurrentTitle(action.title)
      }
      if (action.type === 'close') {
        setSessionClosed(true)
        return
      }
      if (action.type === 'open') {
        setSessionClosed(false)
      }
      if (action.type === 'click' && action.clickX !== undefined && action.clickY !== undefined) {
        rippleKeyRef.current += 1
        setClickRipple({ x: action.clickX, y: action.clickY, key: rippleKeyRef.current })
        setTimeout(() => setClickRipple(null), 1200)
      }
      if (action.type === 'script' && action.script) {
        setScriptLogs((prev) => [
          ...prev.slice(-49),
          {
            script: action.script!,
            result: action.scriptResult,
            timestamp: action.timestamp
          }
        ])
        setIsTerminalOpen(true)
      }
    })
    return () => removeListener()
  }, [])

  useEffect(() => {
    if (isTerminalOpen && terminalBottomRef.current) {
      terminalBottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [scriptLogs, isTerminalOpen])

  const handleOpenInSystemBrowser = useCallback(() => {
    if (currentUrl) {
      window.open(currentUrl, '_blank')
    }
  }, [currentUrl])

  return (
    <div className="relative flex flex-col h-full w-full overflow-hidden rounded-[14px] bg-[#0a0b0e] select-none">
      {isAiActive && (
        <div
          className="absolute inset-0 rounded-[14px] pointer-events-none z-30"
          style={{
            border: '1.5px solid transparent',
            backgroundClip: 'padding-box',
            boxShadow: '0 0 0 1.5px transparent'
          }}
        >
          <div
            className="absolute inset-[-1.5px] rounded-[14px]"
            style={{
              background: 'linear-gradient(var(--prism-angle, 0deg), #a855f7, #3b82f6, #06b6d4, #10b981, #f59e0b, #ef4444, #a855f7)',
              zIndex: -1,
              animation: 'prism-border-spin 2.5s linear infinite'
            }}
          />
          <div className="absolute inset-[1.5px] rounded-[13px] bg-[#0a0b0e]" />
        </div>
      )}

      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/[0.06] bg-white/[0.02] shrink-0 z-10 relative">
        <GlobeSimple size={14} className="text-text-secondary shrink-0" />
        <div className="flex-1 min-w-0">
          {currentUrl ? (
            <span className="text-[12px] text-text-secondary truncate font-mono leading-none block">
              {currentUrl}
            </span>
          ) : (
            <span className="text-[12px] text-text-secondary/40 italic">No page loaded</span>
          )}
        </div>
        {currentUrl && (
          <button
            onClick={handleOpenInSystemBrowser}
            title="Open in system browser"
            className="p-1 rounded-md text-text-secondary hover:text-text-primary hover:bg-white/[0.06] transition-all duration-150 cursor-pointer"
          >
            <ArrowSquareOut size={13} />
          </button>
        )}
        {scriptLogs.length > 0 && (
          <button
            onClick={() => setIsTerminalOpen((v) => !v)}
            title="Toggle script terminal"
            className={clsx(
              'flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-all duration-150 cursor-pointer',
              isTerminalOpen
                ? 'bg-accent-primary/20 text-accent-primary'
                : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.06]'
            )}
          >
            <Terminal size={12} />
            <span>{scriptLogs.length}</span>
            <CaretDown
              size={10}
              className={clsx('transition-transform duration-200', isTerminalOpen && 'rotate-180')}
            />
          </button>
        )}
      </div>

      {isAiActive && (
        <div className="absolute top-11 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/[0.08] bg-black/60 backdrop-blur-md shadow-lg pointer-events-none">
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0 bg-accent-primary animate-pulse"
          />
          <span className="text-[11px] font-medium text-white/80 whitespace-nowrap">
            AI is controlling this session
          </span>
        </div>
      )}

      <div className="relative flex-1 overflow-hidden">
        {screenshot ? (
          <div className="relative w-full h-full">
            <img
              src={`data:image/jpeg;base64,${screenshot}`}
              alt={currentTitle || 'Browser session'}
              className="w-full h-full object-contain object-top"
              draggable={false}
            />
            {clickRipple && (
              <div
                key={clickRipple.key}
                className="absolute pointer-events-none"
                style={{
                  left: `${clickRipple.x * 100}%`,
                  top: `${clickRipple.y * 100}%`,
                  transform: 'translate(-50%, -50%)',
                  zIndex: 10
                }}
              >
                <div
                  className="absolute rounded-full bg-accent-primary/90"
                  style={{
                    width: 10, height: 10,
                    top: '50%', left: '50%',
                    transform: 'translate(-50%, -50%)'
                  }}
                />
                <div
                  className="absolute rounded-full border-2 border-accent-primary/60"
                  style={{
                    width: 36, height: 36,
                    top: '50%', left: '50%',
                    transform: 'translate(-50%, -50%)',
                    animation: 'browser-ripple 0.9s ease-out forwards'
                  }}
                />
                <div
                  className="absolute rounded-full border border-accent-primary/30"
                  style={{
                    width: 56, height: 56,
                    top: '50%', left: '50%',
                    transform: 'translate(-50%, -50%)',
                    animation: 'browser-ripple 0.9s ease-out 0.2s forwards'
                  }}
                />
              </div>
            )}
            {isAiActive && (
              <div className="absolute inset-0 bg-transparent cursor-not-allowed z-10" />
            )}
          </div>
        ) : sessionClosed ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-text-secondary">
            <GlobeSimple size={32} className="opacity-30" />
            <span className="text-sm font-medium opacity-50">Browser session closed</span>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            {isAiActive ? (
              <div className="flex flex-col items-center gap-4">
                <GlobeSimple size={36} className="text-accent-primary/40 animate-pulse" />
                <span className="text-sm text-text-secondary/60">Opening browser...</span>
              </div>
            ) : (
              <>
                <GlobeSimple size={32} className="text-text-secondary opacity-20" />
                <span className="text-sm text-text-secondary opacity-40">Waiting for AI browser session</span>
              </>
            )}
          </div>
        )}
      </div>

      {isTerminalOpen && scriptLogs.length > 0 && (
        <div className="border-t border-white/[0.06] bg-[#080a0d] shrink-0 max-h-[200px] overflow-y-auto">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.04] sticky top-0 bg-[#080a0d] z-10">
            <Terminal size={12} className="text-accent-primary/70" />
            <span className="text-[11px] font-mono font-semibold text-accent-primary/70 uppercase tracking-wider">
              Script Log
            </span>
          </div>
          <div className="p-2 space-y-2">
            {scriptLogs.map((entry, i) => (
              <div key={i} className="rounded-md bg-white/[0.02] border border-white/[0.04] p-2 space-y-1">
                <div className="flex items-start gap-1.5">
                  <span className="text-[10px] font-mono text-accent-secondary/70 shrink-0 mt-0.5 select-none">{'>'}</span>
                  <pre className="text-[10px] font-mono text-text-primary/80 whitespace-pre-wrap break-all leading-relaxed overflow-hidden select-text">
                    {entry.script}
                  </pre>
                </div>
                {entry.result !== undefined && (
                  <div className="flex items-start gap-1.5 pl-3.5">
                    <span className="text-[10px] font-mono text-text-secondary/50 shrink-0 mt-0.5 select-none">{'<'}</span>
                    <pre className={clsx(
                      'text-[10px] font-mono whitespace-pre-wrap break-all leading-relaxed overflow-hidden select-text',
                      entry.result?.startsWith('Error') ? 'text-red-400/80' : 'text-green-400/70'
                    )}>
                      {entry.result}
                    </pre>
                  </div>
                )}
              </div>
            ))}
            <div ref={terminalBottomRef} />
          </div>
        </div>
      )}

      <style>{`
        @keyframes prism-border-spin {
          from { --prism-angle: 0deg; }
          to   { --prism-angle: 360deg; }
        }
        @keyframes browser-ripple {
          0%   { opacity: 1; transform: translate(-50%, -50%) scale(0.2); }
          100% { opacity: 0; transform: translate(-50%, -50%) scale(1.2); }
        }
      `}</style>
    </div>
  )
})
