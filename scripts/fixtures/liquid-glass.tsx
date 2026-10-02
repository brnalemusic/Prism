import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { LiquidGlassSurface } from '../../src/renderer/src/components/LiquidGlassSurface'
import { usePerformanceMode } from '../../src/renderer/src/hooks/usePerformanceMode'
import '../../src/renderer/src/assets/main.css'
import { InputBar } from '../../src/renderer/src/components/InputBar'
import { AnswerPrismPill } from '../../src/renderer/src/components/AnswerPrismPill'

// Isolated UI fixture: no provider requests, account access, or persisted user data.
Object.assign(window, {
  api: {
    getConfig: async () => ({}),
    onConfigChanged: () => () => {},
    getUserAiUsage: async () => null,
    getLicenseInfo: async () => null,
    getAuthUser: async () => null,
    getActiveModels: async () => [],
    onAuthSessionUpdated: () => () => {}
  }
})

function Fixture() {
  const { mode, setMode } = usePerformanceMode()
  const [text, setText] = useState('')
  const [real, setReal] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  return (
    <>
      <nav style={{ position: 'fixed', top: 10, zIndex: 100, background: '#050a14' }}>
        {(['max', 'auto', 'performance'] as const).map((value) => (
          <button key={value} onClick={() => setMode(value)} style={{ padding: 12 }}>
            {value}
          </button>
        ))}
        <output>{mode}</output>
        <button onClick={() => setReal(!real)}>Real InputBar</button>
        <button onClick={() => setFullscreen(!fullscreen)}>Toggle fullscreen</button>
      </nav>
      <div
        id="backdrop"
        style={{
          height: 2000,
          background:
            'repeating-linear-gradient(90deg, #10253d 0px, #10253d 15px, #d9a347 15px, #d9a347 18px, #34596c 18px, #34596c 31px)'
        }}
      >
        {Array.from({ length: 45 }, (_, i) => (
          <p key={i} style={{ padding: 10, fontSize: 26, color: '#fff' }}>
            Live text crossing the glass • {i}
          </p>
        ))}
      </div>
      {/* Playtest surface: selectable AI-message block for the Answer Prism pill. */}
      {real && (
        <div
          id="ai-messages"
          style={{ position: 'fixed', left: 24, top: 300, width: 400, fontSize: 15, color: '#fff' }}
        >
          <div data-prism-ai-message="true">
            <p style={{ padding: 8 }}>
              Playtest paragraph one for selection stability checks across multiple lines of text.
            </p>
            <p style={{ padding: 8 }}>
              Playtest paragraph two sits below paragraph one so multi-paragraph drags stay inside
              one message container, as in the real app.
            </p>
          </div>
        </div>
      )}
      {real && <AnswerPrismPill onAnswer={() => {}} />}
      {real ? (
        <div id="real-input" style={{ position: 'fixed', left: 160, top: 360, width: 640 }}>
          <InputBar
            onSend={() => {}}
            text={text}
            setText={setText}
            isSearchEnabled={false}
            setIsSearchEnabled={() => {}}
            isFullscreen={fullscreen}
            onFullscreenToggle={() => setFullscreen(!fullscreen)}
            sessionMode="conversation"
            disciplinePath=""
            selectedModel="prism_provider:prism-ai/arcadia-1-1-pro"
            onModelChange={() => {}}
          />
        </div>
      ) : (
        <div
          id="glass"
          className="true-glass glass-menu-host"
          style={{
            position: 'fixed',
            left: 160,
            top: 240,
            width: 640,
            height: 150,
            borderRadius: 28
          }}
        >
          <LiquidGlassSurface />
          <span style={{ position: 'absolute', left: 32, top: 60 }}>Message Prism</span>
        </div>
      )}
    </>
  )
}
createRoot(document.getElementById('root')!).render(<Fixture />)
