import React, { useRef, useState, useEffect } from 'react'
import {
  ArrowsClockwise as RefreshCw,
  Code,
  X,
  ArrowUpRight as ExternalLink
} from '@phosphor-icons/react'
import { Spinner } from './Spinner'
import clsx from 'clsx'

interface MiniAppProps {
  id: string
  html?: string
  css?: string
  js?: string
  title?: string
}

export const MiniAppRenderer: React.FC<MiniAppProps> = ({
  id,
  html = '',
  css = '',
  js = '',
  title = 'Mini App'
}) => {
  const [isExternal, setIsExternal] = useState(false)
  const [showCode, setShowCode] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [key, setKey] = useState(0)

  useEffect(() => {
    const removeListener = window.api.onMiniAppWindowClosed((closedId: string) => {
      if (closedId === id) {
        setIsExternal(false)
      }
    })
    return () => removeListener()
  }, [id])

  const combinedCode = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          * { box-sizing: border-box; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            margin: 0;
            padding: 24px;
            background: #0b0c0f;
            color: #e2e2e2;
            min-height: 100vh;
            overflow-x: hidden;
          }
          /* Custom Scrollbar */
          ::-webkit-scrollbar { width: 8px; height: 8px; }
          ::-webkit-scrollbar-track { background: rgba(255, 255, 255, 0.02); }
          ::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 4px; }
          ::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.15); }
          
          ${css}
        </style>
      </head>
      <body>
        ${html}
        <script>
          try {
            ${js}
          } catch (err) {
            console.error('Mini App Error:', err);
            document.body.innerHTML += '<div style="color: #ff4444; margin-top: 20px; padding: 15px; border: 1px solid rgba(255, 68, 68, 0.3); background: rgba(255, 68, 68, 0.05); border-radius: 12px; font-family: monospace; font-size: 13px; line-height: 1.5;"><strong>Mini App Error:</strong><br>' + err.message + '</div>';
          }
        </script>
      </body>
    </html>
  `

  const handleRestart = (): void => {
    setKey((prev) => prev + 1)
  }

  const handleOpenExternal = (): void => {
    setIsExternal(true)
    window.api.openMiniAppWindow({ id, title, html, css, js })
  }

  if (isExternal) {
    return (
      <div className="w-full flex flex-col items-center justify-center py-12 px-6 border border-white/5 bg-white/[0.02] rounded-[32px] mb-8 animate-in fade-in zoom-in-95 duration-500 shadow-inner">
        <div className="flex flex-col items-center gap-4 text-center">
          <Spinner size="sm" />
          <div>
            <h4 className="text-[14px] font-semibold text-text-primary/90 mb-1 tracking-tight">
              App Active in Window
            </h4>
            <p className="text-[12px] text-text-secondary/50 font-medium">
              &quot;{title}&quot; is running on a dedicated window.
            </p>
          </div>
        </div>
        <button
          onClick={() => setIsExternal(false)}
          className="mt-6 px-5 py-2 rounded-full bg-white/[0.04] hover:bg-white/[0.08] text-[11px] font-bold text-text-secondary/80 transition-all border border-white/5 uppercase tracking-wider active:scale-95"
        >
          Bring back to chat
        </button>
      </div>
    )
  }

  const isInDedicatedWindow = window.location.hash === '#mini-app'

  return (
    <div
      className={clsx(
        'relative w-full border border-white/10 bg-black/40 transition-all duration-500 shadow-2xl group animate-in fade-in slide-in-from-bottom-4 flex flex-col',
        isInDedicatedWindow
          ? 'h-screen rounded-none border-none bg-background-main'
          : 'h-[500px] mb-10 rounded-[24px] overflow-hidden'
      )}
    >
      {/* Header */}
      <div
        className={clsx(
          'flex-none flex items-center justify-between px-5 py-3.5 bg-white/[0.03] border-b border-white/10',
          isInDedicatedWindow && 'hidden' // TitleBar already exists in dedicated window
        )}
      >
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]/80 shadow-[0_0_8px_rgba(255,95,87,0.2)]" />
            <div className="w-2.5 h-2.5 rounded-full bg-[#febc2e]/80 shadow-[0_0_8px_rgba(254,188,46,0.2)]" />
            <div className="w-2.5 h-2.5 rounded-full bg-[#28c840]/80 shadow-[0_0_8px_rgba(40,200,64,0.2)]" />
          </div>
          <span className="text-[11px] font-bold text-text-secondary/80 uppercase tracking-[0.15em] ml-1">
            {title}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowCode(!showCode)}
            className={clsx(
              'p-2 rounded-xl transition-all duration-200',
              showCode
                ? 'bg-accent-primary/20 text-accent-primary'
                : 'hover:bg-white/10 text-text-secondary/70'
            )}
            title="View Code"
          >
            <Code size={16} />
          </button>
          <button
            onClick={handleRestart}
            className="p-2 rounded-xl hover:bg-white/10 text-text-secondary/70 transition-all duration-200"
            title="Restart App"
          >
            <RefreshCw size={16} />
          </button>
          <button
            onClick={handleOpenExternal}
            className="p-2 rounded-xl hover:bg-white/10 text-text-secondary/70 transition-all duration-200 ml-1"
            title="Open in Window"
          >
            <ExternalLink size={16} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div
        className={clsx(
          'relative w-full flex-1 min-h-0',
          isInDedicatedWindow ? 'mt-10' : 'h-[calc(100%-53px)]'
        )}
      >
        {showCode ? (
          <div
            className={clsx(
              'h-full overflow-y-auto bg-[#0d0d0d] p-8 font-mono text-[12px] leading-relaxed scrollbar-thin',
              isInDedicatedWindow && 'pb-32 pt-12'
            )}
          >
            <div className="mb-8 max-w-4xl mx-auto">
              <div className="text-accent-primary/90 mb-3 font-bold flex items-center gap-2 text-[13px]">
                <div className="w-1.5 h-1.5 rounded-full bg-accent-primary" />
                HTML
              </div>
              <pre className="text-text-primary/70 whitespace-pre-wrap bg-white/[0.02] p-5 rounded-2xl border border-white/5 shadow-inner">
                {html}
              </pre>
            </div>
            <div className="mb-8 max-w-4xl mx-auto">
              <div className="text-accent-secondary/90 mb-3 font-bold flex items-center gap-2 text-[13px]">
                <div className="w-1.5 h-1.5 rounded-full bg-accent-secondary" />
                CSS
              </div>
              <pre className="text-text-primary/70 whitespace-pre-wrap bg-white/[0.02] p-5 rounded-2xl border border-white/5 shadow-inner">
                {css}
              </pre>
            </div>
            <div className="max-w-4xl mx-auto">
              <div className="text-accent-primary/90 mb-3 font-bold flex items-center gap-2 text-[13px]">
                <div className="w-1.5 h-1.5 rounded-full bg-accent-primary" />
                JS
              </div>
              <pre className="text-text-primary/70 whitespace-pre-wrap bg-white/[0.02] p-5 rounded-2xl border border-white/5 shadow-inner">
                {js}
              </pre>
            </div>
          </div>
        ) : (
          <iframe
            key={key}
            ref={iframeRef}
            srcDoc={combinedCode}
            className="w-full h-full border-none bg-transparent"
            sandbox="allow-scripts allow-same-origin"
            title={title}
          />
        )}
      </div>

      {/* Floating Controls for Dedicated Window */}
      {isInDedicatedWindow && !showCode && (
        <div className="absolute bottom-6 right-6 flex items-center gap-2 animate-in fade-in slide-in-from-right-4 duration-700 delay-300">
          <button
            onClick={() => setShowCode(true)}
            className="p-3 rounded-2xl bg-black/60 hover:bg-black/80 text-white/70 backdrop-blur-xl border border-white/10 shadow-2xl transition-all hover:scale-105 active:scale-95"
            title="View Code"
          >
            <Code size={18} />
          </button>
          <button
            onClick={handleRestart}
            className="p-3 rounded-2xl bg-black/60 hover:bg-black/80 text-white/70 backdrop-blur-xl border border-white/10 shadow-2xl transition-all hover:scale-105 active:scale-95"
            title="Restart App"
          >
            <RefreshCw size={18} />
          </button>
        </div>
      )}

      {isInDedicatedWindow && showCode && (
        <button
          onClick={() => setShowCode(false)}
          className="absolute bottom-6 right-6 p-3 rounded-2xl bg-accent-primary/20 hover:bg-accent-primary/30 text-accent-primary backdrop-blur-xl border border-accent-primary/20 shadow-2xl transition-all hover:scale-105 active:scale-95 z-50"
        >
          <X size={18} />
        </button>
      )}
    </div>
  )
}
