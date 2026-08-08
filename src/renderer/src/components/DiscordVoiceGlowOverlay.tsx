import { useEffect, useRef, useState } from 'react'
import { ToolCallIndicator } from './ActionLoader'

type ConnectionPhase = 'connecting' | 'connected' | 'exiting'
type ToolPanelPhase = 'hidden' | 'visible' | 'leaving'
type ToolStatus = 'writing' | 'running' | 'done' | 'error' | 'cancelled' | 'cooldown'

interface VoiceOverlayView {
  mounted: boolean
  connection: ConnectionPhase
  speaking: boolean
  quiet: boolean
  tool: { name: string; status: ToolStatus } | null
  toolPanel: ToolPanelPhase
}

const INITIAL_VIEW: VoiceOverlayView = {
  mounted: true,
  connection: 'connecting',
  speaking: false,
  quiet: false,
  tool: null,
  toolPanel: 'hidden'
}

const QUIET_DELAY_MS = 1250
const TOOL_EXIT_MS = 580
const OVERLAY_EXIT_MS = 980

// Perimeter geometry calculation with rounded corner inset
interface PerimeterPoint {
  x: number
  y: number
  nx: number // Inward normal X
  ny: number // Inward normal Y
  s: number  // Normalized distance along perimeter [0, 1]
}

function getPerimeterPoint(
  normS: number,
  width: number,
  height: number,
  radius: number,
  inset = 0
): PerimeterPoint {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2))
  
  // Sharp square screen corner geometry (100% flush against physical monitor borders)
  if (r <= 0) {
    const w = width - 2 * inset
    const h = height - 2 * inset
    const totalP = 2 * w + 2 * h
    let dist = ((normS % 1 + 1) % 1) * totalP

    // Top edge (Left -> Right)
    if (dist <= w) {
      return { x: inset + dist, y: inset, nx: 0, ny: 1, s: normS }
    }
    dist -= w

    // Right edge (Top -> Bottom)
    if (dist <= h) {
      return { x: width - inset, y: inset + dist, nx: -1, ny: 0, s: normS }
    }
    dist -= h

    // Bottom edge (Right -> Left)
    if (dist <= w) {
      return { x: width - inset - dist, y: height - inset, nx: 0, ny: -1, s: normS }
    }
    dist -= w

    // Left edge (Bottom -> Top)
    return { x: inset, y: height - inset - dist, nx: 1, ny: 0, s: normS }
  }

  const w = width - 2 * r - 2 * inset
  const h = height - 2 * r - 2 * inset
  const cornerArc = (Math.PI / 2) * r
  const totalP = 2 * w + 2 * h + 4 * cornerArc

  // Wrap normS to [0, 1]
  let dist = ((normS % 1 + 1) % 1) * totalP
  const x0 = inset + r
  const y0 = inset + r

  // Segment 1: Top Edge (Left -> Right)
  if (dist <= w) {
    const progress = dist / w
    return { x: x0 + progress * w, y: inset, nx: 0, ny: 1, s: normS }
  }
  dist -= w

  // Segment 2: Top-Right Corner
  if (dist <= cornerArc) {
    const angle = -Math.PI / 2 + (dist / cornerArc) * (Math.PI / 2)
    const cx = x0 + w
    const cy = y0
    const nx = -Math.cos(angle)
    const ny = -Math.sin(angle)
    return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r, nx, ny, s: normS }
  }
  dist -= cornerArc

  // Segment 3: Right Edge (Top -> Bottom)
  if (dist <= h) {
    const progress = dist / h
    return { x: inset + r + w + r, y: y0 + progress * h, nx: -1, ny: 0, s: normS }
  }
  dist -= h

  // Segment 4: Bottom-Right Corner
  if (dist <= cornerArc) {
    const angle = (dist / cornerArc) * (Math.PI / 2)
    const cx = x0 + w
    const cy = y0 + h
    const nx = -Math.cos(angle)
    const ny = -Math.sin(angle)
    return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r, nx, ny, s: normS }
  }
  dist -= cornerArc

  // Segment 5: Bottom Edge (Right -> Left)
  if (dist <= w) {
    const progress = dist / w
    return { x: x0 + w - progress * w, y: inset + r + h + r, nx: 0, ny: -1, s: normS }
  }
  dist -= w

  // Segment 6: Bottom-Left Corner
  if (dist <= cornerArc) {
    const angle = Math.PI / 2 + (dist / cornerArc) * (Math.PI / 2)
    const cx = x0
    const cy = y0 + h
    const nx = -Math.cos(angle)
    const ny = -Math.sin(angle)
    return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r, nx, ny, s: normS }
  }
  dist -= cornerArc

  // Segment 7: Left Edge (Bottom -> Top)
  if (dist <= h) {
    const progress = dist / h
    return { x: inset, y: y0 + h - progress * h, nx: 1, ny: 0, s: normS }
  }
  dist -= h

  // Segment 8: Top-Left Corner
  const angle = Math.PI + (dist / cornerArc) * (Math.PI / 2)
  const cx = x0
  const cy = y0
  const nx = -Math.cos(angle)
  const ny = -Math.sin(angle)
  return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r, nx, ny, s: normS }
}

