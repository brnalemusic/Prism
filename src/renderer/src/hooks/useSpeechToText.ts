import { useState, useRef } from 'react'

export function useSpeechToText(onTranscription: (text: string) => void): {
  isRecording: boolean
  isTranscribing: boolean
  toggleRecording: () => void
  startRecording: () => Promise<void>
  stopRecording: () => void
} {
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])

  const startRecording = async (): Promise<void> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder
      audioChunksRef.current = []

      mediaRecorder.ondataavailable = (event): void => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      mediaRecorder.onstop = async (): Promise<void> => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })

        if (audioBlob.size === 0) {
          return
        }

        const reader = new FileReader()
        reader.onloadend = async (): Promise<void> => {
          const base64Audio = (reader.result as string).split(',')[1]
          setIsTranscribing(true)
          try {
            // @ts-ignore (api is exposed via preload)
            const transcription = await window.api.transcribeAudio(base64Audio)
            if (transcription) {
              onTranscription(transcription)
            }
          } catch (err) {
            console.error('[RECORDER] Transcription IPC failed:', err)
          } finally {
            setIsTranscribing(false)
          }
        }
        reader.onerror = (e): void => console.error('[RECORDER] FileReader error:', e)
        reader.readAsDataURL(audioBlob)
        stream.getTracks().forEach((track) => track.stop())
      }

      mediaRecorder.start()
      setIsRecording(true)
    } catch (err) {
      console.error('Error accessing microphone:', err)
    }
  }

  const stopRecording = (): void => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
    }
  }

  const toggleRecording = (): void => {
    if (isRecording) {
      stopRecording()
    } else {
      startRecording()
    }
  }

  return {
    isRecording,
    isTranscribing,
    toggleRecording,
    startRecording,
    stopRecording
  }
}
