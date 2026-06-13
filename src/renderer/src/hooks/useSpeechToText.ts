import { useEffect, useRef, useState } from 'react'

export type SpeechToTextAction = 'insert' | 'send'

export function useSpeechToText(
  onTranscription: (text: string, action: SpeechToTextAction) => void
): {
  isRecording: boolean
  isTranscribing: boolean
  toggleRecording: (stopAction?: SpeechToTextAction) => void
  startRecording: () => Promise<void>
  stopRecording: (action?: SpeechToTextAction) => void
} {
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const isRecordingRef = useRef(false)
  const pendingActionRef = useRef<SpeechToTextAction>('insert')
  const onTranscriptionRef = useRef(onTranscription)

  useEffect(() => {
    onTranscriptionRef.current = onTranscription
  }, [onTranscription])

  const setRecordingState = (nextValue: boolean): void => {
    isRecordingRef.current = nextValue
    setIsRecording(nextValue)
  }

  const startRecording = async (): Promise<void> => {
    if (isRecordingRef.current || mediaRecorderRef.current?.state === 'recording') {
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder
      audioChunksRef.current = []
      pendingActionRef.current = 'insert'

      mediaRecorder.ondataavailable = (event): void => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      mediaRecorder.onstop = async (): Promise<void> => {
        setRecordingState(false)
        stream.getTracks().forEach((track) => track.stop())

        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        const transcriptionAction = pendingActionRef.current
        pendingActionRef.current = 'insert'

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
              onTranscriptionRef.current(transcription, transcriptionAction)
            }
          } catch (err) {
            console.error('[RECORDER] Transcription IPC failed:', err)
          } finally {
            setIsTranscribing(false)
          }
        }
        reader.onerror = (e): void => console.error('[RECORDER] FileReader error:', e)
        reader.readAsDataURL(audioBlob)
      }

      mediaRecorder.start()
      setRecordingState(true)
    } catch (err) {
      setRecordingState(false)
      console.error('Error accessing microphone:', err)
    }
  }

  const stopRecording = (action: SpeechToTextAction = 'insert'): void => {
    const mediaRecorder = mediaRecorderRef.current
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      pendingActionRef.current = action
      mediaRecorder.stop()
      setRecordingState(false)
    }
  }

  const toggleRecording = (stopAction: SpeechToTextAction = 'insert'): void => {
    if (isRecordingRef.current || mediaRecorderRef.current?.state === 'recording') {
      stopRecording(stopAction)
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
