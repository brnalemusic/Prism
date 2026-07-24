
import { loadConfig } from '../config'
import { resolveProviderAndModel } from './providerManager'
import { normalizeBaseUrl, isGoogleHost } from './trustedRegistry'

export async function generateTts(text: string): Promise<string> {
  let cleanText = text
  let prevText: string
  do {
    prevText = cleanText
    cleanText = cleanText.replace(/<[^>]+>/g, '')
  } while (cleanText !== prevText)
  cleanText = cleanText.trim()
  if (!cleanText) return ''

  const config = loadConfig()
  const modelSelection = config.lastSelectedChatModel
  const { provider, model } = resolveProviderAndModel(modelSelection)

  if (!provider || !provider.apiKey) {
    throw new Error('No active API provider configured for Text-To-Speech')
  }

  const normUrl = normalizeBaseUrl(provider.baseUrl)
  const isGoogle = isGoogleHost(normUrl)
  const voice = config.ttsVoice || 'Aoede'

  if (isGoogle) {
    try {
      return await generateGeminiTts(cleanText, provider.apiKey, voice, normUrl, model?.id)
    } catch (err: any) {
      console.warn('Gemini audio generation failed, trying OpenAI audio fallback:', err?.message || err)
      try {
        return await generateOpenAiTts(cleanText, provider.apiKey, `${normUrl}/openai`, voice, model?.id)
      } catch {
        throw err
      }
    }
  }

  return await generateOpenAiTts(cleanText, provider.apiKey, normUrl, voice, model?.id)
}

async function generateGeminiTts(
  text: string,
  apiKey: string,
  voice: string,
  baseUrl: string,
  modelId?: string
): Promise<string> {
  const targetModel = modelId && !modelId.includes('lite') ? modelId : 'gemini-2.0-flash'
  const endpoint = `${baseUrl}/models/${targetModel}:generateContent?key=${apiKey}`

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text }]
        }
      ],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: voice
            }
          }
        }
      }
    })
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    throw new Error(`Gemini TTS API Error ${response.status}: ${errText || response.statusText}`)
  }

  const data = (await response.json()) as any
  const parts = data.candidates?.[0]?.content?.parts || []
  for (const part of parts) {
    const inlineData = part.inlineData || part.inline_data
    if (inlineData && inlineData.data) {
      const mimeType = inlineData.mimeType || inlineData.mime_type || 'audio/mp3'
      return `data:${mimeType};base64,${inlineData.data}`
    }
  }

  throw new Error('No audio data received from Gemini TTS')
}

async function generateOpenAiTts(
  text: string,
  apiKey: string,
  baseUrl: string,
  voice: string,
  modelId?: string
): Promise<string> {
  const endpoint = `${baseUrl}/audio/speech`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: modelId && modelId.startsWith('tts-') ? modelId : 'tts-1',
      input: text,
      voice: voice.toLowerCase()
    })
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    throw new Error(`OpenAI TTS API Error ${response.status}: ${errText || response.statusText}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  const mimeType = response.headers.get('content-type') || 'audio/mp3'
  return `data:${mimeType};base64,${buffer.toString('base64')}`
}

