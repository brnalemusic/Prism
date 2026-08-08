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
  mounted: false,
  connection: 'connecting',
  speaking: false,
  quiet: false,
  tool: null,
  toolPanel: 'hidden'
}

const QUIET_DELAY_MS = 1250
const TOOL_EXIT_MS = 580
const OVERLAY_EXIT_MS = 980

export function DiscordVoiceGlowOverlay(): React.JSX.Element | null {
  const [view, setView] = useState<VoiceOverlayView>(INITIAL_VIEW)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const chatIdRef = useRef<string | null>(null)
  const targetLevelRef = useRef(0)
  const smoothedLevelRef = useRef(0)
  const quietTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const panelExitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const overlayExitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
    const isActiveVoiceChat = (chatId: string): boolean => chatIdRef.current === chatId

    const removeStateListener = window.api.onDiscordVoiceState(({ chatId, state }) => {
      if (state === 'connecting') {
        clearOverlayExitTimer()
        clearPanelExitTimer()
        clearQuietTimer()
        chatIdRef.current = chatId
        targetLevelRef.current = 0
        smoothedLevelRef.current = 0
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

  useEffect(() => {
    if (!view.mounted) return

    let animationFrame = 0
    const updateEnergy = (): void => {
      const current = smoothedLevelRef.current
      const target = targetLevelRef.current
      const smoothing = target > current ? 0.16 : 0.045
      const next = current + (target - current) * smoothing
      smoothedLevelRef.current = Math.abs(next) < 0.001 ? 0 : next

      if (overlayRef.current) {
        const energy = (smoothedLevelRef.current * 0.105).toFixed(4)
        overlayRef.current.style.setProperty('--discord-voice-energy', energy)
      }

      animationFrame = requestAnimationFrame(updateEnergy)
    }

    updateEnergy()
    return () => cancelAnimationFrame(animationFrame)
  }, [view.mounted])

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
      ref={overlayRef}
      className="discord-voice-glow-overlay"
      data-state={visualState}
      data-quiet={view.quiet || undefined}
      aria-hidden="true"
    >
      <div className="discord-voice-glow discord-voice-glow--northwest" />
      <div className="discord-voice-glow discord-voice-glow--northeast" />
      <div className="discord-voice-glow discord-voice-glow--southeast" />
      <div className="discord-voice-glow discord-voice-glow--southwest" />

      <div className="discord-voice-tool-shell" data-phase={view.toolPanel}>
        <div className="discord-voice-tool-panel">
          {view.tool && <ToolCallIndicator tools={[view.tool]} />}
        </div>
      </div>
    </div>
  )
}
