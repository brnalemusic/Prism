import { useState, useEffect, useCallback, useRef } from 'react'
import { Keyboard, X } from 'lucide-react'
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

  const displayValue = isRecording
    ? recordedKeys.length > 0
      ? recordedKeys.join(' + ')
      : 'Pressione as teclas...'
    : value || 'Nenhum atalho definido'

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={containerRef}
        onClick={startRecording}
        className={clsx(
          'relative group cursor-pointer bg-surface/50 border rounded-xl px-4 py-3 transition-all flex items-center justify-between',
          isRecording
            ? 'border-accent-primary ring-2 ring-accent-primary/20 bg-accent-primary/5'
            : 'border-surface/50 hover:border-accent-primary/50'
        )}
      >
        <div className="flex items-center gap-3">
          <Keyboard
            size={18}
            className={clsx(isRecording ? 'text-accent-primary' : 'text-text-secondary/40')}
          />
          <span
            className={clsx(
              'text-sm font-medium',
              isRecording
                ? 'text-accent-primary'
                : value
                  ? 'text-text-primary'
                  : 'text-text-secondary/40'
            )}
          >
            {displayValue}
          </span>
        </div>

        {isRecording ? (
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider font-bold text-accent-primary animate-pulse">
              Gravando
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                stopRecording()
              }}
              className="p-1 hover:bg-surface rounded-md transition-colors"
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
              className="opacity-0 group-hover:opacity-100 p-1 hover:bg-surface rounded-md transition-colors text-text-secondary/40 hover:text-text-primary"
            >
              <X size={14} />
            </button>
          )
        )}
      </div>
      <p className="text-[10px] text-text-secondary/40 italic flex justify-between">
        <span>{isRecording ? 'Pressione ESC para cancelar' : 'Clique para alterar o atalho'}</span>
        {value && !isRecording && <span>Backspace para limpar</span>}
      </p>
    </div>
  )
}