export function DiscordVoiceGlowOverlay(): React.JSX.Element | null {
  const [view, setView] = useState<VoiceOverlayView>(INITIAL_VIEW)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const chatIdRef = useRef<string | null>(null)
  const targetLevelRef = useRef(0)
  const smoothedLevelRef = useRef(0)
  const quietTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const panelExitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const overlayExitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Physics & Animation state refs
  const timeRef = useRef(0)
  const entrySweepRef = useRef(0) // 0 to 1 entry animation progress
  const orbitOffsetRef = useRef(0) // Continuous incremental orbit offset along perimeter [0, 1]

  // Continuous smoothed parameters
  const currentParamsRef = useRef({
    thickness: 0,
    orbitSpeed: 0.05,
    turbulence: 1.0,
    opacity: 0,
    colorMode: 0 // 0: connecting, 1: idle, 2: speaking, 3: working
  })

  const clearQuietTimer = (): void => {
    if (quietTimerRef.current) {
      clearTimeout(quietTimerRef.current)
      quietTimerRef.current = null
    }
  }

  const clearPanelExitTimer = (): void => {
    if (panelExitTimerRef.current) {
      clearTimeout(panelExitTimerRef.current)
      panelExitTimerRef.current = null
    }
  }

  const clearOverlayExitTimer = (): void => {
    if (overlayExitTimerRef.current) {
      clearTimeout(overlayExitTimerRef.current)
      overlayExitTimerRef.current = null
    }
  }

  const scheduleQuietState = (): void => {
    clearQuietTimer()
    quietTimerRef.current = setTimeout(() => {
      setView((current) => {
        if (current.speaking || current.toolPanel === 'visible' || current.connection === 'exiting') {
          return current
        }
        return { ...current, quiet: true }
      })
    }, QUIET_DELAY_MS)
  }

  const dismissToolPanel = (): void => {
    clearPanelExitTimer()
    setView((current) => {
      if (current.toolPanel === 'hidden') return current
      return { ...current, toolPanel: 'leaving' }
    })
    panelExitTimerRef.current = setTimeout(() => {
      setView((current) => ({ ...current, tool: null, toolPanel: 'hidden' }))
      scheduleQuietState()
    }, TOOL_EXIT_MS)
  }

  useEffect(() => {
    window.electron.ipcRenderer.send('overlay-log', '[DiscordVoiceGlowOverlay] MOUNTED in React!')
    document.body.style.background = 'transparent'
    document.documentElement.style.background = 'transparent'

    if (!document.documentElement.getAttribute('data-theme')) {
      document.documentElement.setAttribute('data-theme', 'marine')
    }
    window.api.getConfig().then((cfg) => {
      if (cfg?.theme) {
        document.documentElement.setAttribute('data-theme', cfg.theme)
      }
    })

    const isActiveVoiceChat = (chatId: string): boolean => {
      if (!chatIdRef.current) {
        chatIdRef.current = chatId
      }
      return chatIdRef.current === chatId
    }

    const removeStateListener = window.api.onDiscordVoiceState(({ chatId, state }) => {
      window.electron.ipcRenderer.send('overlay-log', `[DiscordVoiceGlowOverlay] Received state: ${state} for chatId: ${chatId}`)
      if (state === 'connecting') {
        clearOverlayExitTimer()
        clearPanelExitTimer()
        clearQuietTimer()
        chatIdRef.current = chatId
        targetLevelRef.current = 0
        smoothedLevelRef.current = 0
        entrySweepRef.current = 0 // Reset entry sweep animation
        setView({ ...INITIAL_VIEW, mounted: true, connection: 'connecting' })
        return
      }

      if (!isActiveVoiceChat(chatId)) return

      if (state === 'connected') {
        clearOverlayExitTimer()
        setView((current) => ({ ...current, mounted: true, connection: 'connected', quiet: false }))
        scheduleQuietState()
        return
      }

      targetLevelRef.current = 0
      clearQuietTimer()
      clearOverlayExitTimer()
      setView((current) => ({
        ...current,
        connection: 'exiting',
        speaking: false,
        quiet: true,
        toolPanel: current.toolPanel === 'hidden' ? 'hidden' : 'leaving'
      }))
      panelExitTimerRef.current = setTimeout(() => {
        setView((current) => ({ ...current, tool: null, toolPanel: 'hidden' }))
      }, TOOL_EXIT_MS)
      overlayExitTimerRef.current = setTimeout(() => {
        chatIdRef.current = null
        setView(INITIAL_VIEW)
      }, OVERLAY_EXIT_MS)
    })

    const removeSpeakingListener = window.api.onDiscordVoiceSpeaking(({ chatId, speaking }) => {
      if (!isActiveVoiceChat(chatId)) return

      if (speaking) {
        clearQuietTimer()
        setView((current) => ({ ...current, speaking: true, quiet: false }))
        return
      }

      targetLevelRef.current = 0
      setView((current) => ({ ...current, speaking: false }))
      scheduleQuietState()
    })

    const removeAudioLevelListener = window.api.onDiscordVoiceAudioLevel(({ chatId, level }) => {
      if (!isActiveVoiceChat(chatId)) return
      // Only AI output voice level drives glow reactivity
      targetLevelRef.current = Math.min(1, Math.max(0, level))
    })

    const removeOutputListener = window.api.onDiscordVoiceOutput(({ chatId }) => {
      if (!isActiveVoiceChat(chatId)) return
      clearQuietTimer()
      dismissToolPanel()
      setView((current) => ({ ...current, speaking: true, quiet: false }))
    })

    const removeToolStartListener = window.api.onToolStart(({ chatId, name }) => {
      if (!isActiveVoiceChat(chatId)) return
      clearQuietTimer()
      clearPanelExitTimer()
      targetLevelRef.current = 0
      setView((current) => ({
        ...current,
        speaking: false,
        quiet: false,
        tool: { name, status: 'running' },
        toolPanel: 'visible'
      }))
    })

    const removeToolEndListener = window.api.onToolEnd(({ chatId, name }) => {
      if (!isActiveVoiceChat(chatId)) return
      setView((current) => {
        if (current.toolPanel === 'hidden') return current
        return {
          ...current,
          tool: current.tool && current.tool.name === name
            ? { name, status: 'done' }
            : current.tool
        }
      })
    })

    return () => {
      document.body.style.background = ''
      document.documentElement.style.background = ''
      removeStateListener()
      removeSpeakingListener()
      removeAudioLevelListener()
      removeOutputListener()
      removeToolStartListener()
      removeToolEndListener()
      clearQuietTimer()
      clearPanelExitTimer()
      clearOverlayExitTimer()
    }
  }, [])

  // Canvas Liquid Animation Loop
  useEffect(() => {
    if (!view.mounted) return

    let animationFrame = 0
    let lastTime = performance.now()

    const render = (now: number): void => {
      const dt = Math.min(0.064, (now - lastTime) / 1000)
      lastTime = now
      timeRef.current += dt

      const canvas = canvasRef.current
      if (!canvas) {
        animationFrame = requestAnimationFrame(render)
        return
      }

      const ctx = canvas.getContext('2d')
      if (!ctx) {
        animationFrame = requestAnimationFrame(render)
        return
      }

      const dpr = window.devicePixelRatio || 1
      const width = window.innerWidth
      const height = window.innerHeight

      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr
        canvas.height = height * dpr
      }

      ctx.save()
      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, width, height)

      // 1. Audio Energy Lerp (Fast Attack, Smooth Decay)
      const targetAudio = targetLevelRef.current
      const currentAudio = smoothedLevelRef.current
      const audioSmoothing = targetAudio > currentAudio ? 0.32 : 0.06
      smoothedLevelRef.current += (targetAudio - currentAudio) * audioSmoothing
      const audioEnergy = smoothedLevelRef.current

      // 2. State & Physics Target Calculation
      const isConnecting = view.connection === 'connecting'
      const isExiting = view.connection === 'exiting'
      const isSpeaking = view.speaking
      const isWorking = view.toolPanel === 'visible'
      const isQuiet = view.quiet

      // Update Entry Sweep animation
      if (isConnecting) {
        entrySweepRef.current = Math.min(1, entrySweepRef.current + dt * 1.1)
      } else {
        entrySweepRef.current = 1
      }

      // Maintain continuous orbit travel speed along perimeter
      const CONST_IDLE_ORBIT_SPEED = 0.05
      orbitOffsetRef.current = (orbitOffsetRef.current + dt * CONST_IDLE_ORBIT_SPEED) % 1
      const orbitOffset = orbitOffsetRef.current

      let targetThickness = 9
      let targetTurbulence = 0.4
      let targetOpacity = 0.38 // Soft, discrete, non-intrusive ambient glow in idle
      let targetColorMode = 1 // 0: connecting, 1: idle, 2: speaking, 3: working

      if (isConnecting) {
        targetThickness = 22 + Math.sin(timeRef.current * 8) * 4
        targetTurbulence = 1.3
        targetOpacity = 0.95
        targetColorMode = 0
      } else if (isExiting) {
        targetThickness = 0
        targetTurbulence = 0.2
        targetOpacity = 0
      } else if (isWorking) {
        // AI executing a tool call: high vibrant glow force
        targetThickness = 20 + Math.sin(timeRef.current * 4) * 4
        targetTurbulence = 1.4
        targetOpacity = 0.95
        targetColorMode = 3
      } else if (isSpeaking) {
        // AI speaking: audio-reactive glow force
        targetThickness = 16 + audioEnergy * 24
        targetTurbulence = 0.8 + audioEnergy * 1.4
        targetOpacity = 1.0
        targetColorMode = 2
      } else if (isQuiet) {
        targetThickness = 5
        targetTurbulence = 0.25
        targetOpacity = 0.22 // Ultra-sleek, subtle whisper glow in quiet idle
        targetColorMode = 1
      }

      // 3. Continuous Damped Parameter Smoothing (Frame-rate independent lerp)
      const damp = 1 - Math.exp(-12 * dt)
      const params = currentParamsRef.current
      params.thickness += (targetThickness - params.thickness) * damp
      params.turbulence += (targetTurbulence - params.turbulence) * damp
      params.opacity += (targetOpacity - params.opacity) * damp
      params.colorMode += (targetColorMode - params.colorMode) * damp

      if (params.opacity <= 0.005) {
        ctx.restore()
        animationFrame = requestAnimationFrame(render)
        return
      }

      // 4. Color Palette Interpolation
      // Palettes:
      // Mode 0 (Connecting): Amber Gold (#f59e0b) -> Rose Pink (#ec4899) -> Cyan (#06b6d4)
      // Mode 1 (Idle): Violet (#6366f1) -> Indigo (#818cf8) -> Sky (#38bdf8)
      // Mode 2 (Speaking): Vibrant Gemini Iris (Electric Violet #8b5cf6, Cyan #06b6d4, Magenta #ec4899, Amber #fbbf24)
      // Mode 3 (Working/Tools): Emerald Green (#10b981) -> Aqua Cyan (#06b6d4) -> Sapphire (#3b82f6)

      const getLiquidColors = (modeVal: number): string[] => {
        // Interpolate palette stops dynamically
        const m = Math.max(0, Math.min(3, modeVal))
        if (m < 1) {
          // Blend 0 -> 1
          const t = m
          return [
            colorMix('#f59e0b', '#6366f1', t),
            colorMix('#ec4899', '#818cf8', t),
            colorMix('#06b6d4', '#38bdf8', t)
          ]
        } else if (m < 2) {
          // Blend 1 -> 2
          const t = m - 1
          return [
            colorMix('#6366f1', '#8b5cf6', t),
            colorMix('#818cf8', '#06b6d4', t),
            colorMix('#38bdf8', '#ec4899', t)
          ]
        } else {
          // Blend 2 -> 3
          const t = m - 2
          return [
            colorMix('#8b5cf6', '#10b981', t),
            colorMix('#06b6d4', '#06b6d4', t),
            colorMix('#ec4899', '#3b82f6', t)
          ]
        }
      }

      const liquidColors = getLiquidColors(params.colorMode)

      // 5. Multi-Pass Ultra-Soft Feathered Liquid Glow Rendering
      const cornerRadius = 0 // Sharp square screen corners (100% flush against physical monitor borders)
      const numSamples = 180
      const sweepLimit = isConnecting ? entrySweepRef.current : 1

      // Helper function to build liquid perimeter path
      const buildLiquidPath = (thicknessVal: number, waveAmp: number): void => {
        ctx.beginPath()
        for (let i = 0; i <= numSamples; i++) {
          const normS = (i / numSamples) * sweepLimit
          const sWrapped = (normS + orbitOffset) % 1
          const pt = getPerimeterPoint(sWrapped, width, height, cornerRadius, 0)

          // Multi-frequency smooth wave displacement for liquid motion (organic, fluid, no spikes)
          const wave =
            Math.sin(sWrapped * Math.PI * 4 + timeRef.current * 2.5) * 0.6 +
            Math.sin(sWrapped * Math.PI * 8 - timeRef.current * 3.8) * 0.4

          const dInner = thicknessVal * (0.65 + wave * waveAmp * params.turbulence)
          const px = pt.x + pt.nx * dInner
          const py = pt.y + pt.ny * dInner

          if (i === 0) {
            ctx.moveTo(px, py)
          } else {
            ctx.lineTo(px, py)
          }
        }

        // Outer border path flush against screen edge (-6px overflow ensures zero corner gaps)
        for (let i = numSamples; i >= 0; i--) {
          const normS = (i / numSamples) * sweepLimit
          const sWrapped = (normS + orbitOffset) % 1
          const pt = getPerimeterPoint(sWrapped, width, height, cornerRadius, -6)
          ctx.lineTo(pt.x, pt.y)
        }

        ctx.closePath()
      }

      // Linear Gradient across viewport
      const mainGrad = ctx.createLinearGradient(0, 0, width, height)
      mainGrad.addColorStop(0, liquidColors[0])
      mainGrad.addColorStop(0.5, liquidColors[1])
      mainGrad.addColorStop(1, liquidColors[2])

      // PASS 1: Deep Soft Ambient Glow Aura (Wide Gaussian Diffusion)
      ctx.save()
      ctx.globalAlpha = params.opacity * 0.65
      ctx.filter = 'blur(26px)'
      buildLiquidPath(params.thickness * 2.2 + 16, 0.3)
      ctx.fillStyle = mainGrad
      ctx.fill()
      ctx.restore()

      // PASS 2: Middle Liquid Body (Soft Feathered Contour)
      ctx.save()
      ctx.globalAlpha = params.opacity * 0.85
      ctx.filter = 'blur(10px)'
      buildLiquidPath(params.thickness * 1.35 + 6, 0.45)
      ctx.fillStyle = mainGrad
      ctx.fill()
      ctx.restore()

      // PASS 3: High-Luminance Liquid Core (Crisp yet Soft Stream)
      ctx.save()
      ctx.globalAlpha = params.opacity * 0.95
      ctx.filter = 'blur(4px)'
      buildLiquidPath(params.thickness * 0.75 + 2, 0.55)
      ctx.fillStyle = mainGrad
      ctx.fill()
      ctx.restore()

      ctx.restore()
      animationFrame = requestAnimationFrame(render)
    }

    animationFrame = requestAnimationFrame(render)
    return () => cancelAnimationFrame(animationFrame)
  }, [view.mounted, view.connection, view.speaking, view.quiet, view.toolPanel])

  if (!view.mounted) return null

  const visualState =
    view.connection === 'connecting'
      ? 'connecting'
      : view.connection === 'exiting'
        ? 'exiting'
        : view.speaking
          ? 'speaking'
          : view.toolPanel === 'visible'
            ? 'working'
            : 'idle'

  return (
    <div
      ref={canvasRef ? undefined : null}
      className="discord-voice-glow-overlay"
      data-state={visualState}
      data-quiet={view.quiet || undefined}
      aria-hidden="true"
    >
      <canvas ref={canvasRef} className="discord-voice-canvas" />

      <div className="discord-voice-tool-shell" data-phase={view.toolPanel}>
        <div className="discord-voice-tool-panel">
          {view.tool && <ToolCallIndicator tools={[view.tool]} />}
        </div>
      </div>
    </div>
  )
}

// Color interpolation helper (Hex RGB mix)
function colorMix(hex1: string, hex2: string, weight: number): string {
  const w = Math.max(0, Math.min(1, weight))
  const c1 = parseHex(hex1)
  const c2 = parseHex(hex2)

  const r = Math.round(c1.r + (c2.r - c1.r) * w)
  const g = Math.round(c1.g + (c2.g - c1.g) * w)
  const b = Math.round(c1.b + (c2.b - c1.b) * w)

  return `rgb(${r}, ${g}, ${b})`
}

function parseHex(hex: string): { r: number; g: number; b: number } {
  let clean = hex.replace('#', '')
  if (clean.length === 3) {
    clean = clean.split('').map((c) => c + c).join('')
  }
  const num = parseInt(clean, 16)
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255
  }
}

