import { useState, useRef, useImperativeHandle, forwardRef, useEffect } from 'react'
import {
  PaperPlaneRight as SendHorizontal,
  Stop as Square,
  PlayCircle as CirclePlay,
  Lock,
  Robot as Bot,
  CornersOut as Maximize2,
  CornersIn as Minimize2,
  Microphone,
  StopCircle,
  Plus,
  Paperclip,
  Camera,
  SquaresFour as AppIcon,
  CaretRight,
  FilePdf,
  FilePpt,
  Trash,
  Lightning,
  Globe,
  ChatTeardropText,
  Folder
} from '@phosphor-icons/react'
import clsx from 'clsx'
import { useSpeechToText } from '../hooks/useSpeechToText'
import { ModelSelector } from './ModelSelector'
import { AttachedFile } from '../App'
import type { AppConfig, SlashWorkflow } from '../../../main/config'
import type { SessionMode } from '../../../shared/types'
import { triggerErrorPopup, isShortcutPressed } from '../utils'

interface InputBarProps {
  onSend: (
    message: string,
    thinkMode?: boolean,
    searchEnabled?: boolean,
    screenshot?: string,
    attachedFile?: AttachedFile
  ) => void
  onCancel?: () => void
  disabled?: boolean
  isProcessing?: boolean
  isKeyMissing?: boolean
  isThinkMode?: boolean
  onThinkModeToggle?: (val: boolean) => void
  selectedModel?: string
  onModelChange?: (modelId: string) => void
  text: string
  setText: (val: string | ((prev: string) => string)) => void
  isSearchEnabled: boolean
  setIsSearchEnabled: (val: boolean) => void
  isFullscreen: boolean
  onFullscreenToggle: () => void
  attachedFile?: AttachedFile | null
  onRemoveFile?: () => void
  onAttachFile?: (file: AttachedFile) => void
  onOpenScreenshotModal?: () => void
  onOpenSubagentModal?: () => void
  onOpenYoutubeModal?: () => void
  activeWorkflow?: SlashWorkflow | null
  setActiveWorkflow?: (val: SlashWorkflow | null) => void
  sessionMode: SessionMode
  disciplinePath: string
}

export interface InputBarHandle {
  focus: () => void
}

