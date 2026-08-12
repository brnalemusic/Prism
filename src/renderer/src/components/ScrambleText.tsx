import React, { useState, useEffect, useRef } from 'react'

const MATRIX_CHARS = '!@#$%^&*()_+-=[]{}|;:,.<>?/ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

interface ScrambleTextProps {
  text: string
  className?: string
  duration?: number
  triggerKey?: any
}

export const ScrambleText: React.FC<ScrambleTextProps> = ({
  text,
  className = '',
  duration = 900,
  triggerKey
}) => {
  const [displayText, setDisplayText] = useState(text)
  const animFrameRef = useRef<number | null>(null)

  useEffect(() => {
    if (!text) return

    const startTime = performance.now()
    const targetLength = text.length

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime
      const progress = Math.min(elapsed / duration, 1)
      const revealedLength = Math.floor(progress * targetLength)

      let result = ''
      for (let i = 0; i < targetLength; i++) {
        if (text[i] === ' ') {
          result += ' '
        } else if (i < revealedLength) {
          result += text[i]
        } else {
          result += MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)]
        }
      }

      setDisplayText(result)

      if (progress < 1) {
        animFrameRef.current = requestAnimationFrame(animate)
      } else {
        setDisplayText(text)
      }
    }

    animFrameRef.current = requestAnimationFrame(animate)

    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current)
      }
    }
  }, [text, duration, triggerKey])

  return <span className={className}>{displayText}</span>
}
