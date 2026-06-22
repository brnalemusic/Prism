import React, { useState } from 'react'
import { Copy, Check } from '@phosphor-icons/react'
import { clsx } from 'clsx'

export interface CopyMessageButtonProps {
  text: string
  className?: string
  title?: string
}

export function CopyMessageButton({ text, className, title = 'Copy message' }: CopyMessageButtonProps): React.JSX.Element {
  const [copied, setCopied] = useState(false)

  const handleCopy = async (): Promise<void> => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy text: ', err)
    }
  }

  return (
    <button
      onClick={handleCopy}
      title={copied ? 'Copied!' : title}
      className={clsx(
        'flex items-center justify-center p-1.5 rounded-full transition-all duration-200',
        'hover:bg-white/10 text-text-secondary/70 hover:text-text-primary',
        copied && 'text-accent-secondary bg-accent-secondary/10 hover:bg-accent-secondary/20',
        className
      )}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  )
}