export const InputBar = forwardRef<InputBarHandle, InputBarProps>(
  (
    {
      onSend,
      onCancel,
      disabled,
      isProcessing,
      isKeyMissing,
      isThinkMode = false,
      onThinkModeToggle,
      selectedModel = 'prism-6-super-fast',
      onModelChange,
      text,
      setText,
      isSearchEnabled,
      setIsSearchEnabled,
      isFullscreen,
      onFullscreenToggle,
      attachedFile,
      onRemoveFile,
      onAttachFile,
      onOpenScreenshotModal,
      onOpenSubagentModal,
      onOpenYoutubeModal,
      activeWorkflow,
      setActiveWorkflow,
      sessionMode,
      disciplinePath
    },
    ref
  ) => {
    const [isFocused, setIsFocused] = useState(false)
    const [showFullscreenBtn, setShowFullscreenBtn] = useState(false)
    const [showAttachMenu, setShowAttachMenu] = useState(false)
    const [showAppsMenu, setShowAppsMenu] = useState(false)

    const inputRef = useRef<HTMLTextAreaElement>(null)
    const attachMenuRef = useRef<HTMLDivElement>(null)
    const attachButtonRef = useRef<HTMLButtonElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const { isRecording, isTranscribing, toggleRecording, stopRecording } = useSpeechToText(
      (transcription, action) => {
        const newText = textRef.current.trim()
          ? textRef.current + '\n\n' + transcription
          : transcription
        setText(newText)

        if (action === 'send') {
          handleSend(newText)
        }

        setTimeout(() => inputRef.current?.focus(), 100)
      }
    )

    const isSearchAndThinkMode = isSearchEnabled && isThinkMode
    const activeMode = isSearchEnabled ? 'search' : isThinkMode ? 'think' : 'default'

    const [config, setConfig] = useState<AppConfig | null>(null)
    const [workflows, setWorkflows] = useState<any[]>([])
    const [slashSelectedIndex, setSlashSelectedIndex] = useState(0)

    useEffect(() => {
      window.api.getConfig().then((cfg) => {
        if (cfg) {
          setConfig(cfg)
          if (cfg.workflows) {
            setWorkflows(cfg.workflows)
          }
        }
      })

      const removeListener = window.api.onConfigChanged((cfg) => {
        if (cfg) {
          setConfig(cfg)
          if (cfg.workflows) {
            setWorkflows(cfg.workflows)
          }
        }
      })
      return () => removeListener()
    }, [])

    useEffect(() => {
      if (!text || !setActiveWorkflow) return

      const spaceMatch = text.match(/^(\/[^\s]+)\s/)
      if (spaceMatch) {
        const cmd = spaceMatch[1]
        const wf = workflows.find((w) => w.command.toLowerCase() === cmd.toLowerCase())
        if (wf) {
          setActiveWorkflow(wf)
          // Set text to the remaining text after the command and space
          setText(text.substring(spaceMatch[0].length))

          // Move cursor to the end of textarea
          setTimeout(() => {
            if (inputRef.current) {
              inputRef.current.focus()
              inputRef.current.selectionStart = inputRef.current.selectionEnd =
                inputRef.current.value.length
            }
          }, 50)
        }
      }
    }, [text, workflows, setActiveWorkflow, setText])

    const filteredWorkflows = text.startsWith('/')
      ? workflows.filter((w) =>
          w.command.toLowerCase().startsWith(text.toLowerCase().split(' ')[0])
        )
      : []

    const showSlashMenu =
      text.startsWith('/') && filteredWorkflows.length > 0 && !text.includes(' ')

    useEffect(() => {
      if (showSlashMenu) {
        setSlashSelectedIndex(0)
      }
    }, [showSlashMenu, text])

    const handleSelectWorkflow = (workflow: any) => {
      setText(workflow.command + ' ')
      setSlashSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }

    const renderSlashMenu = (): React.JSX.Element | null => {
      if (!showSlashMenu) return null
      return (
        <div className="premium-panel-soft mb-3 w-full overflow-hidden rounded-[22px] border border-white/[0.08] bg-background-main/95 backdrop-blur-md shadow-2xl animate-soft-pop z-30">
          <div className="border-b border-white/[0.055] px-4 py-3 text-xs font-semibold text-text-secondary/70">
            Workflows
          </div>
          <div className="max-h-60 overflow-y-auto">
            {filteredWorkflows.map((w, i) => (
              <button
                key={w.id}
                onClick={() => handleSelectWorkflow(w)}
                onMouseEnter={() => setSlashSelectedIndex(i)}
                className={clsx(
                  'flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors duration-200 border-0 outline-none w-full cursor-pointer',
                  slashSelectedIndex === i
                    ? 'bg-white/[0.065] text-text-primary'
                    : 'text-text-secondary hover:bg-white/[0.04]'
                )}
              >
                <span
                  className={clsx(
                    'flex h-8 w-8 items-center justify-center rounded-2xl bg-accent-primary/[0.12] text-accent-primary shrink-0'
                  )}
                >
                  <Lightning size={16} weight="fill" />
                </span>
                <div className="flex flex-col">
                  <span className="font-semibold text-text-primary">{w.command}</span>
                  <span className="text-xs text-text-secondary/70">
                    {w.name} — {w.description}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )
    }

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
      const file = e.target.files?.[0]
      if (!file) return

      const fileName = file.name
      const lookedUpMime = window.api.getMimeType(fileName)
      const mimeType = (lookedUpMime ? lookedUpMime : file.type) || 'application/octet-stream'

      // Block video and audio files
      if (mimeType.startsWith('video/') || mimeType.startsWith('audio/')) {
        triggerErrorPopup('File type blocked: Video and audio files are not allowed.')
        e.target.value = ''
        return
      }

      // Check if it is an allowed type: Image, PDF, or Presentation
      const isImage = mimeType.startsWith('image/')
      const isPdf = mimeType === 'application/pdf'
      const isPresentation =
        mimeType.includes('presentation') ||
        mimeType.includes('slideshow') ||
        mimeType.includes('keynote') ||
        mimeType === 'application/vnd.ms-powerpoint' ||
        mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
        mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.slideshow' ||
        mimeType === 'application/vnd.oasis.opendocument.presentation' ||
        mimeType === 'application/vnd.apple.keynote'

      if (!isImage && !isPdf && !isPresentation) {
        triggerErrorPopup('Unsupported file type. Please upload an Image, PDF, or Presentation.')
        e.target.value = ''
        return
      }

      const reader = new FileReader()
      reader.onload = (event) => {
        if (event.target?.result) {
          const base64 = (event.target.result as string).split(',')[1]
          onAttachFile?.({
            name: fileName,
            mimeType: mimeType,
            data: base64
          })
        }
      }
      reader.readAsDataURL(file)
      e.target.value = ''
      setShowAttachMenu(false)
    }

    useImperativeHandle(ref, () => ({
      focus: (): void => {
        inputRef.current?.focus()
      }
    }))

    // Textarea height auto-resizer and Scroll Detection
    useEffect(() => {
      const textarea = inputRef.current
      if (!textarea) return

      if (!isFullscreen) {
        // Reset height to get correct scrollHeight
        textarea.style.height = 'auto'
        const nextHeight = Math.max(64, Math.min(textarea.scrollHeight, 300))
        textarea.style.height = `${nextHeight}px`

        if (textarea.scrollHeight > 300) {
          textarea.style.overflowY = 'auto'
        } else {
          textarea.style.overflowY = 'hidden'
        }

        const hasScroll =
          textarea.scrollHeight > 300 ||
          (textarea.scrollHeight > textarea.clientHeight && textarea.clientHeight >= 280)
        setShowFullscreenBtn(hasScroll)
      } else {
        textarea.style.height = '100%'
        textarea.style.overflowY = 'auto'
        setShowFullscreenBtn(false)
      }
    }, [text, isFullscreen, isFocused])

    // Escape key listener for fullscreen mode
    useEffect(() => {
      if (!isFullscreen) return
      const handleEsc = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') {
          e.preventDefault()
          onFullscreenToggle()
        }
      }
      window.addEventListener('keydown', handleEsc)
      return () => window.removeEventListener('keydown', handleEsc)
    }, [isFullscreen, onFullscreenToggle])

    const textRef = useRef(text)
    useEffect(() => {
      textRef.current = text
    }, [text])

    // Global keyboard shortcuts (configurable)
    useEffect(() => {
      const handleGlobalKeyDown = (e: KeyboardEvent): void => {
        const dictationKey = config?.dictationShortcut || 'CommandOrControl+D'
        const webSearchKey = config?.webSearchShortcut || 'CommandOrControl+S'
        const thinkModeKey = config?.thinkModeShortcut || 'CommandOrControl+T'
        const youtubeModeKey = config?.youtubeModeShortcut || 'CommandOrControl+Y'

        if (isShortcutPressed(e, dictationKey)) {
          e.preventDefault()
          toggleRecording()
        }
        if (isShortcutPressed(e, webSearchKey)) {
          e.preventDefault()
          const nextVal = !isSearchEnabled
          setIsSearchEnabled(nextVal)
        }
        if (isShortcutPressed(e, thinkModeKey)) {
          e.preventDefault()
          onThinkModeToggle?.(!isThinkMode)
        }
        if (isShortcutPressed(e, youtubeModeKey)) {
          e.preventDefault()
          setIsSearchEnabled(false)
          onOpenYoutubeModal?.()
        }
      }
      window.addEventListener('keydown', handleGlobalKeyDown)
      return () => window.removeEventListener('keydown', handleGlobalKeyDown)
    }, [
      config,
      isThinkMode,
      onThinkModeToggle,
      selectedModel,
      isSearchEnabled,
      setIsSearchEnabled,
      setText,
      isRecording
    ])

    useEffect(() => {
      const handleClickOutside = (event: MouseEvent): void => {
        const isClickInsideAttach =
          attachMenuRef.current && attachMenuRef.current.contains(event.target as Node)
        const isClickOnAttachBtn =
          attachButtonRef.current && attachButtonRef.current.contains(event.target as Node)

        if (!isClickInsideAttach && !isClickOnAttachBtn) {
          setShowAttachMenu(false)
          setShowAppsMenu(false)
        }
      }
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    useEffect(() => {
      if (!disabled) {
        inputRef.current?.focus()
      }
    }, [disabled])

    const handleSend = (overrideText?: string): void => {
      const currentText = overrideText !== undefined ? overrideText : text
      if ((currentText.trim() || attachedFile) && !disabled) {
        const trimmedText = currentText.trim()

        let finalMessage = trimmedText
        if (trimmedText !== '/clear' && trimmedText !== '') {
          if (activeWorkflow) {
            finalMessage = `${activeWorkflow.command} ${trimmedText}`
          } else {
            finalMessage = isSearchEnabled ? `[FORCE_SEARCH] ${trimmedText}` : trimmedText
          }
        }

        onSend(
          finalMessage,
          isThinkMode,
          isSearchEnabled,
          attachedFile?.mimeType.startsWith('image/') ? attachedFile.data : undefined,
          attachedFile || undefined
        )
        setText('')
        setActiveWorkflow?.(null)

        if (isFullscreen) {
          onFullscreenToggle()
        }

        setTimeout(() => {
          inputRef.current?.focus()
        }, 0)
      }
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
      if (showSlashMenu) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setSlashSelectedIndex((prev) => (prev + 1) % filteredWorkflows.length)
          return
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          setSlashSelectedIndex(
            (prev) => (prev - 1 + filteredWorkflows.length) % filteredWorkflows.length
          )
          return
        } else if (e.key === 'Enter') {
          e.preventDefault()
          handleSelectWorkflow(filteredWorkflows[slashSelectedIndex])
          return
        }
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    }

    const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>): void => {
      if (disabled) return
      const items = e.clipboardData.items
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile()
          if (file && onAttachFile) {
            const reader = new FileReader()
            reader.onload = (event) => {
              if (event.target?.result) {
                const base64 = (event.target.result as string).split(',')[1]
                onAttachFile({
                  name: 'pasted_image.png',
                  mimeType: 'image/png',
                  data: base64
                })
              }
            }
            reader.readAsDataURL(file)
          }
        }
      }
    }

    const getPlaceholder = (): string => {
      if (isKeyMissing) return 'API key required'
      if (isProcessing) return 'Prism is responding'
      if (activeWorkflow) return `Ask with ${activeWorkflow.name}`
      if (isSearchAndThinkMode) return 'Search, and then Think Deeply with Prism'
      if (isSearchEnabled) return 'Search the web with Prism'
      if (isThinkMode) return 'Ask Prism to think deeply'
      return 'Ask Prism'
    }

    const modeStyles = {
      youtube: 'border-accent-primary/30 bg-accent-primary/[0.04] text-accent-primary',
      search: isSearchAndThinkMode
        ? 'border-[#8ee8b0]/25 bg-[linear-gradient(110deg,rgba(45,212,191,0.045),rgba(245,158,11,0.05))] text-[#d9c77a]'
        : 'border-accent-secondary/30 bg-accent-secondary/[0.04] text-accent-secondary',
      think: 'border-status-warning/30 bg-status-warning/[0.04] text-status-warning',
      default: 'border-white/[0.085] bg-white/[0.028] text-text-primary'
    }[activeMode]

    const renderBottomControls = (): React.JSX.Element => (
      <div className="flex w-full flex-wrap items-center justify-between gap-3 border-t border-white/[0.045] pt-2.5 mt-2 select-none relative z-20">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {isFullscreen && (
            <div className="text-xs text-text-muted font-medium">
              {text.length} characters | Press{' '}
              <kbd className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10">Esc</kbd> to
              exit
            </div>
          )}

          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            className="hidden"
            accept="image/*,application/pdf,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.oasis.opendocument.presentation,application/vnd.apple.keynote,.ppt,.pptx,.odp,.key,.pps,.ppsx"
          />

          {/* Plus button & dropdown container */}
          <div className="relative" ref={attachMenuRef}>
            <button
              ref={attachButtonRef}
              onClick={() => setShowAttachMenu(!showAttachMenu)}
              disabled={disabled}
              className={clsx(
                'flex h-8 w-8 items-center justify-center rounded-xl transition-all duration-200 border border-white/[0.08] bg-white/[0.028] text-text-secondary hover:bg-white/[0.065] hover:text-text-primary cursor-pointer',
                showAttachMenu && 'bg-white/[0.08] text-text-primary border-white/20'
              )}
              title="Add attachment / App"
            >
              <Plus size={16} weight="bold" />
            </button>

            {showAttachMenu && (
              <div className="model-menu-panel absolute bottom-full left-0 mb-2 z-[60] w-48 p-1.5 animate-soft-pop text-left">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-semibold text-text-primary hover:bg-white/[0.04] transition-all text-left"
                >
                  <Paperclip size={16} className="text-text-secondary" />
                  <div className="flex flex-col">
                    <span>File</span>
                    <span className="text-[9px] text-text-secondary/50 font-normal">
                      Image, PDF, Slides
                    </span>
                  </div>
                </button>

                <button
                  onClick={() => {
                    onOpenScreenshotModal?.()
                    setShowAttachMenu(false)
                  }}
                  className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-semibold text-text-primary hover:bg-white/[0.04] transition-all text-left"
                >
                  <Camera size={16} className="text-text-secondary" />
                  <div className="flex flex-col">
                    <span>Screenshot</span>
                    <span className="text-[9px] text-text-secondary/50 font-normal">
                      Capture app window
                    </span>
                  </div>
                </button>

                <button
                  onClick={() => {
                    setIsSearchEnabled(!isSearchEnabled)
                    setShowAttachMenu(false)
                  }}
                  className={clsx(
                    'w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-semibold hover:bg-white/[0.04] transition-all text-left',
                    isSearchEnabled ? 'text-accent-secondary' : 'text-text-primary'
                  )}
                >
                  <Globe
                    size={16}
                    className={isSearchEnabled ? 'text-accent-secondary' : 'text-text-secondary'}
                  />
                  <div className="flex flex-col">
                    <span>Web Search</span>
                    <span className="text-[9px] text-text-secondary/50 font-normal">
                      Search the web with Prism
                    </span>
                  </div>
                </button>

                {/* Hoverable / Clickable Apps item */}
                <div
                  className="relative group/apps"
                  onMouseEnter={() => setShowAppsMenu(true)}
                  onMouseLeave={() => setShowAppsMenu(false)}
                >
                  <button
                    onClick={() => setShowAppsMenu(!showAppsMenu)}
                    className="w-full flex items-center justify-between rounded-xl px-3 py-2 text-xs font-semibold text-text-primary hover:bg-white/[0.04] transition-all text-left"
                  >
                    <div className="flex items-center gap-2.5">
                      <AppIcon size={16} className="text-text-secondary" />
                      <div className="flex flex-col">
                        <span>Apps</span>
                        <span className="text-[9px] text-text-secondary/50 font-normal">
                          Run apps with AI
                        </span>
                      </div>
                    </div>
                    <CaretRight size={12} className="text-text-secondary/50" />
                  </button>

                  {/* Drop-side submenu to the right */}
                  {showAppsMenu && (
                    <div className="absolute left-full bottom-0 pl-1.5 z-[70] -ml-px">
                      <div className="model-menu-panel w-44 p-1.5 animate-soft-pop text-left">
                        <button
                          onClick={() => {
                            setIsSearchEnabled(false)
                            onOpenYoutubeModal?.()
                            setShowAttachMenu(false)
                            setShowAppsMenu(false)
                          }}
                          className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-semibold text-text-primary hover:bg-white/[0.04] transition-all text-left"
                        >
                          <CirclePlay size={16} className="text-accent-primary" />
                          <span>YouTube</span>
                        </button>

                        <button
                          onClick={() => {
                            onOpenSubagentModal?.()
                            setShowAttachMenu(false)
                            setShowAppsMenu(false)
                          }}
                          className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-semibold text-text-primary hover:bg-white/[0.04] transition-all text-left"
                        >
                          <Bot size={16} className="text-accent-secondary" />
                          <span>Subagents Swarm</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <button
            onClick={() => {
              if (isRecording) {
                stopRecording('insert')
              } else {
                toggleRecording()
              }
            }}
            disabled={disabled || isTranscribing}
            className={clsx(
              'flex h-8 w-8 items-center justify-center rounded-xl transition-all duration-200 border relative overflow-hidden group',
              isRecording
                ? 'bg-status-error/20 border-status-error/30 text-status-error animate-pulse'
                : isTranscribing
                  ? 'bg-accent-primary/20 border-accent-primary/30 text-accent-primary cursor-wait'
                  : 'bg-white/[0.028] border-white/[0.08] text-text-secondary hover:bg-white/[0.065] hover:text-text-primary'
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
              <StopCircle size={18} weight="fill" />
            ) : (
              <Microphone size={18} />
            )}
            {isRecording && (
              <div className="absolute inset-0 bg-status-error/10 animate-[ping_2s_ease-in-out_infinite]" />
            )}
          </button>

          {isRecording && (
            <button
              onClick={() => stopRecording('send')}
              disabled={disabled || isTranscribing}
              className="flex h-8 w-8 items-center justify-center rounded-xl border border-text-primary/20 bg-text-primary text-black transition-all duration-200 hover:bg-white active:scale-95"
              title="Stop and send"
            >
              <SendHorizontal size={14} weight="fill" />
            </button>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2 relative">
          {sessionMode === 'conversation' && (
            <div className="flex items-center gap-1.5 rounded-xl border border-white/[0.04] bg-white/[0.02] px-2.5 py-1.5 text-xs text-text-secondary select-none animate-soft-pop" title="Conversation Mode: Chat only">
              <ChatTeardropText size={14} className="text-text-muted" />
              <span className="text-[11px] text-text-muted">Chat Only</span>
            </div>
          )}
          {sessionMode === 'execution' && (
            <div className="flex items-center gap-1.5 rounded-xl border border-accent-primary/10 bg-accent-primary/5 px-2.5 py-1.5 text-xs text-accent-primary select-none animate-soft-pop" title="Execution Mode: Terminal & Tools enabled in user profile">
              <Lightning size={14} weight="fill" className="text-accent-primary" />
              <span className="text-[11px] font-medium">Execution</span>
            </div>
          )}
          {sessionMode === 'discipline' && (
            <div className="flex items-center gap-1.5 rounded-xl border border-accent-primary/15 bg-accent-primary/5 px-2.5 py-1.5 text-xs text-accent-primary select-none max-w-[160px] truncate animate-soft-pop" title={`Discipline Mode: Operating in ${disciplinePath || 'selected project folder'}`}>
              <Folder size={14} weight="fill" className="text-accent-primary" />
              <span className="text-[11px] font-medium truncate">{disciplinePath ? (disciplinePath.split(/[\\/]/).pop() || disciplinePath) : 'Discipline'}</span>
            </div>
          )}

          <ModelSelector
            selectedModel={selectedModel}
            onModelChange={onModelChange || (() => {})}
            isThinkMode={isThinkMode}
            onThinkModeToggle={onThinkModeToggle}
            disabled={disabled}
          />

          {isProcessing ? (
            <button
              onClick={() => onCancel?.()}
              className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-status-error/25 bg-status-error/[0.12] text-status-error transition-all duration-200 hover:bg-status-error/[0.18] active:scale-95"
              title="Stop generation"
            >
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={() => handleSend()}
              disabled={(!text.trim() && !attachedFile) || disabled}
              className={clsx(
                'ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-all duration-200',
                text.trim() && !disabled
                  ? activeMode === 'search'
                    ? 'bg-accent-secondary text-black hover:bg-accent-secondary/90 active:scale-95'
                    : activeMode === 'think'
                      ? 'bg-status-warning text-black hover:bg-status-warning/90 active:scale-95'
                      : 'bg-text-primary text-black hover:bg-white active:scale-95'
                  : 'bg-white/[0.055] text-text-muted'
              )}
            >
              <SendHorizontal size={14} />
            </button>
          )}
        </div>
      </div>
    )

    if (isFullscreen) {
      return (
        <div className="flex-1 flex flex-col w-full h-full p-5 sm:p-6 animate-fade-in relative z-20 pointer-events-auto">
          {/* Custom header */}
          <div className="flex items-center justify-between border-b border-white/[0.055] pb-4 mb-4 select-none">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-medium text-text-primary">Message Editor</h2>
            </div>
            <button
              onClick={onFullscreenToggle}
              className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.028] px-3.5 py-2 text-xs font-semibold text-text-secondary hover:bg-white/[0.065] hover:text-text-primary transition-all duration-200 active:scale-95"
              title="Exit fullscreen"
            >
              <Minimize2 size={14} />
              Minimize
            </button>
          </div>

          <div
            className={clsx(
              'premium-panel flex-1 flex flex-col rounded-[22px] border p-4 transition-all duration-300 relative input-border-glow',
              modeStyles,
              isFocused && 'prism-glow active',
              disabled && 'opacity-60'
            )}
          >
            {(attachedFile || isSearchEnabled) && (
              <div className="w-full pb-3 flex flex-wrap items-center justify-start gap-3 relative animate-soft-pop select-none">
                {attachedFile && (
                  <div className="relative group/thumb flex items-center gap-2">
                    {attachedFile.mimeType.startsWith('image/') ? (
                      <div className="relative">
                        <img
                          src={`data:${attachedFile.mimeType};base64,${attachedFile.data}`}
                          alt={attachedFile.name}
                          className="h-14 w-auto rounded-lg object-cover shadow-md border border-white/10"
                        />
                        <button
                          type="button"
                          onClick={onRemoveFile}
                          className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/85 text-text-secondary hover:text-white border border-white/10 transition-colors text-xs font-bold leading-none cursor-pointer"
                        >
                          &times;
                        </button>
                      </div>
                    ) : (
                      <div className="premium-panel-soft flex items-center gap-3 px-4 py-2 rounded-xl border border-white/[0.08] bg-white/[0.02] pr-10 relative">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.04] text-text-secondary">
                          {attachedFile.mimeType === 'application/pdf' ? (
                            <FilePdf size={20} className="text-status-error" />
                          ) : (
                            <FilePpt size={20} className="text-accent-primary" />
                          )}
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="text-xs font-semibold text-text-primary truncate max-w-[150px]">
                            {attachedFile.name}
                          </span>
                          <span className="text-[10px] text-text-secondary/60">
                            {attachedFile.mimeType === 'application/pdf'
                              ? 'PDF Document'
                              : 'Presentation'}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={onRemoveFile}
                          className="absolute top-1/2 -translate-y-1/2 right-3 text-text-secondary/50 hover:text-status-error transition-colors cursor-pointer"
                        >
                          <Trash size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {isSearchEnabled && (
                  <div className="premium-panel-soft flex items-center gap-3 px-4 py-2 rounded-xl border border-white/[0.08] bg-white/[0.02] pr-10 relative animate-soft-pop">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.04] text-text-secondary">
                      <Globe size={20} className="text-accent-secondary" />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-xs font-semibold text-text-primary">Web Search</span>
                      <span className="text-[10px] text-text-secondary/60">Active</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsSearchEnabled(false)}
                      className="absolute top-1/2 -translate-y-1/2 right-3 text-text-secondary/50 hover:text-status-error transition-colors cursor-pointer"
                    >
                      <Trash size={14} />
                    </button>
                  </div>
                )}
              </div>
            )}

            {!disabled && activeMode !== 'default' && (
              <div className="pointer-events-none absolute inset-x-4 top-0 h-px overflow-hidden">
                <div
                  className={clsx(
                    'h-px w-full opacity-80',
                    isSearchAndThinkMode
                      ? 'animate-[line-sweep_1800ms_cubic-bezier(0.2,0.82,0.2,1)_infinite] bg-[linear-gradient(to_right,transparent,var(--accent-secondary),var(--status-warning),transparent)]'
                      : [
                          'bg-gradient-to-r from-transparent via-current to-transparent',
                          activeMode === 'think' &&
                            'animate-[line-sweep_2100ms_cubic-bezier(0.2,0.82,0.2,1)_infinite]',
                          activeMode === 'search' &&
                            'animate-[line-sweep_1500ms_cubic-bezier(0.2,0.82,0.2,1)_infinite]'
                        ]
                  )}
                />
              </div>
            )}

            {isKeyMissing && (
              <div className="absolute inset-0 z-20 flex items-center justify-center rounded-[22px] bg-background-main/35 backdrop-blur-sm">
                <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.055] px-3 py-2 text-xs font-semibold text-text-secondary">
                  <Lock size={14} />
                  API key required
                </div>
              </div>
            )}

            {renderSlashMenu()}

            <div className="flex-1 relative flex flex-col min-h-[100px]">
              {activeWorkflow && (
                <div className="flex pb-2 select-none">
                  <div className="flex items-center gap-1.5 rounded-xl bg-accent-primary/15 border border-accent-primary/25 px-2.5 py-1 text-xs font-semibold text-accent-primary shrink-0 select-none animate-soft-pop">
                    <Lightning size={12} weight="fill" />
                    <span>{activeWorkflow.command}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveWorkflow?.(null)
                        inputRef.current?.focus()
                      }}
                      className="ml-1 text-accent-primary/60 hover:text-accent-primary font-bold cursor-pointer focus:outline-none"
                      title="Remove Workflow"
                    >
                      &times;
                    </button>
                  </div>
                </div>
              )}
              <textarea
                ref={inputRef}
                value={text}
                onChange={(e): void => setText(e.target.value)}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder={getPlaceholder()}
                disabled={disabled}
                className={clsx(
                  'w-full flex-1 resize-none bg-transparent py-2 text-lg font-medium outline-none border-0 border-transparent m-0 shadow-none leading-relaxed placeholder:text-text-muted disabled:cursor-not-allowed cursor-text text-text-primary selection:bg-accent-primary/30 whitespace-pre-wrap break-words',
                  isSearchAndThinkMode
                    ? 'caret-[#d9c77a]'
                    : activeMode === 'search'
                      ? 'caret-accent-secondary'
                      : activeMode === 'think'
                        ? 'caret-status-warning'
                        : 'caret-white'
                )}
              />
            </div>

            {renderBottomControls()}
          </div>
        </div>
      )
    }

    return (
      <div className="relative z-20 w-full max-w-[820px] mx-auto px-4 sm:px-8 pointer-events-auto">
        {showFullscreenBtn && (
          <button
            onClick={onFullscreenToggle}
            className="absolute -top-10 left-4 sm:left-8 flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-background-secondary/90 px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-white/[0.065] hover:text-text-primary transition-all duration-200 shadow-md backdrop-blur-md animate-soft-pop z-30"
          >
            <Maximize2 size={13} />
            Fullscreen
          </button>
        )}

        {renderSlashMenu()}

        <div className="relative">
          <div
            className={clsx(
              'premium-panel relative rounded-[22px] border transition-all duration-300 input-border-glow flex flex-col overflow-visible px-3.5 pt-3.5 pb-2.5',
              modeStyles,
              isFocused && !disabled && 'prism-glow active',
              disabled && 'opacity-60'
            )}
          >
            {(attachedFile || isSearchEnabled) && (
              <div className="w-full pb-3 flex flex-wrap items-center justify-start gap-3 relative animate-soft-pop select-none">
                {attachedFile && (
                  <div className="relative group/thumb flex items-center gap-2">
                    {attachedFile.mimeType.startsWith('image/') ? (
                      <div className="relative">
                        <img
                          src={`data:${attachedFile.mimeType};base64,${attachedFile.data}`}
                          alt={attachedFile.name}
                          className="h-14 w-auto rounded-lg object-cover shadow-md border border-white/10"
                        />
                        <button
                          type="button"
                          onClick={onRemoveFile}
                          className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/85 text-text-secondary hover:text-white border border-white/10 transition-colors text-xs font-bold leading-none cursor-pointer"
                        >
                          &times;
                        </button>
                      </div>
                    ) : (
                      <div className="premium-panel-soft flex items-center gap-3 px-4 py-2 rounded-xl border border-white/[0.08] bg-white/[0.02] pr-10 relative">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.04] text-text-secondary">
                          {attachedFile.mimeType === 'application/pdf' ? (
                            <FilePdf size={20} className="text-status-error" />
                          ) : (
                            <FilePpt size={20} className="text-accent-primary" />
                          )}
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="text-xs font-semibold text-text-primary truncate max-w-[150px]">
                            {attachedFile.name}
                          </span>
                          <span className="text-[10px] text-text-secondary/60">
                            {attachedFile.mimeType === 'application/pdf'
                              ? 'PDF Document'
                              : 'Presentation'}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={onRemoveFile}
                          className="absolute top-1/2 -translate-y-1/2 right-3 text-text-secondary/50 hover:text-status-error transition-colors cursor-pointer"
                        >
                          <Trash size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {isSearchEnabled && (
                  <div className="premium-panel-soft flex items-center gap-3 px-4 py-2 rounded-xl border border-white/[0.08] bg-white/[0.02] pr-10 relative animate-soft-pop">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.04] text-text-secondary">
                      <Globe size={20} className="text-accent-secondary" />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-xs font-semibold text-text-primary">Web Search</span>
                      <span className="text-[10px] text-text-secondary/60">Active</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsSearchEnabled(false)}
                      className="absolute top-1/2 -translate-y-1/2 right-3 text-text-secondary/50 hover:text-status-error transition-colors cursor-pointer"
                    >
                      <Trash size={14} />
                    </button>
                  </div>
                )}
              </div>
            )}

            {isKeyMissing && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-background-main/35 backdrop-blur-sm rounded-[22px]">
                <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.055] px-3 py-2 text-xs font-semibold text-text-secondary">
                  <Lock size={14} />
                  API key required
                </div>
              </div>
            )}

            {!disabled && activeMode !== 'default' && (
              <div className="pointer-events-none absolute inset-x-4 top-0 h-px overflow-hidden">
                <div
                  className={clsx(
                    'h-px w-full opacity-80',
                    isSearchAndThinkMode
                      ? 'animate-[line-sweep_1800ms_cubic-bezier(0.2,0.82,0.2,1)_infinite] bg-[linear-gradient(to_right,transparent,var(--accent-secondary),var(--status-warning),transparent)]'
                      : [
                          'bg-gradient-to-r from-transparent via-current to-transparent',
                          activeMode === 'think' &&
                            'animate-[line-sweep_2100ms_cubic-bezier(0.2,0.82,0.2,1)_infinite]',
                          activeMode === 'search' &&
                            'animate-[line-sweep_1500ms_cubic-bezier(0.2,0.82,0.2,1)_infinite]'
                        ]
                  )}
                />
              </div>
            )}

            <div className="w-full relative flex items-center min-w-[280px] gap-2">
              {activeWorkflow && (
                <div className="flex items-center gap-1.5 rounded-xl bg-accent-primary/15 border border-accent-primary/25 px-2.5 py-1 text-xs font-semibold text-accent-primary shrink-0 select-none animate-soft-pop">
                  <Lightning size={12} weight="fill" />
                  <span>{activeWorkflow.command}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveWorkflow?.(null)
                      inputRef.current?.focus()
                    }}
                    className="ml-1 text-accent-primary/60 hover:text-accent-primary font-bold cursor-pointer focus:outline-none"
                    title="Remove Workflow"
                  >
                    &times;
                  </button>
                </div>
              )}
              <textarea
                ref={inputRef}
                value={text}
                onChange={(e): void => setText(e.target.value)}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder={getPlaceholder()}
                disabled={disabled}
                className={clsx(
                  'relative z-10 w-full resize-none bg-transparent text-base font-medium outline-none border-0 border-transparent m-0 shadow-none leading-relaxed placeholder:text-text-muted disabled:cursor-not-allowed cursor-text block min-h-[48px] max-h-[300px] text-text-primary selection:bg-accent-primary/30 whitespace-pre-wrap break-words',
                  isSearchAndThinkMode
                    ? 'caret-[#d9c77a]'
                    : activeMode === 'search'
                      ? 'caret-accent-secondary'
                      : activeMode === 'think'
                        ? 'caret-status-warning'
                        : activeMode !== 'default'
                          ? 'caret-accent-primary'
                          : 'caret-white'
                )}
                rows={1}
              />
            </div>

            {renderBottomControls()}
          </div>
        </div>
      </div>
    )
  }
)

InputBar.displayName = 'InputBar'
