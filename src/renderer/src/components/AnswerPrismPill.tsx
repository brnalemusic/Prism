import { useCallback, useEffect, useRef } from 'react'
import { Quotes } from '@phosphor-icons/react'
import { LiquidGlassSurface } from './LiquidGlassSurface'

interface AnswerPrismPillProps {
  onAnswer: (text: string) => void
}

const HIDDEN = 'hidden'

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value))

/**
 * Floating "Answer Prism" pill over selected AI text.
 *
 * Stability contract: selectionchange fires dozens of times per drag. The
 * handler is rAF-throttled and every update — show, hide, move — is a
 * direct DOM write on the ref'd node. React renders the pill exactly once;
 * no state change ever re-renders it, so no React commit can race the
 * selection stream (the previous mounted/hidden state machine flickered
 * and stuck hidden under exactly such a race). While hidden
 * (display:none), the IntersectionObserver inside LiquidGlassSurface keeps
 * the optics unmounted, so the idle cost is one empty span.
 */
export function AnswerPrismPill({ onAnswer }: AnswerPrismPillProps): React.JSX.Element {
  const nodeRef = useRef<HTMLDivElement>(null)
  const textRef = useRef('')
  const rafRef = useRef(0)
  const pendingRef = useRef<{ x: number; y: number; text: string; visible: boolean } | null>(null)

  const flush = useCallback((): void => {
    rafRef.current = 0
    const next = pendingRef.current
    pendingRef.current = null
    const node = nodeRef.current
    if (!node || !next) return

    if (!next.visible || !next.text) {
      node.classList.add(HIDDEN)
      return
    }
    textRef.current = next.text
    node.style.left = `${clamp(next.x, 90, window.innerWidth - 90)}px`
    node.style.top = `${clamp(next.y - 12, 46, window.innerHeight - 60)}px`
    node.classList.remove(HIDDEN)
  }, [])

  const schedule = useCallback((): void => {
    if (!rafRef.current) rafRef.current = requestAnimationFrame(flush)
  }, [flush])

  useEffect(() => {
    const onSelectionChange = (): void => {
      const selection = window.getSelection()
      const text = selection?.toString().trim() ?? ''
      let visible = false
      let x = 0
      let y = 0
      if (
        selection &&
        !selection.isCollapsed &&
        selection.rangeCount > 0 &&
        text.length > 0 &&
        selection.anchorNode &&
        selection.focusNode
      ) {
        const anchorEl =
          selection.anchorNode instanceof Element
            ? selection.anchorNode
            : selection.anchorNode.parentElement
        const focusEl =
          selection.focusNode instanceof Element
            ? selection.focusNode
            : selection.focusNode.parentElement
        const aiAnchor = anchorEl?.closest('[data-prism-ai-message="true"]')
        const aiFocus = focusEl?.closest('[data-prism-ai-message="true"]')
        if (aiAnchor && aiFocus && aiAnchor === aiFocus) {
          try {
            const rect = selection.getRangeAt(0).getBoundingClientRect()
            if (rect.width > 0 || rect.height > 0) {
              x = rect.left + rect.width / 2
              y = rect.top
              visible = true
            }
          } catch {
            // Degenerate range mid-drag; treat as no selection.
          }
        }
      }
      pendingRef.current = { x, y, text: visible ? text : '', visible }
      schedule()
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
      pendingRef.current = null
    }
  }, [])

  const handleAnswer = useCallback((): void => {
    if (textRef.current) onAnswer(textRef.current)
  }, [onAnswer])

  return (
    <div
      ref={nodeRef}
      className={`true-glass fixed z-[80] flex items-center justify-center rounded-xl px-3.5 py-1.5 select-none cursor-pointer border border-white/10 hover:border-accent-secondary/40 shadow-[0_8px_32px_rgba(0,0,0,0.5)] transition-colors duration-150 active:scale-95 group ${HIDDEN}`}
      style={{ left: 0, top: 0, transform: 'translate(-50%, -100%) translateY(-10px)' }}
      onMouseDown={(e) => {
        // Preserve the user's text selection: never steal the caret.
        e.preventDefault()
        e.stopPropagation()
      }}
      onClick={handleAnswer}
      role="button"
      aria-label="Answer Prism"
      title="Answer Prism"
    >
      <LiquidGlassSurface
        refraction={16}
        blur={1.5}
        opacity={0.3}
        specular={0.14}
        distortionRadius={18}
      />
      <Quotes
        size={14}
        weight="bold"
        className="mr-1.5 text-accent-secondary transition-transform group-hover:scale-110"
      />
      <span className="text-xs font-semibold text-text-primary transition-colors duration-150 group-hover:text-accent-secondary">
        Answer Prism
      </span>
    </div>
  )
}
