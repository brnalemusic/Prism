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
  CaretDown
} from '@phosphor-icons/react'
import { useSpeechToText } from '../hooks/useSpeechToText'
import { MODELS } from '../constants'
import { isShortcutPressed, triggerErrorPopup } from '../utils'
import { ErrorPopup } from './ErrorPopup'
import { ApplicationInfo, FileSearchResult } from '../../../shared/types'
import clsx from 'clsx'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ActionLoader, ToolCall } from './ActionLoader'
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

interface Message {
  role: 'user' | 'ai'
  content: string
  thoughts?: string
  isError?: boolean
  isStreaming?: boolean
  isThinking?: boolean
  isWritingToolCall?: boolean
  toolType?: 'task' | 'search' | 'mini-app'
  toolCalls?: ToolCall[]
  screenshot?: string
}

interface LauncherAiMessageProps {
  msg: Message
  markdownComponents: import('react-markdown').Components
}

const LauncherAiMessage = React.memo(function LauncherAiMessage({
  msg,
  markdownComponents
}: LauncherAiMessageProps) {
  const streamStats = useStreamStats(msg.content, !!msg.isStreaming)

  return (
    <StreamContext.Provider value={streamStats}>
      <div
        className={clsx(
          'flex flex-col w-full max-w-none transition-opacity duration-300 text-sm leading-relaxed font-normal text-text-primary prose prose-invert py-1',
          msg.isStreaming && 'opacity-90'
        )}
      >
        {/* Thought Section (reconstructed visually only for Quick Launcher!) */}
        {(msg.isThinking || msg.thoughts) && (
          <div className="w-full mb-3">
            <details className="group w-full select-none">
              <summary
                className={clsx(
                  'inline-flex items-center gap-2 text-[12.5px] py-1 select-none transition-all duration-200 cursor-pointer text-text-secondary/60 hover:text-text-secondary/90 list-none [&::-webkit-details-marker]:hidden'
                )}
              >
                <Brain
                  size={13}
                  className={clsx(
                    'text-text-secondary/50 transition-all duration-300',
                    msg.isThinking && 'animate-pulse text-accent-secondary/70'
                  )}
                />

                <span className="font-medium leading-none">
                  {(() => {
                    // Extract bold outlines like "**Initiating Black Hole Analysis**"
                    const outlineMatches = Array.from(
                      (msg.thoughts || '').matchAll(/\*\*(.*?)\*\*/g)
                    )
                    if (outlineMatches.length > 0) {
                      // Take the last match to show current thinking step
                      return outlineMatches[outlineMatches.length - 1][1]
                    }
                    return msg.isThinking ? 'Thinking...' : 'Thinking'
                  })()}
                </span>

                <CaretDown
                  size={11}
                  className="text-text-muted/50 transition-transform duration-200 group-open:rotate-180"
                />
              </summary>
              <div className="mt-1.5 border-l border-white/[0.06] ml-1.5 pl-4 py-0.5 font-mono text-[11px] leading-relaxed select-text text-text-secondary/50">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.thoughts || ''}</ReactMarkdown>
              </div>
            </details>
          </div>
        )}

        {/* Content rendering: split by tool call and mini-app tags to render inline */}
        {(() => {
          const parts = msg.content.split(
            /(<tool_call>[\s\S]*?<\/tool_call>|<mini_app>[\s\S]*?<\/mini_app>)/g
          )
          let toolCallIndex = 0
          let partStartOffset = 0

          return parts.map((part, index) => {
            const currentPartStartOffset = partStartOffset
            partStartOffset += part.length

            if (part.startsWith('<tool_call>')) {
              if (part.includes('</tool_call>')) {
                const tc = msg.toolCalls?.[toolCallIndex]
                toolCallIndex++
                if (tc) {
                  return <ActionLoader key={`tc-${index}`} toolCall={tc} />
                }
              }
              return null
            } else if (part.trim() !== '') {
              return (
                <div key={`text-${index}`} className="prose prose-invert max-w-none">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[
                      createStreamingFadeRehypePlugin(streamStats, currentPartStartOffset)
                    ]}
                    components={markdownComponents}
                  >
                    {part}
                  </ReactMarkdown>
                </div>
              )
            }
            return null
          })
        })()}

        {msg.isWritingToolCall && (
          <ActionLoader
            key="writing-tc"
            toolCall={{
              name: msg.toolType || 'task',
              status: 'writing',
              args: {}
            }}
          />
        )}
      </div>
    </StreamContext.Provider>
  )
})

