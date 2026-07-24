import { loadConfig } from '../config'
import { resolveProviderAndModel } from './providerManager'
import { normalizeBaseUrl, isGoogleHost, isAnthropicHost } from './trustedRegistry'

export async function transcribeAudio(audioBase64: string): Promise<string> {
  console.log('[MAIN TRANSCRIPTION] Received audio data length:', audioBase64.length)
  const config = loadConfig()
  const modelSelection = config.sttModel || config.lastSelectedChatModel
  const { provider, model } = resolveProviderAndModel(modelSelection)

  if (!provider || !provider.apiKey) {
    throw new Error('No active API provider configured for Speech-To-Text')
  }

  const normUrl = normalizeBaseUrl(provider.baseUrl)
  const isGoogle = isGoogleHost(normUrl)
  const isAnthropic = provider.completionType === 'anthropic_messages' || isAnthropicHost(normUrl)

  if (isGoogle) {
    try {
      return await transcribeGeminiAudio(audioBase64, provider.apiKey, normUrl, model?.id)
    } catch (err: any) {
      console.warn('[MAIN TRANSCRIPTION] Gemini STT failed, trying OpenAI audio fallback:', err?.message || err)
      try {
        return await transcribeOpenAiAudio(audioBase64, provider.apiKey, `${normUrl}/openai`, model?.id)
      } catch {
        throw err
      }
    }
  }

  if (isAnthropic) {
    try {
      return await transcribeAnthropicAudio(audioBase64, provider.apiKey, normUrl, model?.id)
    } catch (err: any) {
      console.warn('[MAIN TRANSCRIPTION] Anthropic STT failed, trying OpenAI audio fallback:', err?.message || err)
      try {
        return await transcribeOpenAiAudio(audioBase64, provider.apiKey, normUrl, model?.id)
      } catch {
        throw err
      }
    }
  }

  return await transcribeOpenAiAudio(audioBase64, provider.apiKey, normUrl, model?.id)
}

async function transcribeGeminiAudio(
  audioBase64: string,
  apiKey: string,
  baseUrl: string,
  modelId?: string
): Promise<string> {
  const rawModel = modelId && !modelId.includes('tts') ? modelId : 'gemini-2.0-flash'
  const targetModel = rawModel.startsWith('models/') ? rawModel.slice(7) : rawModel
  const endpoint = `${baseUrl}/models/${targetModel}:generateContent?key=${apiKey}`

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              inlineData: {
                mimeType: 'audio/webm',
                data: audioBase64
              }
            },
            {
              text: 'Transcribe the audio verbatim. Output only the transcript text, nothing else.'
            }
          ]
        }
      ]
    })
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    throw new Error(`Gemini STT API Error ${response.status}: ${errText || response.statusText}`)
  }

  const data = (await response.json()) as any
  const parts = data.candidates?.[0]?.content?.parts || []
  const transcribedText = parts.map((p: any) => p.text || '').join('').trim()

  if (!transcribedText && parts.length === 0) {
    throw new Error('No transcription text received from Gemini STT')
  }

  return transcribedText
}

async function transcribeAnthropicAudio(
  audioBase64: string,
  apiKey: string,
  baseUrl: string,
  modelId?: string
): Promise<string> {
  const targetModel = modelId || 'claude-3-5-sonnet-20241022'
  const endpoint = baseUrl.endsWith('/messages') ? baseUrl : `${baseUrl}/messages`

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: targetModel,
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'audio/webm',
                data: audioBase64
              }
            },
            {
              type: 'text',
              text: 'Transcribe the audio verbatim. Output only the transcript text, nothing else.'
            }
          ]
        }
      ]
    })
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    throw new Error(`Anthropic STT API Error ${response.status}: ${errText || response.statusText}`)
  }

  const data = (await response.json()) as any
  const parts = data.content || []
  const transcribedText = parts.map((p: any) => p.text || '').join('').trim()

  return transcribedText
}

async function transcribeOpenAiAudio(
  audioBase64: string,
  apiKey: string,
  baseUrl: string,
  modelId?: string
): Promise<string> {
  const endpoint = `${baseUrl}/audio/transcriptions`
  const buffer = Buffer.from(audioBase64, 'base64')
  const blob = new Blob([buffer], { type: 'audio/webm' })

  const formData = new FormData()
  formData.append('file', blob, 'audio.webm')
  formData.append('model', modelId || 'whisper-1')

  const headers: Record<string, string> = {}
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`
  }

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
}
