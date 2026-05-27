import React, { useState, useRef, useEffect } from 'react'
import { Volume2, Square } from 'lucide-react'
import { Spinner } from './Spinner'
import { clsx } from 'clsx'
import { triggerErrorPopup } from '../utils'

export interface TtsButtonProps {
  text: string
  className?: string
}

export function TtsButton({ text, className }: TtsButtonProps): React.JSX.Element {
  const [status, setStatus] = useState<'idle' | 'loading' | 'playing' | 'error'>('idle')
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    // Cleanup audio object when component unmounts
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.src = ''
        audioRef.current = null
      }
    }
  }, [])

  const handlePlay = async (): Promise<void> => {
    if (status === 'playing') {
      // Stop the currently playing audio
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.currentTime = 0
      }
      setStatus('idle')
      return
    }

    if (!text || text.trim() === '') return

    try {
      setStatus('loading')
      
      // Clean up text before sending
      const cleanText = text.replace(/<[^>]*>?/gm, '').trim()
      
      const audioDataUri = await window.api.generateTts(cleanText)
      
      if (!audioDataUri) {
        throw new Error('No audio data received')
      }

      const audio = new Audio(audioDataUri)
      audioRef.current = audio

      audio.onended = () => {
        setStatus('idle')
      }
      
      audio.onerror = () => {
        console.error('Audio playback error')
        setStatus('error')
        triggerErrorPopup('TTS playback error')
        setTimeout(() => setStatus('idle'), 2000)
      }

      await audio.play()
      setStatus('playing')

    } catch (error) {
      console.error('TTS Generation failed:', error)
      setStatus('error')
      triggerErrorPopup(error)
      setTimeout(() => setStatus('idle'), 2000)
    }
  }

  return (
    <button
      onClick={handlePlay}
      disabled={status === 'loading'}
      title="Listen to message"
      className={clsx(
        'flex items-center justify-center p-1.5 rounded-full transition-all duration-200',
        'hover:bg-white/10 text-text-secondary/70 hover:text-text-primary',
        status === 'playing' && 'text-accent-secondary bg-accent-secondary/10 hover:bg-accent-secondary/20 hover:text-accent-secondary',
        status === 'error' && 'text-red-500 hover:text-red-400',
        className
      )}
    >
      {status === 'loading' ? (
        <Spinner size="xs" className="text-text-secondary" />
      ) : status === 'playing' ? (
        <Square size={14} className="fill-current" />
      ) : (
        <Volume2 size={16} />
      )}
    </button>
  )
}
