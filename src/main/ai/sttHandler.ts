import { loadConfig } from '../config'
import { resolveProviderAndModel } from './providerManager'
import { normalizeBaseUrl, isGoogleHost, isAnthropicHost } from './trustedRegistry'

function isWhisperModel(modelId?: string): boolean {
  if (!modelId) return false
  const lower = modelId.toLowerCase()
  return (
    lower.includes('whisper') ||
    lower.includes('distil-whisper') ||
    (lower.startsWith('tts-') === false && (lower.includes('asr') || lower.includes('transcribe')))
  )
}

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
  const isWhisper = isWhisperModel(model?.id)

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
      console.warn('[MAIN TRANSCRIPTION] Anthropic STT failed, trying fallback:', err?.message || err)
      try {
        return await transcribeOpenAiChatAudio(audioBase64, provider.apiKey, normUrl, model?.id)
      } catch {
        return await transcribeOpenAiAudio(audioBase64, provider.apiKey, normUrl, model?.id)
      }
    }
  }

  // If a dedicated Whisper / ASR model was selected (e.g., Groq Whisper, OpenAI Whisper-1)
  if (isWhisper) {
    return await transcribeOpenAiAudio(audioBase64, provider.apiKey, normUrl, model?.id)
  }

  // For multimodal models on OpenAI-compatible providers (NVIDIA NIM, Step, GPT-4o-audio, OpenRouter, etc.)
  try {
    return await transcribeOpenAiChatAudio(audioBase64, provider.apiKey, normUrl, model?.id)
  } catch (err: any) {
    console.warn(
      '[MAIN TRANSCRIPTION] Chat completions STT failed, trying /audio/transcriptions fallback:',
      err?.message || err
    )
    return await transcribeOpenAiAudio(audioBase64, provider.apiKey, normUrl, model?.id)
  }
}

const STT_SYSTEM_INSTRUCTION = `You are Prism's live speech-to-text editor. Turn the user's spoken audio into one clear, natural, intelligent message that is ready for the assistant.

1. LISTEN FOR INTENT: understand the whole utterance before writing. Preserve the user's meaning, requested outcome, technical details, names, paths, commands, constraints, tone, and original language. Improve grammar, punctuation, sentence structure, word choice, and organization when doing so makes the message clearer. You may turn a long spoken monologue into coherent paragraphs or a concise list when the structure is obvious.

2. REMOVE SPEECH NOISE: remove fillers, hesitations, throat clearing, stutters, accidental repetitions, and verbal clutter (for example: "uh", "um", "tipo", "ééé", "né", "like", "you know", and "well"). Do not preserve the spoken roughness merely because it was audible.

3. RESOLVE SELF-CORRECTIONS: when the user starts an idea and then corrects, replaces, cancels, or narrows it, output only the final intended version. Never repeat both alternatives and never describe the correction. Examples: "faz X — não, espera, faz Y" becomes "faz Y"; "abre terça, quer dizer, quarta" becomes "abre quarta"; "troca A por B" remains a clear request to replace A with B. Use the surrounding context to resolve the correction, but do not invent missing content.

4. FOLLOW EXPLICIT REQUESTS TO YOU: if the user clearly asks the speech-to-text assistant to rewrite, replace words, change tone, shorten, expand, translate, or format the message, perform that transformation in the output. If the user is merely dictating a request for the main assistant, preserve that request as clean text. Do not answer the request, call tools, or claim that an action was performed.

5. FORMAT: use GitHub Flavored Markdown only when it materially improves readability — lists for clear steps, inline code or fenced code blocks for technical content, and headings when the user is clearly dictating sections. Do not add decorative formatting.

6. OUTPUT: transcribe strictly in the language spoken, except when the user explicitly requests another language. Output only the final polished message, with no quotes, preamble, explanation, or meta-commentary.`

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
      systemInstruction: {
        parts: [{ text: STT_SYSTEM_INSTRUCTION }]
      },
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
              text: 'Transcribe and polish the audio according to the system instructions. Output only the clean formatted text.'
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
      max_tokens: 2048,
      system: STT_SYSTEM_INSTRUCTION,
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
              text: 'Transcribe and polish the audio according to the system instructions. Output only the clean formatted text.'
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
  const audioBuffer = Buffer.from(audioBase64, 'base64')
  const boundary = `----PrismFormBoundary${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`
  const targetModel = modelId || 'whisper-1'

  const parts: Buffer[] = [
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="audio.webm"\r\n` +
        `Content-Type: audio/webm\r\n\r\n`
    ),
    audioBuffer,
    Buffer.from(
      `\r\n--${boundary}\r\n` +
        `Content-Disposition: form-data; name="model"\r\n\r\n` +
        `${targetModel}\r\n` +
        `--${boundary}--\r\n`
    )
  ]

  const payloadBuffer = Buffer.concat(parts)

  const headers: Record<string, string> = {
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': String(payloadBuffer.length)
  }
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: payloadBuffer
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    throw new Error(`STT API Error ${response.status}: ${errText || response.statusText}`)
  }

  const data = (await response.json()) as any
  return data.text || ''
}

async function transcribeOpenAiChatAudio(
  audioBase64: string,
  apiKey: string,
  baseUrl: string,
  modelId?: string
): Promise<string> {
  const endpoint = `${baseUrl}/chat/completions`
  const targetModel = modelId || 'gpt-4o-audio-preview'

  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`
  }

  // 1. Try standard OpenAI Chat input_audio format
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: targetModel,
      messages: [
        {
          role: 'system',
          content: STT_SYSTEM_INSTRUCTION
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_audio',
              input_audio: {
                data: audioBase64,
                format: 'webm'
              }
            },
            {
              type: 'text',
              text: 'Transcribe and polish the audio according to the system instructions. Output only the clean formatted text.'
            }
          ]
        }
      ]
    })
  })

  if (response.ok) {
    const data = (await response.json()) as any
    const text = data.choices?.[0]?.message?.content || ''
    if (text.trim()) return text.trim()
  }

  // 2. Try audio_url / data URI format (common in OpenRouter, NIM & other multimodal endpoints)
  const fallbackResponse = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: targetModel,
      messages: [
        {
          role: 'system',
          content: STT_SYSTEM_INSTRUCTION
        },
        {
          role: 'user',
          content: [
            {
              type: 'audio_url',
              audio_url: {
                url: `data:audio/webm;base64,${audioBase64}`
              }
            },
            {
              type: 'text',
              text: 'Transcribe and polish the audio according to the system instructions. Output only the clean formatted text.'
            }
          ]
        }
      ]
    })
  })

  if (!fallbackResponse.ok) {
    const errText = await fallbackResponse.text().catch(() => '')
    throw new Error(`OpenAI Chat STT Error ${fallbackResponse.status}: ${errText || fallbackResponse.statusText}`)
  }

  const data = (await fallbackResponse.json()) as any
  const text = data.choices?.[0]?.message?.content || ''
  if (!text.trim()) {
    throw new Error('No transcription content returned from multimodal chat model')
  }
  return text.trim()
}
