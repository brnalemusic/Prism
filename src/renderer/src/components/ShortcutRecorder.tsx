import { useState, useEffect, useCallback, useRef } from 'react'
import { Keyboard, X } from '@phosphor-icons/react'
import clsx from 'clsx'

interface ShortcutRecorderProps {
  value: string
  onChange: (newValue: string) => void
}

export function ShortcutRecorder({ value, onChange }: ShortcutRecorderProps): React.JSX.Element {
  const [isRecording, setIsRecording] = useState(false)
  const [recordedKeys, setRecordedKeys] = useState<string[]>([])
  const containerRef = useRef<HTMLDivElement>(null)

  const startRecording = (): void => {
    setIsRecording(true)
    setRecordedKeys([])
  }

  const stopRecording = (): void => {
    setIsRecording(false)
  }

  const handleKeyDown = useCallback(
    (e: KeyboardEvent): void => {
      if (!isRecording) return

      e.preventDefault()
      e.stopPropagation()

      if (e.key === 'Escape') {
        stopRecording()
        return
      }

      if (e.key === 'Backspace' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        onChange('')
        stopRecording()
        return
      }

      const keys: string[] = []
      if (e.ctrlKey) keys.push('Control')
      if (e.shiftKey) keys.push('Shift')
      if (e.altKey) keys.push('Alt')
      if (e.metaKey) keys.push('Command')

      // Add the main key if it's not a modifier itself
      const modifierKeys = ['Control', 'Shift', 'Alt', 'Meta', 'CapsLock', 'Tab']
      if (!modifierKeys.includes(e.key)) {
        let key = e.key
        if (key === ' ') key = 'Space'
        if (key.length === 1) key = key.toUpperCase()
        if (key === 'ArrowUp') key = 'Up'
        if (key === 'ArrowDown') key = 'Down'
        if (key === 'ArrowLeft') key = 'Left'
        if (key === 'ArrowRight') key = 'Right'

        // Prevent duplicates if modifier was already added (though e.key for modifiers is different)
        if (!keys.includes(key)) {
          keys.push(key)
        }

        // If we have at least one modifier and a main key, or just a function key
        const hasModifier = e.ctrlKey || e.shiftKey || e.altKey || e.metaKey
        const isFunctionKey = /^F[1-9][0-9]?$/.test(key)

        if (hasModifier || isFunctionKey) {
          // Map keys to Electron's Accelerator format
          const mappedKeys = keys.map((k) => {
            if (k === 'Control' || k === 'Command') return 'CommandOrControl'
            return k
          })

          // Remove duplicates (e.g., if both Ctrl and Cmd were pressed, they both map to CommandOrControl)
          const uniqueKeys = Array.from(new Set(mappedKeys))
          const shortcut = uniqueKeys.join('+')

          onChange(shortcut)
          stopRecording()
        }
      }

      setRecordedKeys(keys)
    },
    [isRecording, onChange]
  )

  useEffect(() => {
    if (isRecording) {
      window.addEventListener('keydown', handleKeyDown, true)
    } else {
      window.removeEventListener('keydown', handleKeyDown, true)
    }
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [isRecording, handleKeyDown])

  const renderShortcutKeys = (): React.JSX.Element => {
    if (isRecording) {
      if (recordedKeys.length === 0) {
        return (
          <span className="text-sm font-medium text-accent-primary animate-pulse">
            Press keys...
          </span>
        )
      }
      return (
        <div className="flex items-center gap-1.5 select-none">
          {recordedKeys.map((key, idx) => {
            let displayKey = key
            if (
              displayKey === 'Control' ||
              displayKey === 'Command' ||
              displayKey === 'CommandOrControl' ||
              displayKey === 'CmdOrCtrl'
            ) {
              displayKey = 'Ctrl'
            }
            return (
              <span key={idx} className="flex items-center gap-1.5">
                <kbd className="px-2 py-1 text-xs font-mono font-bold rounded bg-white/10 border border-white/20 shadow-sm text-accent-primary">
                  {displayKey}
                </kbd>
                {idx < recordedKeys.length - 1 && (
                  <span className="text-xs font-light text-text-secondary/40 select-none">+</span>
                )}
              </span>
            )
          })}
        </div>
      )
    }

    if (!value) {
      return <span className="text-sm font-medium text-text-secondary/40">No shortcut set</span>
    }

    const parts = value.split('+').map((p) => {
      const clean = p.trim()
      if (
        clean === 'CommandOrControl' ||
        clean === 'Control' ||
        clean === 'CmdOrCtrl' ||
        clean === 'Command'
      ) {
        return 'Ctrl'
      }
      return clean
    })

    return (
      <div className="flex items-center gap-1.5 select-none">
        {parts.map((part, idx) => (
          <span key={idx} className="flex items-center gap-1.5">
            <kbd className="px-2 py-1 text-xs font-mono font-bold rounded bg-white/10 border border-white/20 shadow-sm text-text-primary">
              {part}
            </kbd>
            {idx < parts.length - 1 && (
              <span className="text-xs font-light text-text-secondary/40 select-none">+</span>
            )}
          </span>
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={containerRef}
        onClick={startRecording}
        className={clsx(
          'premium-control relative group flex cursor-pointer items-center justify-between rounded-[18px] border px-4 py-3 transition-all',
          isRecording
            ? 'border-accent-primary/40 bg-accent-primary/[0.07] ring-2 ring-accent-primary/15'
            : 'border-white/[0.08] hover:border-accent-primary/35'
        )}
      >
        <div className="flex items-center gap-3">
          <Keyboard
            size={18}
            className={clsx(isRecording ? 'text-accent-primary' : 'text-text-secondary/40')}
          />
          {renderShortcutKeys()}
        </div>

        {isRecording ? (
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-accent-primary animate-pulse">
              Recording
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                stopRecording()
              }}
              className="rounded-xl p-1 transition-colors hover:bg-white/[0.08]"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          value && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onChange('')
              }}
              className="rounded-xl p-1 text-text-secondary/40 opacity-0 transition-colors hover:bg-white/[0.08] hover:text-text-primary group-hover:opacity-100"
            >
              <X size={14} />
            </button>
          )
        )}
      </div>
      <p className="flex justify-between text-[11px] text-text-secondary/50">
        <span>{isRecording ? 'Press ESC to cancel' : 'Click to change shortcut'}</span>
        {value && !isRecording && <span>Backspace to clear</span>}
      </p>
    </div>
  )
}