export function QuickLauncher(): React.JSX.Element {
  const [query, setQuery] = useState('')
  const markdownComponents = useMemo(() => StaticMarkdownComponents, [])
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false)
  const [isSearchEnabled, setIsSearchEnabled] = useState(false)
  const [isThinkMode, setIsThinkMode] = useState(false) // Think mode default disabled for launcher
  const [isYoutubeMode, setIsYoutubeMode] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [activeModelId, setActiveModelId] = useState('prism-6-super-fast')
  const [shortcut, setShortcut] = useState('CommandOrControl+M')
  const [isFocused, setIsFocused] = useState(false)
  const [quickLauncherMode, setQuickLauncherMode] = useState<'simple' | 'advanced'>('simple')
  const inputRef = useRef<HTMLInputElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const [attachedScreenshot, setAttachedScreenshot] = useState<string | null>(null)
  const [glowState, setGlowState] = useState<'idle' | 'processing' | 'glow-master'>('idle')
  const [launcherOpacity, setLauncherOpacity] = useState(1)

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

  const activeMode = isYoutubeMode
    ? 'youtube'
    : isSearchEnabled
      ? 'search'
      : isThinkMode
        ? 'think'
        : 'default'
  const activeBadges: LauncherBadge[] = [
    ...(isYoutubeMode ? (['youtube'] as const) : []),
    ...(isSearchEnabled ? (['search'] as const) : []),
    ...(isThinkMode ? (['think'] as const) : [])
  ]
  const isSearchAndThinkMode = isSearchEnabled && isThinkMode
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
    window.api.getConfig().then((config) => {
      if (config.modelSelectionShortcut) {
        setShortcut(config.modelSelectionShortcut)
      }
      if (config.defaultModel) {
        setActiveModelId(config.defaultModel)
      }
      if (config.quickLauncherMode) {
        setQuickLauncherMode(config.quickLauncherMode)
      }
    })

    window.api.launcherGetApps().then((res) => {
      setApps(res || [])
    })

    const removeAppsUpdatedListener = window.api.onAppsUpdated((updatedApps) => {
      setApps(updatedApps || [])
    })

    const removeConfigListener = window.api.onConfigChanged((config) => {
      if (config.modelSelectionShortcut) {
        setShortcut(config.modelSelectionShortcut)
      }
      if (config.defaultModel) {
        setActiveModelId(config.defaultModel)
      }
      if (config.quickLauncherMode) {
        setQuickLauncherMode(config.quickLauncherMode)
      }
    })

    const removeModelListener = window.api.onModelChanged((modelId) => {
      setActiveModelId(modelId)
    })

    const removeThinkModeListener = window.api.onThinkModeChanged((val) => {
      setIsThinkMode(val)
    })

    const removeSearchEnabledListener = window.api.onSearchEnabledChanged((val) => {
      setIsSearchEnabled(val)
    })

    return () => {
      removeConfigListener()
      removeModelListener()
      removeThinkModeListener()
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
      // Reset chat whenever launcher is opened/focused anew
      setLauncherMessages([])
      setIsMiniChatOpen(false)
      setQuery('')
      setIsYoutubeMode(false)
      window.api.clearLauncherChat()
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

  // Scroll to bottom of chat
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' })
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
          isThinking: true,
          toolCalls: []
        }
      ])
    })

    const removeReplyChunk = window.api.onLauncherReplyChunk((data) => {
      setLauncherMessages((prev) => {
        if (prev.length === 0) return prev
        const newMsgs = [...prev]
        const lastMsg = { ...newMsgs[newMsgs.length - 1] }
        if (lastMsg.role === 'ai') {
          lastMsg.content = data.finalResponse
          lastMsg.thoughts = data.thoughts
          lastMsg.isThinking = data.isThinking
          lastMsg.isWritingToolCall = data.isWritingToolCall
          lastMsg.toolType = data.toolType
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
          lastMsg.content = data.finalResponse
          lastMsg.thoughts = data.thoughts
          lastMsg.isStreaming = false
          lastMsg.isThinking = false
          lastMsg.isWritingToolCall = false
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
          lastMsg.content = data.error
          lastMsg.isError = true
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
          const toolCalls = lastMsg.toolCalls ? [...lastMsg.toolCalls] : []
          const isDuplicate = toolCalls.some(
            (t) =>
              t.name === data.name &&
              JSON.stringify(t.args) === JSON.stringify(data.args) &&
              t.status === 'running'
          )
          if (!isDuplicate) {
            lastMsg.toolCalls = [...toolCalls, { ...data, status: 'running' } as ToolCall]
          }
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
        if (lastMsg.role === 'ai' && lastMsg.toolCalls) {
          const toolCalls = [...lastMsg.toolCalls]
          const lastToolIndex = toolCalls.findLastIndex(
            (t) => t.name === data.name && t.status === 'running'
          )
          if (lastToolIndex !== -1) {
            toolCalls[lastToolIndex] = {
              ...toolCalls[lastToolIndex],
              status: data.result.startsWith('Error') ? 'error' : 'done',
              result: data.result
            }
            lastMsg.toolCalls = toolCalls
          }
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

      // Dictation shortcut (Ctrl+D)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        toggleRecording()
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        window.api.setSearchEnabled(!isSearchEnabled)
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 't') {
        e.preventDefault()
        window.api.setThinkMode(!isThinkMode)
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
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
    isThinkMode,
    quickLauncherMode,
    isMiniChatOpen,
    handleSuggestionAction,
    isRecording
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
        thinkMode: isThinkMode,
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
        thinkMode: isThinkMode,
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
    search: isSearchAndThinkMode
      ? 'border-[#8ee8b0]/25 bg-[linear-gradient(110deg,rgba(45,212,191,0.06),rgba(245,158,11,0.065))] text-[#d9c77a]'
      : 'border-accent-secondary/30 bg-accent-secondary/[0.055] text-accent-secondary',
    think: 'border-status-warning/30 bg-status-warning/[0.055] text-status-warning',
    default: 'border-white/[0.09] bg-white/[0.045] text-text-primary'
  }[activeMode]

  return (
    <div
      className="quick-launcher-overlay flex h-screen w-screen flex-col items-center justify-start p-8 pt-[20vh] font-sans"
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
                isSearchAndThinkMode && badge !== 'youtube'
                  ? 'border-transparent bg-gradient-to-r from-[#172e27] via-[#212918] to-[#2c2317] text-[#d9c77a] shadow-[0_0_22px_rgba(245,158,11,0.09)]'
                  : badge === 'youtube'
                    ? 'border-accent-primary/30 bg-[#251414] text-accent-primary'
                    : badge === 'search'
                      ? 'border-accent-secondary/30 bg-[#10221c] text-accent-secondary'
                      : 'border-status-warning/30 bg-[#221d10] text-status-warning'
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
              'model-menu-panel absolute left-0 top-full z-50 mt-3 w-80 origin-top overflow-hidden rounded-[24px] py-2 transition-all duration-200',
              isModelSelectorOpen
                ? 'translate-y-0 scale-100 opacity-100'
                : 'pointer-events-none -translate-y-2 scale-[0.98] opacity-0'
            )}
          >
            <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3 text-xs font-semibold text-text-secondary/70">
              <Cpu size={14} className="text-accent-primary" />
              Prism engines
            </div>
            {MODELS.map((model, index) => (
              <button
                key={model.id}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => {
                  setActiveModelId(model.id)
                  window.api.setModel(model.id)
                  setIsModelSelectorOpen(false)
                }}
                className={clsx(
                  'relative flex w-full items-start gap-3 px-4 py-3 text-left transition-all duration-200',
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
                      : activeModelId === model.id
                        ? 'bg-accent-secondary'
                        : 'bg-white/[0.18]'
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={clsx(
                      'block text-sm font-semibold',
                      model.id === 'prism-5' ? 'prism-5-title-gradient' : 'text-text-primary'
                    )}
                  >
                    {model.name}
                  </span>
                  <span className="mt-0.5 block text-xs leading-snug text-text-secondary/70">
                    {model.description}
                  </span>
                </span>
                {activeModelId === model.id && (
                  <Check size={15} className="mt-0.5 text-accent-secondary" />
                )}
              </button>
            ))}
          </div>
        )}

        {/* Input Bar */}
        <div
          className={clsx(
            'premium-panel relative flex flex-col w-full gap-3 overflow-hidden rounded-[30px] border px-4 py-4 transition-all duration-300 input-border-glow',
            modeClasses,
            ((isModelSelectorOpen && quickLauncherMode === 'advanced') || isFocused) &&
              'prism-glow active'
          )}
        >
          {attachedScreenshot && (
            <div className="relative flex items-center justify-start self-start bg-white/[0.03] border border-white/[0.08] p-1.5 rounded-xl pr-8 animate-soft-pop group/thumb">
              <img
                src={`data:image/png;base64,${attachedScreenshot}`}
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
                    isSearchAndThinkMode
                      ? 'bg-[linear-gradient(to_right,transparent,var(--accent-secondary),var(--status-warning),transparent)]'
                      : 'bg-gradient-to-r from-transparent via-current to-transparent'
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
                  'flex h-10 shrink-0 items-center gap-2 rounded-[16px] border px-3 text-sm font-semibold transition-all duration-200',
                  isModelSelectorOpen
                    ? 'border-accent-primary/35 bg-[#251b2d] text-accent-primary'
                    : 'border-white/[0.08] bg-[#1e2026] text-text-secondary hover:bg-[#25272e] hover:text-text-primary'
                )}
              >
                <Command size={15} />
                <span
                  className={
                    activeModel.id === 'prism-5' ? 'prism-top-gradient' : 'text-text-primary'
                  }
                >
                  {activeModel.name.replace('Prism ', '')}
                </span>
                <ChevronRight
                  size={15}
                  className={clsx(
                    'transition-transform duration-200',
                    isModelSelectorOpen && 'rotate-90'
                  )}
                />
              </button>
            ) : (
              <div className="flex h-10 shrink-0 items-center gap-2 rounded-[16px] border border-white/[0.08] bg-[#1e2026] px-3 text-sm font-semibold text-text-secondary select-none">
                <Sparkles size={15} className="text-accent-secondary animate-pulse" />
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
                      : isSearchAndThinkMode
                        ? 'Search, and then Think Deeply with Prism'
                        : isSearchEnabled
                          ? 'Search the web'
                          : isThinkMode
                            ? 'Think with Prism'
                            : quickLauncherMode === 'simple'
                              ? 'Ask quick AI or search files/apps...'
                              : 'What should Prism do?'
                }
                className={clsx(
                  'w-full border-none bg-transparent text-[22px] font-medium outline-none transition-colors duration-200 placeholder:text-text-muted',
                  activeMode === 'youtube'
                    ? 'text-accent-primary placeholder:text-accent-primary/40'
                    : isSearchAndThinkMode
                      ? 'text-[#d9c77a] placeholder:text-[#d9c77a]/45'
                      : activeMode === 'search'
                        ? 'text-accent-secondary placeholder:text-accent-secondary/40'
                        : activeMode === 'think'
                          ? 'text-status-warning placeholder:text-status-warning/40'
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
                  'flex h-10 w-10 items-center justify-center rounded-[16px] border transition-all duration-200',
                  isRecording
                    ? 'border-status-error/30 bg-status-error/20 text-status-error animate-pulse'
                    : isTranscribing
                      ? 'border-accent-primary/30 bg-accent-primary/20 text-accent-primary cursor-wait'
                      : 'border-white/[0.08] bg-[#1e2026] text-text-secondary hover:bg-[#25272e] hover:text-text-primary'
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
                  className="flex h-10 w-10 items-center justify-center rounded-[16px] border border-text-primary/20 bg-text-primary text-black transition-all duration-200 hover:bg-white active:scale-95"
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
                  'relative z-10 flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-[16px] border px-2',
                  isSearchAndThinkMode
                    ? 'border-transparent bg-gradient-to-r from-[#10221c] to-[#221d10] text-[#d9c77a]'
                    : 'border-white/[0.15] bg-[#22242d]'
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

        {/* Suggestion list panel (When chat overlay is NOT open) */}
        {unifiedSuggestions.length > 0 && !isMiniChatOpen && (
          <div className="premium-panel-soft absolute left-0 top-[calc(100%+12px)] z-50 w-full overflow-hidden rounded-[24px] animate-soft-pop max-h-[300px] overflow-y-auto">
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
                          <Calculator size={16} />
                        ) : item.type === 'app' ? (
                          <AppWindow size={16} />
                        ) : (
                          <FileCode size={16} />
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
                    <ArrowRight size={15} className="text-text-muted shrink-0" />
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Mini-Chat Overlay (Simple Mode Only) */}
        {quickLauncherMode === 'simple' && isMiniChatOpen && (
          <div className="premium-panel-soft absolute left-0 top-[calc(100%+12px)] z-50 w-full overflow-hidden rounded-[28px] animate-soft-pop flex flex-col h-[400px] border border-white/[0.06]">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/[0.055] px-6 py-4 bg-[#18191f]">
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
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {launcherMessages.map((msg, i) => (
                <div key={i} className="flex flex-col gap-2 relative">
                  {msg.role === 'user' ? (
                    <div className="flex flex-col items-end gap-2.5 max-w-[85%] ml-auto">
                      {msg.screenshot && (
                        <div className="relative rounded-xl overflow-hidden border border-white/10 shadow-lg max-w-[200px] hover:border-white/20 transition-all duration-300">
                          <img
                            src={`data:image/png;base64,${msg.screenshot}`}
                            alt="Screenshot preview"
                            className="w-full h-auto cursor-zoom-in block"
                            onClick={() => {
                              const newWin = window.open()
                              newWin?.document.write(`
                                <body style="margin: 0; background: #0b0c0f; display: flex; align-items: center; justify-content: center; min-height: 100vh;">
                                  <img src="data:image/png;base64,${msg.screenshot}" style="max-width: 100%; max-height: 100vh; object-fit: contain; box-shadow: 0 20px 50px rgba(0,0,0,0.5);" />
                                </body>
                              `)
                            }}
                          />
                        </div>
                      )}
                      {msg.content && (
                        <div className="flex flex-col rounded-[20px] px-4 py-3 text-sm leading-relaxed font-normal shadow-md bg-[#1b2c27] text-text-primary rounded-tr-sm border border-accent-secondary/20 w-full">
                          {msg.content}
                        </div>
                      )}
                    </div>
                  ) : msg.isError ? (
                    <div className="flex flex-col w-full rounded-[20px] border border-status-error/25 shadow-md px-4 py-3 text-sm leading-relaxed font-normal bg-[#2d1b1c] text-status-error prose prose-invert">
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
            <div className="px-6 py-3 bg-[#15161b] border-t border-white/[0.04] text-[11px] text-text-secondary/50 flex justify-between items-center">
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
