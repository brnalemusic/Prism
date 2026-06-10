import { useState, useRef, useImperativeHandle, forwardRef, useEffect } from 'react'
import {
  PaperPlaneRight as SendHorizontal,
  Stop as Square,
  PlayCircle as CirclePlay,
  Lock,
  Robot as Bot,
  CornersOut as Maximize2,
  CornersIn as Minimize2,
  CaretDown as ChevronDown,
  Microphone,
  StopCircle,
  Plus,
  Paperclip,
  Camera,
  SquaresFour as AppIcon,
  CaretRight,
  FilePdf,
  FilePpt,
  Trash
} from '@phosphor-icons/react'
import clsx from 'clsx'
import { useSpeechToText } from '../hooks/useSpeechToText'
import { ModelSelector } from './ModelSelector'
import { AttachedFile } from '../App'
import { triggerErrorPopup } from '../utils'

interface InputBarProps {
  onSend: (
    message: string,
    thinkMode?: boolean,
    searchEnabled?: boolean,
    extendedSearch?: boolean,
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
  isExtendedSearch: boolean
  setIsExtendedSearch: (val: boolean) => void
  isFullscreen: boolean
  onFullscreenToggle: () => void
  attachedFile?: AttachedFile | null
  onRemoveFile?: () => void
  onAttachFile?: (file: AttachedFile) => void
  onOpenScreenshotModal?: () => void
  onOpenSubagentModal?: () => void
  onOpenYoutubeModal?: () => void
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
      isExtendedSearch,
      setIsExtendedSearch,
      isFullscreen,
      onFullscreenToggle,
      attachedFile,
      onRemoveFile,
      onAttachFile,
      onOpenScreenshotModal,
      onOpenSubagentModal,
      onOpenYoutubeModal
    },
    ref
  ) => {
    const [isFocused, setIsFocused] = useState(false)
    const [showFullscreenBtn, setShowFullscreenBtn] = useState(false)
    const [showSearchDropdown, setShowSearchDropdown] = useState(false)
    const [showAttachMenu, setShowAttachMenu] = useState(false)
    const [showAppsMenu, setShowAppsMenu] = useState(false)

    const inputRef = useRef<HTMLTextAreaElement>(null)
    const searchDropdownRef = useRef<HTMLDivElement>(null)
    const searchButtonRef = useRef<HTMLButtonElement>(null)
    const attachMenuRef = useRef<HTMLDivElement>(null)
    const attachButtonRef = useRef<HTMLButtonElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const shouldSendRef = useRef(false)

    const { isRecording, isTranscribing, toggleRecording } = useSpeechToText((transcription) => {
      const newText = textRef.current.trim()
        ? textRef.current + '\n\n' + transcription
        : transcription
      setText(newText)

      if (shouldSendRef.current) {
        shouldSendRef.current = false
        handleSend(newText)
      }

      setTimeout(() => inputRef.current?.focus(), 100)
    })

    const isSearchAndThinkMode = isSearchEnabled && isThinkMode
    const activeMode = isExtendedSearch
        ? 'extended'
        : isSearchEnabled
          ? 'search'
          : isThinkMode
            ? 'think'
            : 'default'

    // TODO: Hardcoded slash commands like /search, /youtube, and /subagents have been removed from the slash menu.
    // In the future, slash commands will be dynamically generated based on settings-defined workflows.
    // The user will be able to customize commands via system instructions and tool constraints in their configuration files.
    // This removes hardcoded UI behaviors and moves command execution to a workflows-driven system.

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

    // Global keyboard shortcuts (Ctrl+S, Ctrl+E, Ctrl+T, Ctrl+Y, Ctrl+D)
    useEffect(() => {
      const handleGlobalKeyDown = (e: KeyboardEvent): void => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
          e.preventDefault()
          if (isRecording) {
            shouldSendRef.current = true
          }
          toggleRecording()
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
          e.preventDefault()
          const nextVal = !isSearchEnabled
          setIsSearchEnabled(nextVal)
          if (!nextVal) {
            setIsExtendedSearch(false)
          }
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
          e.preventDefault()
          const nextVal = !isExtendedSearch
          setIsExtendedSearch(nextVal)
          if (nextVal) {
            setIsSearchEnabled(true)
          }
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 't') {
          e.preventDefault()
          onThinkModeToggle?.(!isThinkMode)
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
          e.preventDefault()
          setIsSearchEnabled(false)
          setIsExtendedSearch(false)
          onOpenYoutubeModal?.()
        }
      }
      window.addEventListener('keydown', handleGlobalKeyDown)
      return () => window.removeEventListener('keydown', handleGlobalKeyDown)
    }, [
      isThinkMode,
      onThinkModeToggle,
      selectedModel,
      isSearchEnabled,
      isExtendedSearch,
      setIsSearchEnabled,
      setIsExtendedSearch,
      setText,
      isRecording
    ])

    useEffect(() => {
      const handleClickOutside = (event: MouseEvent): void => {
        const isClickInsideDropdown =
          searchDropdownRef.current && searchDropdownRef.current.contains(event.target as Node)
        const isClickOnButton =
          searchButtonRef.current && searchButtonRef.current.contains(event.target as Node)

        if (!isClickInsideDropdown && !isClickOnButton) {
          setShowSearchDropdown(false)
        }

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
          finalMessage = isSearchEnabled ? `[FORCE_SEARCH] ${trimmedText}` : trimmedText
        }

        onSend(
          finalMessage,
          isThinkMode,
          isSearchEnabled,
          isExtendedSearch,
          attachedFile?.mimeType.startsWith('image/') ? attachedFile.data : undefined,
          attachedFile || undefined
        )
        setText('')

        if (isFullscreen) {
          onFullscreenToggle()
        }

        setTimeout(() => {
          inputRef.current?.focus()
        }, 0)
      }
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
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
      if (isSearchAndThinkMode) return 'Search, and then Think Deeply with Prism'
      if (isExtendedSearch) return 'Search deeply with Extended Search'
      if (isSearchEnabled) return 'Search the web with Prism'
      if (isThinkMode) return 'Ask Prism to think deeply'
      return 'Ask Prism'
    }

    const modeStyles = {
      youtube: 'border-accent-primary/30 bg-accent-primary/[0.045] text-accent-primary',
      extended: 'border-accent-primary/35 bg-accent-primary/[0.045] text-accent-primary',
      search: isSearchAndThinkMode
        ? 'border-[#8ee8b0]/25 bg-[linear-gradient(110deg,rgba(45,212,191,0.055),rgba(245,158,11,0.06))] text-[#d9c77a]'
        : 'border-accent-secondary/30 bg-accent-secondary/[0.045] text-accent-secondary',
      think: 'border-status-warning/30 bg-status-warning/[0.045] text-status-warning',
      default: 'border-white/[0.09] bg-white/[0.035] text-text-primary'
    }[activeMode]

    const searchLabel = isExtendedSearch
      ? 'Extended Search'
      : isSearchEnabled
        ? 'Search Default'
        : 'Search Disabled'

    const renderSearchDropdown = (): React.JSX.Element => (
      <div
        ref={searchDropdownRef}
        className="absolute bottom-full right-0 mb-2 z-50 w-72 rounded-2xl border border-white/[0.12] bg-background-main p-2 shadow-2xl animate-soft-pop text-left opacity-100"
      >
        <div className="px-3 py-1.5 text-[11px] font-semibold text-text-secondary/70 border-b border-white/[0.04] mb-1">
          Web Search Mode
        </div>
        <button
          onClick={() => {
            setIsSearchEnabled(true)
            setIsExtendedSearch(false)
            setShowSearchDropdown(false)
          }}
          className={clsx(
            'w-full flex flex-col gap-0.5 rounded-xl px-3 py-2.5 transition-all text-left',
            isSearchEnabled && !isExtendedSearch
              ? 'bg-accent-secondary/[0.12] text-accent-secondary border border-accent-secondary/20'
              : 'border border-transparent hover:bg-white/[0.04] text-text-primary'
          )}
        >
          <div className="font-semibold text-xs text-text-primary">Default</div>
          <div className="text-[10px] text-text-secondary/70 leading-normal font-medium">
            Search on Web in Default Mode. Commonly faster.
          </div>
        </button>

        <button
          onClick={() => {
            setIsSearchEnabled(true)
            setIsExtendedSearch(true)
            setShowSearchDropdown(false)
          }}
          className={clsx(
            'w-full flex flex-col gap-0.5 rounded-xl px-3 py-2.5 transition-all text-left mt-1',
            isSearchEnabled && isExtendedSearch
              ? 'bg-accent-primary/[0.12] text-accent-primary border border-accent-primary/20'
              : 'border border-transparent hover:bg-white/[0.04] text-text-primary'
          )}
        >
          <div className="font-semibold text-xs text-text-primary">Extended</div>
          <div className="text-[10px] text-text-secondary/70 leading-normal font-medium">
            Super deep grounding and analisys for ultra-detailed outputs. Can be very slow.
          </div>
        </button>

        {isSearchEnabled && (
          <button
            onClick={() => {
              setIsSearchEnabled(false)
              setIsExtendedSearch(false)
              setShowSearchDropdown(false)
            }}
            className="w-full mt-2 rounded-xl px-3 py-2 text-xs font-semibold text-center text-status-error hover:bg-status-error/[0.08] transition-all border border-transparent hover:border-status-error/10"
          >
            Disable Search
          </button>
        )}
      </div>
    )

    const renderBottomControls = (): React.JSX.Element => (
      <div className="flex w-full items-center justify-between border-t border-white/[0.055] pt-2 mt-2 select-none relative z-20">
        <div className="flex-1 flex items-center gap-2">
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
                'flex h-8 w-8 items-center justify-center rounded-xl transition-all duration-200 border border-white/10 bg-white/[0.035] text-text-secondary hover:bg-white/[0.08] hover:text-text-primary cursor-pointer',
                showAttachMenu && 'bg-white/[0.08] text-text-primary border-white/20'
              )}
              title="Add attachment / App"
            >
              <Plus size={16} weight="bold" />
            </button>

            {showAttachMenu && (
              <div className="absolute bottom-full left-0 mb-2 z-[60] w-48 rounded-2xl border border-white/[0.12] bg-background-main p-1.5 shadow-2xl animate-soft-pop text-left">
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
                      <div className="w-44 rounded-2xl border border-white/[0.12] bg-background-main p-1.5 shadow-2xl animate-soft-pop text-left">
                        <button
                          onClick={() => {
                            setIsSearchEnabled(false)
                            setIsExtendedSearch(false)
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
            onClick={toggleRecording}
            disabled={disabled || isTranscribing}
            className={clsx(
              'flex h-8 w-8 items-center justify-center rounded-xl transition-all duration-200 border relative overflow-hidden group',
              isRecording
                ? 'bg-status-error/20 border-status-error/30 text-status-error animate-pulse'
                : isTranscribing
                  ? 'bg-accent-primary/20 border-accent-primary/30 text-accent-primary cursor-wait'
                  : 'bg-white/[0.035] border-white/10 text-text-secondary hover:bg-white/[0.08] hover:text-text-primary'
            )}
            title={isRecording ? 'Stop Recording' : 'Start Dictation'}
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
        </div>

        <div className="flex items-center gap-2 relative">
          <ModelSelector
            selectedModel={selectedModel}
            onModelChange={onModelChange || (() => {})}
            isThinkMode={isThinkMode}
            onThinkModeToggle={onThinkModeToggle}
            disabled={disabled}
          />

          <div className="relative">
            <button
              ref={searchButtonRef}
              onClick={() => setShowSearchDropdown(!showSearchDropdown)}
              disabled={disabled}
              className={clsx(
                'flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold outline-none transition-all duration-200 border border-transparent hover:bg-white/[0.055] hover:border-white/10',
                showSearchDropdown
                  ? 'bg-white/[0.08] text-text-primary border-white/10'
                  : 'bg-transparent',
                isSearchEnabled
                  ? 'text-accent-secondary'
                  : isExtendedSearch
                    ? 'text-accent-primary'
                    : 'text-text-secondary',
                disabled && 'cursor-not-allowed opacity-50'
              )}
            >
              <span>{searchLabel}</span>
              <ChevronDown
                size={12}
                className={clsx(
                  'text-text-secondary/70 transition-transform duration-200',
                  showSearchDropdown && 'rotate-180'
                )}
              />
            </button>
            {showSearchDropdown && !disabled && renderSearchDropdown()}
          </div>

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
                  ? activeMode === 'extended'
                    ? 'bg-accent-primary text-black hover:bg-accent-primary/90 active:scale-95'
                    : activeMode === 'search'
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
        <div className="flex-1 flex flex-col w-full h-full p-6 animate-fade-in relative z-20 pointer-events-auto">
          {/* Custom header */}
          <div className="flex items-center justify-between border-b border-white/[0.055] pb-4 mb-4 select-none">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-semibold text-text-primary">Message Editor</h2>
            </div>
            <button
              onClick={onFullscreenToggle}
              className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.035] px-4 py-2 text-xs font-semibold text-text-secondary hover:bg-white/[0.08] hover:text-text-primary transition-all duration-200 active:scale-95"
              title="Exit fullscreen"
            >
              <Minimize2 size={14} />
              Minimize
            </button>
          </div>

          <div
            className={clsx(
              'premium-panel flex-1 flex flex-col rounded-[24px] border p-4 transition-all duration-300 relative input-border-glow',
              modeStyles,
              isFocused && 'prism-glow active',
              disabled && 'opacity-60'
            )}
          >
            {attachedFile && (
              <div className="w-full pb-3 flex items-center justify-start relative animate-soft-pop select-none">
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
                            'animate-[line-sweep_1500ms_cubic-bezier(0.2,0.82,0.2,1)_infinite]',
                          activeMode === 'extended' &&
                            'animate-[line-sweep_1200ms_cubic-bezier(0.2,0.82,0.2,1)_infinite]'
                        ]
                  )}
                />
              </div>
            )}

            {isKeyMissing && (
              <div className="absolute inset-0 z-20 flex items-center justify-center rounded-[24px] bg-background-main/35 backdrop-blur-sm">
                <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.055] px-3 py-2 text-xs font-semibold text-text-secondary">
                  <Lock size={14} />
                  API key required
                </div>
              </div>
            )}

            {/* TODO: Legacy slash menu was rendered here. Hardcoded slash commands are deprecated in favor of user-customizable workflows. */}

            <div className="flex-1 relative flex flex-col min-h-[100px]">
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
                        : activeMode !== 'default'
                          ? 'caret-accent-primary'
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
      <div className="relative z-20 w-full max-w-4xl mx-auto px-6 sm:px-12 pointer-events-auto">
        {showFullscreenBtn && (
          <button
            onClick={onFullscreenToggle}
            className="absolute -top-10 left-6 sm:left-12 flex items-center gap-1.5 rounded-full border border-white/10 bg-background-secondary/90 px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-white/[0.08] hover:text-text-primary transition-all duration-200 shadow-md backdrop-blur-md animate-soft-pop z-30"
          >
            <Maximize2 size={13} />
            Fullscreen
          </button>
        )}

        {/* TODO: Legacy slash menu was rendered here. Hardcoded slash commands are deprecated in favor of user-customizable workflows. */}

        <div className="relative">
          <div
            className={clsx(
              'premium-panel relative rounded-[28px] border transition-all duration-300 input-border-glow flex flex-col overflow-visible px-4 pt-4 pb-2',
              modeStyles,
              isFocused && !disabled && 'prism-glow active',
              disabled && 'opacity-60'
            )}
          >
            {attachedFile && (
              <div className="w-full pb-3 flex items-center justify-start relative animate-soft-pop select-none">
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
              </div>
            )}

            {isKeyMissing && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-background-main/35 backdrop-blur-sm rounded-[28px]">
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
                            'animate-[line-sweep_1500ms_cubic-bezier(0.2,0.82,0.2,1)_infinite]',
                          activeMode === 'extended' &&
                            'animate-[line-sweep_1200ms_cubic-bezier(0.2,0.82,0.2,1)_infinite]'
                        ]
                  )}
                />
              </div>
            )}

            <div className="w-full relative flex items-center min-w-[280px]">
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
