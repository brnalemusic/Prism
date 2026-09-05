import { WorkTimeline } from './WorkTimeline'
import { anchorStreamingCalls, bindChatTool, buildChatTimeline, upsertChatRound, finishChatTools } from '../chatTimeline'
import type { Message, ToolCallItem } from '../types/tab'
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  Command,
  CaretRight as ChevronRight,
  Cpu,
  MagnifyingGlass as Search,
  Brain,
  PlayCircle as CirclePlay,
  Check,
  Calculator,
  FileCode,
  AppWindow,
  Sparkle as Sparkles,
  ArrowRight,
  ChatCircle as MessageSquare,
  Microphone,
  PaperPlaneRight as SendHorizontal,
  StopCircle,
  Crown
} from '@phosphor-icons/react'
import { useSpeechToText } from '../hooks/useSpeechToText'
import { MODELS } from '../constants'
import { isShortcutPressed, triggerErrorPopup } from '../utils'
import { ErrorPopup } from './ErrorPopup'
import { ApplicationInfo, FileSearchResult } from '../../../shared/types'
import { AppConfig } from '../../../main/config'
import clsx from 'clsx'
import { applyToolCallEnd, applyToolCallStart } from '../toolCallState'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { ActionLoader, ToolCallIndicator, getCustomToolLabel, isToolRowVisible } from './ActionLoader'
import { GeneratedImageCard } from './GeneratedImageCard'
import { useInactivityLabel } from '../hooks/useInactivityLabel'
import {
  StreamContext,
  StaticMarkdownComponents,
  createStreamingFadeRehypePlugin,
  useStreamStats
} from './AnimatedStreamingText'

type LauncherBadge = 'youtube' | 'search' | 'think'

function evaluateMathExpression(expr: string): string | null {
  const sanitized = expr.replace(/\s+/g, '')
  if (!/^[0-9+\-*/%^().]+$/.test(sanitized)) return null
  if (/^[0-9.]+$/.test(sanitized)) return null // ignore simple numbers
  if (/[+\-*/%^]$/.test(sanitized) || /\(\)/.test(sanitized)) return null

  try {
    const result = new Function(`return (${sanitized.replace(/\^/g, '**')})`)()
    if (typeof result === 'number' && !isNaN(result) && isFinite(result)) {
      return String(result)
    }
  } catch {
    return null
  }
  return null
}

function screenshotDataUrl(screenshot: string): string {
  return screenshot.startsWith('data:') ? screenshot : `data:image/png;base64,${screenshot}`
}

function launcherImageActivityTitle(toolCall: ToolCallItem): string {
  return getCustomToolLabel(
    toolCall.name,
    toolCall.status,
    toolCall.progressTitle ?? (toolCall.args.progressTitle as string | undefined),
    toolCall.completedTitle ?? (toolCall.args.completedTitle as string | undefined)
  )
}

interface LauncherAiMessageProps {
  msg: Message
  markdownComponents: import('react-markdown').Components
}

const LauncherAiMessage = React.memo(function LauncherAiMessage({
  msg, markdownComponents
}: LauncherAiMessageProps) {
  const inactivityLabel = useInactivityLabel(msg)
  const streamStats = useStreamStats(msg.content, !!msg.isStreaming)
  const entries = useMemo(() => buildChatTimeline(msg), [msg])
  const hasTools = entries.some((entry) => entry.kind === 'tool')
  const active = Boolean(msg.isStreaming || msg.isThinking || msg.isConnecting)
  return (
    <StreamContext.Provider value={streamStats}>
      <div className="flex flex-col w-full gap-1.5 text-sm leading-relaxed text-text-primary py-1">
        {active && msg.isThinking && <span className="thinking-shimmer-text text-[12.5px] font-medium">Thinking</span>}
        {!active && !hasTools && !!msg.thinkingDuration && (
          <span className="text-xs text-text-secondary/60">Thought for {msg.thinkingDuration} {msg.thinkingDuration === 1 ? 'second' : 'seconds'}</span>
        )}
        <WorkTimeline entries={entries} active={active} seconds={msg.workedDuration ?? msg.thinkingDuration ?? 1}
          renderEntry={(entry) => entry.kind === 'tool'
            ? isToolRowVisible(entry.tool.status, entry.tool, !!msg.isStreaming)
              ? entry.tool.name === 'generate_image'
                ? <GeneratedImageCard toolCall={entry.tool} activityTitle={launcherImageActivityTitle(entry.tool)} />
                : (['writing', 'running', 'cooldown'].includes(entry.tool.status) || ['open_browser', 'browser_close', 'close_browser'].includes(entry.tool.name))
                  ? <ToolCallIndicator tools={[entry.tool]} />
                  : <ActionLoader toolCall={entry.tool} /> : null
            : <div className="prose prose-invert max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}
                  rehypePlugins={[createStreamingFadeRehypePlugin(streamStats, entry.textOffset)]}
                  components={markdownComponents}>{entry.content}</ReactMarkdown>
              </div>} />
        {msg.isError && <p role="status" className="text-status-error">{msg.content}</p>}
        {active && !hasTools && !msg.content && !inactivityLabel && (
          <div className="h-2.5 w-2.5 rounded-full bg-accent-primary animate-breathe" />
        )}
        {active && !hasTools && inactivityLabel && <ToolCallIndicator overrideLabel={inactivityLabel} isItalic />}
      </div>
    </StreamContext.Provider>
  )
})

