import { loadConfig } from '../config'
import { resolveProviderAndModel } from './providerManager'
import { normalizeBaseUrl } from './trustedRegistry'

export async function transcribeAudio(audioBase64: string): Promise<string> {
  console.log('[MAIN TRANSCRIPTION] Received audio data length:', audioBase64.length)
  const config = loadConfig()
  const modelSelection = config.sttModel || config.lastSelectedChatModel
  const { provider, model } = resolveProviderAndModel(modelSelection)

  if (!provider || !provider.apiKey) {
    throw new Error('No active API provider configured for Speech-To-Text')
  }

  const normUrl = normalizeBaseUrl(provider.baseUrl)
  const endpoint = `${normUrl}/audio/transcriptions`

  const buffer = Buffer.from(audioBase64, 'base64')
  const blob = new Blob([buffer], { type: 'audio/webm' })

  const formData = new FormData()
  formData.append('file', blob, 'audio.webm')
  formData.append('model', model?.id || 'whisper-1')

  const headers: Record<string, string> = {}
  if (provider.apiKey) {
    headers['Authorization'] = `Bearer ${provider.apiKey}`
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: formData
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      throw new Error(`STT API Error ${response.status}: ${errText || response.statusText}`)
    }

    const data = (await response.json()) as any
    return data.text || ''
  } catch (error: any) {
    console.error('Failed to transcribe audio via OpenAI Compatible endpoint:', error)
    throw error
  }
}