export function QuickLauncher(): React.JSX.Element {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [query, setQuery] = useState('')
  const markdownComponents = useMemo(() => StaticMarkdownComponents, [])
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false)
  const [isSearchEnabled, setIsSearchEnabled] = useState(false)
  const [isYoutubeMode, setIsYoutubeMode] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [activeModelId, setActiveModelId] = useState('')
  const [shortcut, setShortcut] = useState('CommandOrControl+M')
  const [isFocused, setIsFocused] = useState(false)
  const [quickLauncherMode, setQuickLauncherMode] = useState<'simple' | 'advanced'>('simple')
  const inputRef = useRef<HTMLInputElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const launcherScrollRef = useRef<HTMLDivElement>(null)
  const shouldFollowLauncherRef = useRef(true)
  const [attachedScreenshot, setAttachedScreenshot] = useState<string | null>(null)
  const [glowState, setGlowState] = useState<'idle' | 'processing' | 'glow-master'>('idle')
  const [launcherOpacity, setLauncherOpacity] = useState(1)
  const [isEnterprise, setIsEnterprise] = useState(false)

  const checkEnterpriseStatus = useCallback(async () => {
    try {
      const [usage, license, user] = await Promise.all([
        window.api.getUserAiUsage().catch(() => null),
        window.api.getLicenseInfo ? window.api.getLicenseInfo().catch(() => null) : Promise.resolve(null),
        window.api.getAuthUser ? window.api.getAuthUser().catch(() => null) : Promise.resolve(null)
      ])

      const isUsageEnt =
        usage?.tier?.toLowerCase().startsWith('enterprise') ||
        usage?.tier?.toLowerCase() === 'company' ||
        Boolean(
          usage?.modelList?.some(
            (m) =>
              m.tier?.toLowerCase().startsWith('enterprise') ||
              m.tier?.toLowerCase() === 'company'
          )
        )

      const isLicenseEnt = Boolean(
        license?.isActivated &&
          (license?.type?.toUpperCase() === 'ENTERPRISE' ||
            license?.type?.toUpperCase() === 'COMPANY')
      )

      const isUserEnt =
        user?.accountType?.toLowerCase() === 'enterprise' ||
        user?.accountType?.toLowerCase() === 'company'

      setIsEnterprise(isUsageEnt || isLicenseEnt || isUserEnt)
    } catch {
      setIsEnterprise(false)
    }
  }, [])

  useEffect(() => {
    checkEnterpriseStatus()
    const unsubscribeAuth = window.api.onAuthSessionUpdated?.(() => {
      checkEnterpriseStatus()
    })
    return () => {
      unsubscribeAuth?.()
    }
  }, [checkEnterpriseStatus])

  // Local Apps & Files Suggestions
  const [apps, setApps] = useState<ApplicationInfo[]>([])
  const [appIcons, setAppIcons] = useState<Record<string, string>>({})
  const [files, setFiles] = useState<FileSearchResult[]>([])
  const [mathResult, setMathResult] = useState<string | null>(null)

  // Mini-Chat Overlay State
  const [isMiniChatOpen, setIsMiniChatOpen] = useState(false)
  const [launcherMessages, setLauncherMessages] = useState<Message[]>([])

  const queryRef = useRef(query)
  useEffect(() => {
    queryRef.current = query
  }, [query])

  const { isRecording, isTranscribing, toggleRecording, stopRecording } = useSpeechToText(
    (transcription, action) => {
      const newQuery = queryRef.current.trim()
        ? queryRef.current + ' ' + transcription
        : transcription
      setQuery(newQuery)

      if (action === 'send') {
        submitMessage(newQuery)
      }

      setTimeout(() => inputRef.current?.focus(), 100)
    }
  )

  const activeMode = isYoutubeMode ? 'youtube' : isSearchEnabled ? 'search' : 'default'
  const activeBadges: LauncherBadge[] = [
    ...(isYoutubeMode ? (['youtube'] as const) : []),
    ...(isSearchEnabled ? (['search'] as const) : [])
  ]
  const activeModel = MODELS.find((m) => m.id === activeModelId) || MODELS[0]

  // Local Application Search Matches
  const filteredApps = useMemo(() => {
    if (query.trim().length <= 1) return []
    return apps.filter((app) => app.name.toLowerCase().includes(query.toLowerCase())).slice(0, 3)
  }, [query, apps])

  interface UnifiedSuggestion {
    type: 'math' | 'app' | 'file'
    value: string
    label: string
    desc: string
    icon?: string | null
  }

  // Unified Suggestions list for keyboard navigation
  const unifiedSuggestions = useMemo(() => {
    const list: UnifiedSuggestion[] = []

    if (mathResult) {
      list.push({
        type: 'math',
        value: mathResult,
        label: `Result: ${mathResult}`,
        desc: 'Copy result'
      })
    }

    if (query.trim().length > 1) {
      filteredApps.forEach((app) => {
        list.push({
          type: 'app',
          value: app.path,
          label: app.name,
          desc: 'Open Application',
          icon: appIcons[app.path] || null
        })
      })
      files.forEach((file) => {
        list.push({ type: 'file', value: file.path, label: file.name, desc: file.relativePath })
      })
    }

    return list
  }, [mathResult, filteredApps, files, query, appIcons])

  // Debounced/Triggered workspace file search
  useEffect(() => {
    if (quickLauncherMode === 'simple' && query.trim().length > 1 && !query.startsWith('/')) {
      const delay = setTimeout(() => {
        window.api.launcherSearchFiles(query).then((res) => {
          setFiles(res || [])
        })
      }, 150)
      return () => clearTimeout(delay)
    } else {
      setTimeout(() => setFiles([]), 0)
      return undefined
    }
  }, [query, quickLauncherMode])

  // Load icons for filtered apps on demand
  useEffect(() => {
    filteredApps.forEach((app) => {
      setAppIcons((prev) => {
        if (prev[app.path]) return prev
        window.api.launcherGetAppIcon(app.path).then((iconData) => {
          if (iconData) {
            setAppIcons((current) => ({ ...current, [app.path]: iconData }))
          }
        })
        return prev
      })
    })
  }, [filteredApps])

  // Math Evaluator Trigger
  useEffect(() => {
    if (query.trim().length > 1 && !query.startsWith('/')) {
      setTimeout(() => setMathResult(evaluateMathExpression(query)), 0)
    } else {
      setTimeout(() => setMathResult(null), 0)
    }
  }, [query])

  // Fetch configs and apps list
  useEffect(() => {
    window.api.getConfig().then((cfg) => {
      setConfig(cfg)
      if (cfg.theme) {
        document.documentElement.setAttribute('data-theme', cfg.theme)
      }
      if (cfg.modelSelectionShortcut) {
        setShortcut(cfg.modelSelectionShortcut)
      }
      const activeModel = cfg.quickLauncherModel || cfg.lastSelectedChatModel
      if (activeModel) {
        setActiveModelId(activeModel)
      }
      if (cfg.quickLauncherMode) {
        setQuickLauncherMode(cfg.quickLauncherMode)
      }
    })

    window.api.launcherGetApps().then((res) => {
      setApps(res || [])
    })

    const removeAppsUpdatedListener = window.api.onAppsUpdated((updatedApps) => {
      setApps(updatedApps || [])
    })

    const removeConfigListener = window.api.onConfigChanged((cfg) => {
      setConfig(cfg)
      if (cfg.theme) {
        document.documentElement.setAttribute('data-theme', cfg.theme)
      }
      if (cfg.modelSelectionShortcut) {
        setShortcut(cfg.modelSelectionShortcut)
      }
      const updatedModel = cfg.quickLauncherModel || cfg.lastSelectedChatModel
      if (updatedModel) {
        setActiveModelId(updatedModel)
      }
      if (cfg.quickLauncherMode) {
        setQuickLauncherMode(cfg.quickLauncherMode)
      }
    })

    const removeModelListener = window.api.onModelChanged((modelId) => {
      setActiveModelId(modelId)
    })

    const removeSearchEnabledListener = window.api.onSearchEnabledChanged((val) => {
      setIsSearchEnabled(val)
    })

    return () => {
      removeConfigListener()
      removeModelListener()
      removeSearchEnabledListener()
      removeAppsUpdatedListener()
    }
  }, [])

  useEffect(() => {
    const removeTriggerListener = window.api.onScreenshotShortcutTriggered(() => {
      setGlowState('processing')
      setLauncherOpacity(0)
      setIsMiniChatOpen(false)
      setAttachedScreenshot(null)
    })

    const removeScreenshotListener = window.api.onScreenshotCaptured((base64Image) => {
      setIsMiniChatOpen(false)
      setAttachedScreenshot(base64Image)

      // Wait 0.1s after capture, then trigger Glow Master (flash + disintegration in 1s CSS animation)
      setTimeout(() => {
        setGlowState('glow-master')
        setLauncherOpacity(1)

        // CSS animation lasts exactly 1s, then clean up
        setTimeout(() => {
          setGlowState('idle')
        }, 1000)
      }, 100)
    })

    return () => {
      removeTriggerListener()
      removeScreenshotListener()
    }
  }, [])

  // Focus trigger and reset chat history on hide
  useEffect(() => {
    const handleInitialFocus = (): void => {
      const focusInput = (): void => {
        if (inputRef.current) {
          inputRef.current.focus()
          const len = inputRef.current.value.length
          inputRef.current.setSelectionRange(len, len)
        }
      }
      focusInput()
      setTimeout(focusInput, 10)
      setTimeout(focusInput, 50)
      setTimeout(focusInput, 150)
      setTimeout(focusInput, 300)
    }

    handleInitialFocus()
    const removeFocusListener = window.api.onLauncherFocus(() => {
      handleInitialFocus()
      setQuery('')
      setIsYoutubeMode(false)
      // Re-fetch applications list in case it wasn't ready at startup
      window.api.launcherGetApps().then((res) => {
        setApps(res || [])
      })
    })

    const handleWindowFocus = (): void => {
      handleInitialFocus()
    }

    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') {
        handleInitialFocus()
      }
    }

    window.addEventListener('focus', handleWindowFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      removeFocusListener()
      window.removeEventListener('focus', handleWindowFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  // Only follow the mini-chat stream while the user is already at its bottom.
  useEffect(() => {
    const el = launcherScrollRef.current
    if (!el) return

    const handleScroll = (): void => {
      const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      shouldFollowLauncherRef.current = distanceToBottom <= 24
    }

    const handleWorkToggle = (): void => { shouldFollowLauncherRef.current = false }
    el.addEventListener('prism-work-toggle', handleWorkToggle)
    el.addEventListener('scroll', handleScroll, { passive: true })
    handleScroll()
    return () => {
      el.removeEventListener('scroll', handleScroll)
      el.removeEventListener('prism-work-toggle', handleWorkToggle)
    }
  }, [isMiniChatOpen])

  useEffect(() => {
    const el = launcherScrollRef.current
    if (el && shouldFollowLauncherRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    }
  }, [launcherMessages])

  // Preload IPC response listeners for Mini-Chat
  useEffect(() => {
    const removeReplyStart = window.api.onLauncherReplyStart(() => {
      setIsMiniChatOpen(true)
      setLauncherMessages((prev) => [
        ...prev,
        {
          role: 'ai',
          content: '',
          thoughts: '',
          isStreaming: true,
          isThinking: false,
          isConnecting: true,
          toolCalls: [],
          workStartTime: Date.now()
        }
      ])
    })

    const removeReplyChunk = window.api.onLauncherReplyChunk((data) => {
      setLauncherMessages((prev) => {
        if (prev.length === 0) return prev
        const newMsgs = [...prev]
        const lastMsg = { ...newMsgs[newMsgs.length - 1] }
        if (lastMsg.role === 'ai') {
          lastMsg.content = data.finalResponse || ''
          lastMsg.thoughts = data.thoughts || ''
          lastMsg.isThinking = data.isThinking
          lastMsg.isConnecting = false
          lastMsg.isWritingToolCall = data.isWritingToolCall
          lastMsg.toolType = data.toolType
          const round = data.round ?? lastMsg.chatRounds?.at(-1)?.round ?? 1
          const roundContent = data.roundContent ?? data.finalResponse ?? ''
          lastMsg.chatRounds = upsertChatRound(lastMsg.chatRounds, round, roundContent)
          lastMsg.streamingToolCalls = anchorStreamingCalls(lastMsg.streamingToolCalls,
            data.streamingToolCalls ?? [], round, roundContent).filter((call) =>
              !call.id || !lastMsg.toolCalls?.some((tool) => tool.id === call.id))
        }
        newMsgs[newMsgs.length - 1] = lastMsg
        return newMsgs
      })
    })

    const removeReplyEnd = window.api.onLauncherReplyEnd((data) => {
      setLauncherMessages((prev) => {
        if (prev.length === 0) return prev
        const newMsgs = [...prev]
        const lastMsg = { ...newMsgs[newMsgs.length - 1] }
        if (lastMsg.role === 'ai') {
          lastMsg.content = data.finalResponse || lastMsg.content || ''
          lastMsg.chatRounds = upsertChatRound(lastMsg.chatRounds,
            data.round ?? lastMsg.chatRounds?.at(-1)?.round ?? 1, data.roundContent)
          lastMsg.workedDuration = data.workedDuration ?? Math.max(1, Math.round((Date.now() - (lastMsg.workStartTime ?? Date.now())) / 1000))
          lastMsg.thoughts = data.thoughts || lastMsg.thoughts || ''
          lastMsg.isStreaming = false
          lastMsg.isThinking = false
          lastMsg.isConnecting = false
          lastMsg.isWritingToolCall = false
          lastMsg.toolCalls = finishChatTools(lastMsg, 'cancelled')
          lastMsg.streamingToolCalls = undefined
        }
        newMsgs[newMsgs.length - 1] = lastMsg
        return newMsgs
      })
    })

    const removeReplyError = window.api.onLauncherReplyError((data) => {
      const isCancel = data.error.includes('cancelled')
      if (!isCancel) {
        triggerErrorPopup(data.error)
      }
      setLauncherMessages((prev) => {
        if (prev.length === 0) return prev
        const newMsgs = [...prev]
        const lastMsg = { ...newMsgs[newMsgs.length - 1] }
        if (lastMsg.role === 'ai') {
          lastMsg.chatRounds ??= [{ round: 1, content: lastMsg.content }]
          lastMsg.content = data.error
          lastMsg.isError = true
          lastMsg.isConnecting = false
          lastMsg.toolCalls = finishChatTools(lastMsg, isCancel ? 'cancelled' : 'error')
          lastMsg.streamingToolCalls = undefined
          lastMsg.isWritingToolCall = false
          lastMsg.workedDuration = Math.max(1, Math.round((Date.now() - (lastMsg.workStartTime ?? Date.now())) / 1000))
          lastMsg.isStreaming = false
          lastMsg.isThinking = false
          lastMsg.isWritingToolCall = false
        }
        newMsgs[newMsgs.length - 1] = lastMsg
        return newMsgs
      })
    })

    const removeToolStart = window.api.onLauncherToolStart((data) => {
      setLauncherMessages((prev) => {
        if (prev.length === 0) return prev
        const newMsgs = [...prev]
        const lastMsg = { ...newMsgs[newMsgs.length - 1] }
        if (lastMsg.role === 'ai') {
          lastMsg.toolCalls = applyToolCallStart(lastMsg.toolCalls || [], data)
          bindChatTool(lastMsg, data.callId, data.name, data.round)
        }
        newMsgs[newMsgs.length - 1] = lastMsg
        return newMsgs
      })
    })

    const removeToolEnd = window.api.onLauncherToolEnd((data) => {
      setLauncherMessages((prev) => {
        if (prev.length === 0) return prev
        const newMsgs = [...prev]
        const lastMsg = { ...newMsgs[newMsgs.length - 1] }
        if (lastMsg.role === 'ai') {
          lastMsg.toolCalls = applyToolCallEnd(lastMsg.toolCalls ?? [], data)
          bindChatTool(lastMsg, data.callId, data.name, data.round)
        }
        newMsgs[newMsgs.length - 1] = lastMsg
        return newMsgs
      })
    })

    return () => {
      removeReplyStart()
      removeReplyChunk()
      removeReplyEnd()
      removeReplyError()
      removeToolStart()
      removeToolEnd()
    }
  }, [])

  const handleSuggestionAction = useCallback((item: UnifiedSuggestion): void => {
    if (item.type === 'math') {
      navigator.clipboard.writeText(item.value)
      setQuery(item.value)
    } else if (item.type === 'app') {
      window.api.launcherOpenApp(item.value)
      window.api.hideLauncher()
    } else if (item.type === 'file') {
      window.api.launcherOpenFile(item.value)
      window.api.hideLauncher()
    }
    setSelectedIndex(0)
  }, [])

  // Suggestions Navigation and Shortcuts
  useEffect(() => {
    document.body.style.background = 'transparent'
    document.documentElement.style.background = 'transparent'

    const handleKeyDown = (e: KeyboardEvent): void => {
      // Prevent model select shortcut in simple mode
      if (quickLauncherMode === 'advanced' && isShortcutPressed(e, shortcut)) {
        e.preventDefault()
        setIsModelSelectorOpen((prev) => !prev)
        setSelectedIndex(
          Math.max(
            0,
            MODELS.findIndex((m) => m.id === activeModelId)
          )
        )
        return
      }

      const dictationKey = config?.dictationShortcut || 'CommandOrControl+D'
      const webSearchKey = config?.webSearchShortcut || 'CommandOrControl+S'
      const youtubeModeKey = config?.youtubeModeShortcut || 'CommandOrControl+Y'

      // Dictation shortcut
      if (isShortcutPressed(e, dictationKey)) {
        e.preventDefault()
        toggleRecording()
        return
      }

      if (isShortcutPressed(e, webSearchKey)) {
        e.preventDefault()
        window.api.setSearchEnabled(!isSearchEnabled)
        return
      }

      if (isShortcutPressed(e, youtubeModeKey)) {
        e.preventDefault()
        window.api.setSearchEnabled(false)
        setIsYoutubeMode(!isYoutubeMode)
        return
      }

      // Suggestions navigation
      if (unifiedSuggestions.length > 0 && !isMiniChatOpen) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setSelectedIndex((prev) => (prev + 1) % unifiedSuggestions.length)
          return
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          setSelectedIndex(
            (prev) => (prev - 1 + unifiedSuggestions.length) % unifiedSuggestions.length
          )
          return
        } else if (e.key === 'Enter') {
          e.preventDefault()
          const item = unifiedSuggestions[selectedIndex]
          handleSuggestionAction(item)
          return
        }
      }

      // Model selector keyboard nav
      if (isModelSelectorOpen && quickLauncherMode === 'advanced') {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setSelectedIndex((prev) => (prev + 1) % MODELS.length)
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          setSelectedIndex((prev) => (prev - 1 + MODELS.length) % MODELS.length)
        } else if (e.key === 'Enter') {
          e.preventDefault()
          const selectedModel = MODELS[selectedIndex]
          setActiveModelId(selectedModel.id)
          window.api.setModel(selectedModel.id)
          setIsModelSelectorOpen(false)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          setIsModelSelectorOpen(false)
        }
        return
      }

      if (e.key === 'Escape') {
        window.api.hideLauncher()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.api.removeLauncherListeners()
      window.removeEventListener('keydown', handleKeyDown)
      document.body.style.background = ''
      document.documentElement.style.background = ''
    }
  }, [
    isModelSelectorOpen,
    selectedIndex,
    activeModelId,
    shortcut,
    query,
    isYoutubeMode,
    unifiedSuggestions,
    isSearchEnabled,
    quickLauncherMode,
    isMiniChatOpen,
    handleSuggestionAction,
    isRecording,
    config
  ])

  const buildMessage = (targetQuery: string): string => {
    const trimmed = targetQuery.trim()
    return isSearchEnabled ? `[FORCE_SEARCH] ${trimmed}` : trimmed
  }

  const submitMessage = (targetQuery: string): void => {
    if (!targetQuery.trim() && !attachedScreenshot) return

    if (quickLauncherMode === 'advanced') {
      // Focus in-app directly
      window.api.submitLauncher({
        message: buildMessage(targetQuery),
        screenshot: attachedScreenshot || undefined,
        appMode: isYoutubeMode ? 'youtube' : undefined
      })
      setQuery('')
      setAttachedScreenshot(null)
      setIsYoutubeMode(false)
    } else {
      // Simple mode: chat inline
      setIsMiniChatOpen(true)
      const userMsg = buildMessage(targetQuery)
      setLauncherMessages((prev) => [
        ...prev,
        { role: 'user', content: targetQuery, screenshot: attachedScreenshot || undefined }
      ])
      setQuery('')
      window.api.sendLauncherChatMessage({
        message: userMsg,
        screenshot: attachedScreenshot || undefined,
        appMode: isYoutubeMode ? 'youtube' : undefined
      })
      setAttachedScreenshot(null)
      setIsYoutubeMode(false)
    }
  }

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    submitMessage(query)
  }

  const modeClasses = {
    youtube: 'border-accent-primary/30 bg-accent-primary/[0.055] text-accent-primary',
    search: 'border-accent-secondary/30 bg-accent-secondary/[0.055] text-accent-secondary',
    default: 'border-white/[0.09] bg-white/[0.045] text-text-primary'
  }[activeMode]

  return (
    <div
      className="quick-launcher-overlay flex h-screen w-screen flex-col items-center justify-start p-8 pt-[20vh] font-sans relative overflow-hidden"
      onClick={() => window.api.hideLauncher()}
    >
      {/* Magical live moving border and diagonal glows */}
      {glowState !== 'idle' && (
        <>
          <div
            className={clsx('magic-border-glow top', glowState === 'glow-master' && 'glow-master')}
          />
          <div
            className={clsx(
              'magic-border-glow bottom',
              glowState === 'glow-master' && 'glow-master'
            )}
          />
          <div
            className={clsx('magic-border-glow left', glowState === 'glow-master' && 'glow-master')}
          />
          <div
            className={clsx(
              'magic-border-glow right',
              glowState === 'glow-master' && 'glow-master'
            )}
          />

          <div
            className={clsx(
              'magic-diagonal-glow top-left',
              glowState === 'glow-master' && 'glow-master'
            )}
          />
          <div
            className={clsx(
              'magic-diagonal-glow top-right',
              glowState === 'glow-master' && 'glow-master'
            )}
          />
          <div
            className={clsx(
              'magic-diagonal-glow bottom-left',
              glowState === 'glow-master' && 'glow-master'
            )}
          />
          <div
            className={clsx(
              'magic-diagonal-glow bottom-right',
              glowState === 'glow-master' && 'glow-master'
            )}
          />
        </>
      )}

      <div
        className="relative w-full max-w-[720px]"
        onClick={(e) => e.stopPropagation()}
        style={{
          opacity: launcherOpacity,
          transition: 'opacity 1s cubic-bezier(0.25, 1, 0.5, 1)',
          pointerEvents: launcherOpacity === 0 ? 'none' : 'auto'
        }}
      >
        {/* Badges Bar */}
        <div
          className={clsx(
            'absolute -top-12 left-1/2 z-40 flex -translate-x-1/2 items-center justify-center gap-2 transition-all duration-200',
            activeBadges.length === 0
              ? 'pointer-events-none translate-y-2 opacity-0'
              : 'translate-y-0 opacity-100'
          )}
        >
          {activeBadges.map((badge) => (
            <span
              key={badge}
              className={clsx(
                'flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold whitespace-nowrap',
                badge === 'youtube'
                  ? 'border-accent-primary/30 bg-[#251414] text-accent-primary'
                  : 'border-accent-secondary/30 bg-[#10221c] text-accent-secondary'
              )}
            >
              {badge === 'youtube' ? (
                <CirclePlay size={13} />
              ) : badge === 'search' ? (
                <Search size={13} />
              ) : (
                <Brain size={13} />
              )}
              {badge === 'youtube'
                ? 'Video search active'
                : badge === 'search'
                  ? 'Search enabled'
                  : 'Thinking enabled'}
            </span>
          ))}
        </div>

        {/* Model Menu Selector (Advanced Mode Only) */}
        {quickLauncherMode === 'advanced' && (
          <div
            className={clsx(
              'model-menu-panel absolute left-0 top-full z-50 mt-3 w-80 origin-top overflow-hidden rounded-xl py-2 transition-all duration-200',
              isModelSelectorOpen
                ? 'translate-y-0 scale-100 opacity-100'
                : 'pointer-events-none -translate-y-2 scale-[0.98] opacity-0'
            )}
          >
            <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3 text-xs font-semibold text-text-secondary/70">
              <Cpu size={14} className="text-accent-primary" />
              Prism engines
            </div>
            {MODELS.map((model, index) => {
              const isArcadia11 =
                model.id === 'prism-ai/arcadia-1.1-flash' || model.id === 'arcadia-1.1-flash'
              const isLocked = isArcadia11 && !isEnterprise

              return (
                <button
                  key={model.id}
                  onMouseEnter={() => setSelectedIndex(index)}
                  onClick={() => {
                    if (isLocked) {
                      setIsModelSelectorOpen(false)
                      void window.api.openExternalUrl('https://prismagent.vercel.app/pricing')
                      return
                    }
                    setActiveModelId(model.id)
                    window.api.setModel(model.id)
                    setIsModelSelectorOpen(false)
                  }}
                  className={clsx(
                    'relative flex w-full items-start gap-3 px-4 py-3 text-left transition-all duration-200 cursor-pointer',
                    model.id === 'prism-5'
                      ? [
                          'prism-5-model-option prism-5-menu-option',
                          selectedIndex === index && 'prism-5-model-option-active'
                        ]
                      : selectedIndex === index
                        ? 'bg-[#1c1d24]'
                        : 'hover:bg-[#15161c]'
                  )}
                >
                  <span
                    className={clsx(
                      'mt-1 h-2.5 w-2.5 shrink-0 rounded-full',
                      model.id === 'prism-5'
                        ? ['prism-5-dot', activeModelId === model.id ? 'opacity-100' : 'opacity-70']
                        : isLocked
                          ? 'bg-yellow-500'
                          : activeModelId === model.id
                            ? 'bg-accent-secondary'
                            : 'bg-white/[0.18]'
                    )}
                  />
                  <span className="min-w-0 flex-1 flex items-center justify-between gap-2">
                    <span
                      className={clsx(
                        'block text-sm font-semibold truncate',
                        model.id === 'prism-5' ? 'prism-5-title-gradient' : 'text-text-primary'
                      )}
                    >
                      {model.name}
                    </span>
                    {isLocked && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-yellow-500/15 text-yellow-400 border border-yellow-500/30 flex items-center gap-1 shrink-0">
                        <Crown size={10} weight="fill" />
                        <span>Enterprise</span>
                      </span>
                    )}
                  </span>
                  {activeModelId === model.id && (
                    <Check size={15} className="mt-0.5 text-accent-secondary" />
                  )}
                </button>
              )
            })}
          </div>
        )}

        {/* Input Bar */}
        <div className="relative w-full">
          <div
            className={clsx(
              'relative flex w-full flex-col gap-3 overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-[var(--surface-lowest)] px-5 py-3 transition-all duration-300 input-border-glow quick-launcher-input-bar shadow-[0_18px_48px_rgba(0,0,0,0.5)]',
              modeClasses,
              ((isModelSelectorOpen && quickLauncherMode === 'advanced') || isFocused) &&
                'prism-glow active'
            )}
          >
            {attachedScreenshot && (
              <div className="relative flex items-center justify-start self-start bg-white/[0.03] border border-white/[0.08] p-1.5 rounded-xl pr-8 animate-soft-pop group/thumb">
                <img
                  src={screenshotDataUrl(attachedScreenshot)}
                  alt="Screenshot preview"
                  className="h-14 w-auto rounded-lg object-cover shadow-md border border-white/10"
                />
                <button
                  type="button"
                  onClick={() => setAttachedScreenshot(null)}
                  className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-text-secondary hover:text-white transition-colors text-xs font-bold leading-none cursor-pointer"
                >
                  &times;
                </button>
              </div>
            )}

            <div className="flex w-full items-center gap-4">
              {activeMode !== 'default' && (
                <div className="pointer-events-none absolute inset-x-6 top-0 h-px overflow-hidden">
                  <div
                    className={clsx(
                      'h-px w-full animate-[line-sweep_1600ms_cubic-bezier(0.2,0.82,0.2,1)_infinite] opacity-80',
                      'bg-gradient-to-r from-transparent via-current to-transparent'
                    )}
                  />
                </div>
              )}

              {/* Model selector toggle or simple mode indicator */}
              {quickLauncherMode === 'advanced' ? (
                <button
                  onClick={() => {
                    setIsModelSelectorOpen(!isModelSelectorOpen)
                    setSelectedIndex(
                      Math.max(
                        0,
                        MODELS.findIndex((m) => m.id === activeModelId)
                      )
                    )
                  }}
                  className={clsx(
                    'flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--surface)] px-3 text-xs font-semibold text-text-secondary transition-colors duration-200 hover:border-[var(--border-strong)] hover:bg-[var(--surface-raised)] hover:text-text-primary cursor-pointer',
                    isModelSelectorOpen &&
                      'bg-accent-primary/10 text-accent-primary border-accent-primary/20'
                  )}
                >
                  <Command size={14} weight="bold" />
                  <span
                    className={
                      activeModel.id === 'prism-5' ? 'prism-top-gradient' : 'text-text-primary'
                    }
                  >
                    {activeModel.name.replace('Prism ', '')}
                  </span>
                  <ChevronRight
                    size={14}
                    weight="bold"
                    className={clsx(
                      'transition-transform duration-200',
                      isModelSelectorOpen && 'rotate-90'
                    )}
                  />
                </button>
              ) : (
                <div className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--surface)] px-3 text-xs font-semibold text-text-secondary select-none">
                  <Sparkles
                    size={14}
                    weight="bold"
                    className="text-accent-secondary animate-pulse"
                  />
                  <span>Prism 6</span>
                </div>
              )}

              {/* Input field */}
              <form onSubmit={handleSubmit} className="relative z-10 flex-1">
                <input
                  ref={inputRef}
                  type="text"
                  autoFocus
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value)
                    setSelectedIndex(0)
                  }}
                  onFocus={() => setIsFocused(true)}
                  onBlur={() => setIsFocused(false)}
                  placeholder={
                    isModelSelectorOpen
                      ? 'Select a Prism model'
                      : isYoutubeMode
                        ? 'Search and play videos'
                        : isSearchEnabled
                          ? 'Search the web'
                          : quickLauncherMode === 'simple'
                            ? 'Ask quick AI or search files/apps...'
                            : 'What should Prism do?'
                  }
                  className={clsx(
                    'w-full border-none bg-transparent text-[19px] font-medium outline-none transition-colors duration-200 placeholder:text-text-muted',
                    activeMode === 'youtube'
                      ? 'text-accent-primary placeholder:text-accent-primary/40'
                      : activeMode === 'search'
                        ? 'text-accent-secondary placeholder:text-accent-secondary/40'
                        : 'text-text-primary'
                  )}
                />
              </form>

              <div className="relative z-10 flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (isRecording) {
                      stopRecording('insert')
                    } else {
                      toggleRecording()
                    }
                  }}
                  disabled={isTranscribing}
                  className={clsx(
                    'flex h-10 w-10 items-center justify-center rounded-lg border transition-all duration-200',
                    isRecording
                      ? 'border-status-error/30 bg-status-error/20 text-status-error animate-pulse'
                      : isTranscribing
                        ? 'border-accent-primary/30 bg-accent-primary/20 text-accent-primary cursor-wait'
                        : 'border-[var(--border-default)] bg-[var(--surface)] text-text-secondary hover:bg-[var(--surface-raised)] hover:text-text-primary'
                  )}
                  title={isRecording ? 'Stop and review' : 'Start Dictation'}
                >
                  {isTranscribing ? (
                    <div className="flex items-center gap-0.5">
                      <span className="h-1 w-1 rounded-full bg-current animate-bounce [animation-delay:-0.3s]" />
                      <span className="h-1 w-1 rounded-full bg-current animate-bounce [animation-delay:-0.15s]" />
                      <span className="h-1 w-1 rounded-full bg-current animate-bounce" />
                    </div>
                  ) : isRecording ? (
                    <StopCircle size={20} weight="fill" />
                  ) : (
                    <Microphone size={20} />
                  )}
                </button>

                {isRecording && (
                  <button
                    type="button"
                    onClick={() => stopRecording('send')}
                    disabled={isTranscribing}
                    className="flex h-10 w-10 items-center justify-center rounded-lg border border-white bg-white text-black transition-colors duration-200 hover:bg-neutral-200 active:scale-95"
                    title="Stop and send"
                  >
                    <SendHorizontal size={17} weight="fill" />
                  </button>
                )}
              </div>

              {/* Indicators badges */}
              {activeBadges.length > 0 && (
                <div
                  className={clsx(
                    'relative z-10 flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border px-2',
                    'border-[var(--border-default)] bg-[var(--surface)]'
                  )}
                >
                  {activeBadges.map((badge) =>
                    badge === 'youtube' ? (
                      <CirclePlay key={badge} size={19} />
                    ) : badge === 'search' ? (
                      <Search key={badge} size={19} className="animate-slow-pulse" />
                    ) : (
                      <Brain key={badge} size={19} className="animate-slow-pulse" />
                    )
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Suggestion list panel (When chat overlay is NOT open) */}
        {unifiedSuggestions.length > 0 && !isMiniChatOpen && (
          <div className="premium-panel-soft absolute left-0 top-[calc(100%+12px)] z-50 max-h-[300px] w-full overflow-y-auto rounded-xl animate-soft-pop">
            <div className="border-b border-white/[0.055] px-4 py-3 text-xs font-semibold text-text-secondary/70">
              Suggested Results and Commands
            </div>
            <div className="py-1">
              {unifiedSuggestions.map((item, i) => (
                <button
                  key={i}
                  onClick={() => handleSuggestionAction(item)}
                  onMouseEnter={() => setSelectedIndex(i)}
                  className={clsx(
                    'flex w-full items-center justify-between px-4 py-3 text-sm transition-colors text-left',
                    selectedIndex === i
                      ? 'bg-[#202127] text-text-primary'
                      : 'text-text-secondary hover:bg-[#1a1b21]'
                  )}
                >
                  <div className="flex items-center gap-3">
                    {item.type === 'app' && item.icon ? (
                      <div className="flex h-8 w-8 items-center justify-center rounded-2xl bg-white/[0.04] p-1 border border-white/[0.06] overflow-hidden">
                        <img src={item.icon} alt="" className="h-full w-full object-contain" />
                      </div>
                    ) : (
                      <span
                        className={clsx(
                          'flex h-8 w-8 items-center justify-center rounded-2xl',
                          item.type === 'math'
                            ? 'bg-[#10221c] text-accent-secondary'
                            : item.type === 'app'
                              ? 'bg-[#251414] text-accent-primary'
                              : 'bg-[#22242d] text-text-secondary'
                        )}
                      >
                        {item.type === 'math' ? (
                          <Calculator size={16} weight="bold" />
                        ) : item.type === 'app' ? (
                          <AppWindow size={16} weight="bold" />
                        ) : (
                          <FileCode size={16} weight="bold" />
                        )}
                      </span>
                    )}
                    <div>
                      <span className="font-semibold text-text-primary block leading-tight">
                        {item.label}
                      </span>
                      <span className="text-xs text-text-secondary/70 leading-none">
                        {item.desc}
                      </span>
                    </div>
                  </div>
                  {selectedIndex === i && (
                    <ArrowRight size={15} weight="bold" className="text-text-muted shrink-0" />
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Mini-Chat Overlay (Simple Mode Only) */}
        {quickLauncherMode === 'simple' && isMiniChatOpen && (
          <div className="premium-panel-soft absolute left-0 top-[calc(100%+12px)] z-50 flex h-[400px] w-full flex-col overflow-hidden rounded-xl border border-[var(--border-default)] animate-soft-pop">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[var(--border-default)] bg-[var(--surface-raised)] px-6 py-4">
              <div className="flex items-center gap-2">
                <MessageSquare size={16} className="text-accent-secondary" />
                <span className="text-sm font-semibold text-text-primary">Prism Launcher Chat</span>
              </div>
              <button
                onClick={() => {
                  setLauncherMessages([])
                  setIsMiniChatOpen(false)
                  window.api.clearLauncherChat()
                }}
                className="text-xs text-text-secondary/60 hover:text-text-primary transition-colors px-2 py-1 rounded-lg hover:bg-[#25272e]"
              >
                Clear
              </button>
            </div>
            {/* Chat Messages Log */}
            <div ref={launcherScrollRef} data-prism-chat-scroll="true" className="flex-1 overflow-y-auto p-6 space-y-4">
              {launcherMessages.map((msg, i) => (
                <div key={i} className="flex flex-col gap-2 relative">
                  {msg.role === 'user' ? (
                    <div className="flex flex-col items-end gap-2.5 max-w-[85%] ml-auto">
                      {msg.screenshot && (
                        <div className="relative rounded-xl overflow-hidden border border-white/10 shadow-lg max-w-[200px] hover:border-white/20 transition-all duration-300">
                          <img
                            src={screenshotDataUrl(msg.screenshot)}
                            alt="Screenshot preview"
                            className="w-full h-auto cursor-zoom-in block"
                            onClick={() => {
                              const newWin = window.open()
                              newWin?.document.write(`
                                <body style="margin: 0; background: #0b0c0f; display: flex; align-items: center; justify-content: center; min-height: 100vh;">
                                  <img src="${screenshotDataUrl(msg.screenshot!)}" style="max-width: 100%; max-height: 100vh; object-fit: contain; box-shadow: 0 20px 50px rgba(0,0,0,0.5);" />
                                </body>
                              `)
                            }}
                          />
                        </div>
                      )}
                      {msg.content && (
                        <div className="prose prose-invert max-w-none flex w-full flex-col rounded-xl rounded-tr-sm border border-accent-secondary/20 bg-accent-secondary/[0.06] px-4 py-3 text-sm font-normal leading-relaxed text-text-primary">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm, remarkBreaks]}
                            components={markdownComponents}
                          >
                            {msg.content}
                          </ReactMarkdown>
                        </div>
                      )}
                    </div>
                  ) : msg.isError ? (
                    <div className="prose prose-invert flex w-full flex-col rounded-xl border border-status-error/25 bg-status-error/[0.07] px-4 py-3 text-sm font-normal leading-relaxed text-status-error">
                      {msg.content}
                    </div>
                  ) : (
                    <LauncherAiMessage msg={msg} markdownComponents={markdownComponents} />
                  )}
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            {/* Footer / Input info */}
            <div className="flex items-center justify-between border-t border-[var(--border-subtle)] bg-[var(--surface)] px-6 py-3 text-[11px] text-text-secondary/50">
              <span>Press Enter to send inline</span>
              <span>Simple Mode (Prism 6)</span>
            </div>
          </div>
        )}
      </div>
      <ErrorPopup />
    </div>
  )
}
