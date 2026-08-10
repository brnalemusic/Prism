import {
  Client,
  GatewayIntentBits,
  Message,
  Partials,
  ThreadChannel,
  ChannelType
} from 'discord.js'
import {
  joinVoiceChannel,
  getVoiceConnection,
  VoiceConnectionStatus,
  AudioPlayerStatus,
  EndBehaviorType,
  createAudioPlayer,
  createAudioResource,
  StreamType
} from '@discordjs/voice'
import { GoogleGenAI, Modality } from '@google/genai'
import prism from 'prism-media'
import { PassThrough } from 'stream'
import { AppConfig } from './config'
import {
  loadChatSession,
  hydrateHistoryToolAttachments,
  prepareHistoryMessage,
  saveChatSession,
  updateChatSessionTitle,
  listChatSessions
} from './history'
import { resolveProviderAndModel } from './ai/providerManager'
import { getChatModel, activeRuns } from './ai/chatHandler'
import { runToolOrchestration } from './ai/toolOrchestrator'
import { OpenAiMessage } from './ai/types'
import { getSystemToolsPrompt, setCurrentSessionIdForTodo } from './systemTools'
import {
  executeValidatedTool,
  getGeminiFunctionDeclarations,
  getOpenAiToolDefinitions,
  ToolLoopGuard
} from './toolRuntime'
import { normalizePrismThinkingLevel } from './ai/prismThinking'
import { streamOpenAiCompletion } from './ai/openaiClient'
import { is } from '@electron-toolkit/utils'
import { broadcastIpc } from './safeSend'
import { createVoiceOverlayWindow, closeVoiceOverlayWindow } from './index'

let client: Client | null = null
let currentConfig: AppConfig | null = null
let appOwnerIds: Set<string> = new Set()

let activeLiveSession: any = null
let activeAudioPlayer: any = null
let activeVoiceConnection: any = null
let activeVoiceInputStream: any = null
let activeVoiceDecoder: any = null
let activeVoiceReceiver: any = null
let activeVoiceMemberId: string | null = null
let voiceInputRecoveryTimer: ReturnType<typeof setTimeout> | null = null
let voiceInputRecoveryInFlight = false
let voiceInputRecoveryAttempt = 0
let activeSpeakerStream: PassThrough | null = null
let activeVoiceSilenceTimer: ReturnType<typeof setTimeout> | null = null
let activeVoiceInactivityTimer: ReturnType<typeof setTimeout> | null = null
let activeVoiceSessionParams: { apiKey: string; modelName: string } | null = null
let isReconnectingLive = false
let pendingAudioChunks: Buffer[] = []
let voiceInputChunkCount = 0
let voiceInputByteCount = 0
let voiceOutputChunkCount = 0
let voiceOutputByteCount = 0
let voiceOutputTurnActive = false
let activeVoiceHistory: VoiceHistoryState | null = null
let activeLiveToolLoopGuard: ToolLoopGuard | null = null
let activeLiveAbortController: AbortController | null = null
let activeVoiceStatusMessage: Message | null = null
let activeVoiceOverlayChatId: string | null = null
let voiceOverlaySpeaking = false
let voiceOutputAnnounced = false
let lastVoiceOverlayLevelAt = 0
let lastVoiceReceiveWarningAt = 0
let suppressedVoiceReceiveWarnings = 0

type VoiceOverlayConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

interface PendingVoiceLeave {
  farewellRequested: boolean
  responseStarted: boolean
  audioReceived: boolean
  turnComplete: boolean
  player: any | null
  forceTimer?: NodeJS.Timeout
}

let pendingVoiceLeave: PendingVoiceLeave | null = null

const VOICE_SILENCE_FLUSH_MS = 800
const VOICE_GATE_START_RMS = 0.02
const VOICE_RECEIVE_WARNING_INTERVAL_MS = 5000
const VOICE_INPUT_RECOVERY_BASE_DELAY_MS = 350
const VOICE_INPUT_RECOVERY_MAX_DELAY_MS = 5000

function getVoiceReceiveErrorText(error: unknown): string {
  if (error instanceof Error) {
    const errorCode = 'code' in error ? String(error.code) : ''
    return [errorCode, error.message].filter(Boolean).join(' ')
  }
  if (typeof error === 'string') return error

  if (error && typeof error === 'object') {
    const errorRecord = error as { code?: unknown; message?: unknown }
    return [errorRecord.code, errorRecord.message].filter(Boolean).join(' ')
  }

  return String(error)
}

function isRecoverableVoiceReceiveError(error: unknown): boolean {
  const errorText = getVoiceReceiveErrorText(error).toLowerCase()

  return (
    errorText.includes('decryptionfailed') ||
    errorText.includes('unencryptedwhenpassthroughdisabled') ||
    (errorText.includes('genericfailure') &&
      /(decrypt|udp|packet|opus|passthrough)/i.test(errorText)) ||
    /(decrypt|udp|packet|opus).*(decode|decrypt|invalid|malformed|corrupt)/i.test(errorText)
  )
}

function warnAboutVoiceReceiveError(source: string, error: unknown): void {
  const now = Date.now()
  if (now - lastVoiceReceiveWarningAt < VOICE_RECEIVE_WARNING_INTERVAL_MS) {
    suppressedVoiceReceiveWarnings += 1
    return
  }

  const suppressed = suppressedVoiceReceiveWarnings
  lastVoiceReceiveWarningAt = now
  suppressedVoiceReceiveWarnings = 0
  const suffix = suppressed > 0 ? ` (${suppressed} similar warning(s) suppressed)` : ''
  console.warn(
    `[Discord Gateway] Ignored recoverable ${source} packet error${suffix}: ${getVoiceReceiveErrorText(error)}`
  )
}

function handleVoiceReceiveError(source: string, error: unknown, stream: unknown): void {
  if (isRecoverableVoiceReceiveError(error)) {
    warnAboutVoiceReceiveError(source, error)
    scheduleVoiceInputRecovery()
    return
  }

  console.error(`[Discord Gateway] Fatal ${source} error:`, error)
  if (activeVoiceInputStream === stream) cleanupVoiceResources()
}

function clearVoiceInputRecovery(): void {
  if (voiceInputRecoveryTimer) {
    clearTimeout(voiceInputRecoveryTimer)
    voiceInputRecoveryTimer = null
  }
  voiceInputRecoveryInFlight = false
  voiceInputRecoveryAttempt = 0
}

function forwardVoicePcmChunk(pcm48kChunk: Buffer): void {
  try {
    if (pendingVoiceLeave) return

    const pcm16kChunk = downsample48kStereoTo16kMono(pcm48kChunk)
    if (!shouldForwardVoiceAudio(pcm16kChunk)) return
    resetVoiceInactivityTimer()

    if (!activeLiveSession) {
      pendingAudioChunks.push(pcm16kChunk)
      if (!isReconnectingLive) void reconnectLiveVoiceSession()
      return
    }

    const base64Data = pcm16kChunk.toString('base64')
    activeLiveSession.sendRealtimeInput({
      audio: {
        mimeType: 'audio/pcm;rate=16000',
        data: base64Data
      }
    })
    voiceInputChunkCount += 1
    voiceInputByteCount += pcm16kChunk.length
    scheduleVoiceStreamEnd()
    if (voiceInputChunkCount === 1 || voiceInputChunkCount % 100 === 0) {
      console.log(
        `[Discord Gateway] Sent audio chunk #${voiceInputChunkCount} ` +
          `(${pcm16kChunk.length} bytes PCM16k mono).`
      )
    }
  } catch (err) {
    console.error('[Discord Gateway] Error sending audio chunk to Gemini Live:', err)
  }
}

function attachVoiceInputPipeline(): boolean {
  const receiver = activeVoiceReceiver
  const memberId = activeVoiceMemberId
  if (!receiver || !memberId || pendingVoiceLeave) return false

  const audioStream = receiver.subscribe(memberId, {
    end: {
      behavior: EndBehaviorType.Manual
    }
  })
  const decoder = new prism.opus.Decoder({ frameSize: 960, channels: 2, rate: 48000 })
  activeVoiceInputStream = audioStream
  activeVoiceDecoder = decoder

  audioStream.on('error', (err: unknown) => {
    if (activeVoiceInputStream !== audioStream) return
    handleVoiceReceiveError('Discord audio receive', err, audioStream)
  })
  audioStream.on('end', () => {
    if (activeVoiceInputStream !== audioStream || pendingVoiceLeave) return
    console.warn('[Discord Gateway] Discord audio receiver ended; attempting to reattach.')
    scheduleVoiceInputRecovery()
  })
  audioStream.on('close', () => {
    if (activeVoiceInputStream !== audioStream || pendingVoiceLeave) return
    scheduleVoiceInputRecovery()
  })

  decoder.on('error', (err: unknown) => {
    if (activeVoiceDecoder !== decoder) return
    handleVoiceReceiveError('Opus decoder', err, audioStream)
  })
  decoder.on('data', forwardVoicePcmChunk)
  audioStream.pipe(decoder)
  return true
}

function scheduleVoiceInputRecovery(): void {
  if (
    pendingVoiceLeave ||
    !activeVoiceReceiver ||
    !activeVoiceMemberId ||
    voiceInputRecoveryTimer ||
    voiceInputRecoveryInFlight
  ) {
    return
  }

  broadcastVoiceOverlayState('reconnecting')
  const delay = Math.min(
    VOICE_INPUT_RECOVERY_MAX_DELAY_MS,
    VOICE_INPUT_RECOVERY_BASE_DELAY_MS * 2 ** voiceInputRecoveryAttempt
  )
  voiceInputRecoveryAttempt += 1
  voiceInputRecoveryTimer = setTimeout(() => {
    voiceInputRecoveryTimer = null
    voiceInputRecoveryInFlight = true

    const previousStream = activeVoiceInputStream
    const previousDecoder = activeVoiceDecoder
    activeVoiceInputStream = null
    activeVoiceDecoder = null
    if (previousStream && !previousStream.destroyed) previousStream.destroy()
    if (previousDecoder && !previousDecoder.destroyed) previousDecoder.destroy()

    try {
      const attached = attachVoiceInputPipeline()
      if (attached) {
        voiceInputRecoveryAttempt = 0
        broadcastVoiceOverlayState('connected')
        console.log('[Discord Gateway] Discord audio receiver reattached successfully.')
      } else {
        voiceInputRecoveryInFlight = false
        scheduleVoiceInputRecovery()
      }
    } catch (error) {
      console.warn('[Discord Gateway] Failed to reattach Discord audio receiver:', error)
      voiceInputRecoveryInFlight = false
      scheduleVoiceInputRecovery()
    } finally {
      voiceInputRecoveryInFlight = false
    }
  }, delay)
}
const VOICE_GATE_CONTINUE_RMS = 0.012
const VOICE_GATE_HANGOVER_MS = 450
const VOICE_INACTIVITY_TIMEOUT_MS = 240 * 60 * 1000 // 240 minutes (4 hours) of inactivity before AI says goodbye and leaves

let voiceGateOpen = false
let voiceGateLastSpeechAt = 0

interface VoiceHistoryState {
  chatId: string
  title: string
  modelName: string
  messages: OpenAiMessage[]
  activeUserMessageIndex: number | null
  activeAssistantMessageIndex: number | null
}

interface LiveToolResponseSession {
  sendToolResponse(input: {
    functionResponses: LiveFunctionResponse[]
  }): void
}

interface LiveFunctionResponse {
  id: string
  name: string
  response: Record<string, unknown>
  parts?: Array<{
    inlineData: {
      mimeType: string
      data: string
    }
  }>
}

const activeDmSessions: Map<string, string> = new Map()

function getActiveDmSessionId(userId: string): string {
  if (!activeDmSessions.has(userId)) {
    const sessions = listChatSessions().filter((s) => s.id.startsWith(`discord-dm-${userId}-`))
    if (sessions.length > 0) {
      activeDmSessions.set(userId, sessions[0].id)
    } else {
      activeDmSessions.set(userId, `discord-dm-${userId}-${Date.now()}`)
    }
  }
  return activeDmSessions.get(userId)!
}

function downsample48kStereoTo16kMono(pcm48k: Buffer): Buffer {
  const numFrames = pcm48k.length / 4
  const numOutFrames = Math.floor(numFrames / 3)
  const outBuffer = Buffer.alloc(numOutFrames * 2)

  for (let i = 0; i < numOutFrames; i++) {
    const inIndex = i * 3 * 4
    const left = pcm48k.readInt16LE(inIndex)
    const right = pcm48k.readInt16LE(inIndex + 2)
    const mono = Math.floor((left + right) / 2)
    outBuffer.writeInt16LE(mono, i * 2)
  }
  return outBuffer
}

function upsample24kMonoTo48kStereo(pcm24k: Buffer): Buffer {
  const numFrames = Math.floor(pcm24k.length / 2)
  const numOutFrames = numFrames * 2
  const outBuffer = Buffer.alloc(numOutFrames * 4)

  for (let i = 0; i < numFrames; i++) {
    const sample = pcm24k.readInt16LE(i * 2)
    for (let j = 0; j < 2; j++) {
      const outIndex = (i * 2 + j) * 4
      outBuffer.writeInt16LE(sample, outIndex)
      outBuffer.writeInt16LE(sample, outIndex + 2)
    }
  }
  return outBuffer
}

function normalizeLiveModelId(modelName: string): string {
  return modelName.trim().replace(/^models\//i, '')
}

function mergeVoiceTranscript(current: string, incoming: string): string {
  const next = incoming.trim()
  if (!current) return next
  if (!next || current === next || current.includes(next)) return current
  if (next.startsWith(current)) return next
  if (current.endsWith(next)) return current
  return `${current} ${next}`.replace(/\s+/g, ' ').trim()
}

function persistVoiceHistory(): void {
  const history = activeVoiceHistory
  if (!history) return
  saveChatSession(
    history.chatId,
    history.messages,
    history.title,
    'execution',
    '',
    history.modelName,
    true
  )
}

function appendVoiceTranscript(role: 'user' | 'assistant', text: string): void {
  const history = activeVoiceHistory
  const transcript = text.trim()
  if (!history || !transcript) return

  const indexKey = role === 'user' ? 'activeUserMessageIndex' : 'activeAssistantMessageIndex'
  const activeIndex = history[indexKey]
  const activeMessage = activeIndex === null ? undefined : history.messages[activeIndex]

  if (activeMessage && typeof activeMessage.content === 'string') {
    activeMessage.content = mergeVoiceTranscript(activeMessage.content, transcript)
  } else {
    if (role === 'assistant') history.activeUserMessageIndex = null
    history.messages.push({ role, content: transcript })
    history[indexKey] = history.messages.length - 1
  }

  persistVoiceHistory()
}

function recordLiveToolCall(callId: string, name: string, args: Record<string, unknown>): void {
  const history = activeVoiceHistory
  if (!history) return

  history.activeUserMessageIndex = null
  history.activeAssistantMessageIndex = null
  history.messages.push({
    role: 'assistant',
    content: null,
    tool_calls: [
      {
        id: callId,
        type: 'function',
        function: { name, arguments: JSON.stringify(args) }
      }
    ]
  })
  persistVoiceHistory()
}

function recordLiveToolResult(
  callId: string,
  name: string,
  args: Record<string, unknown>,
  modelContent: string,
  envelope: import('./toolRuntime').ToolResultEnvelope,
  attachments?: import('./toolAttachments').ToolAttachment[]
): void {
  const history = activeVoiceHistory
  if (!history) return

  history.messages.push({
    role: 'tool',
    tool_call_id: callId,
    name,
    content: modelContent,
    ...(attachments && attachments.length > 0 ? { tool_attachments: attachments } : {}),
    tool_metadata: {
      originalArguments: args,
      validatedArguments: args,
      result: envelope
    }
  })
  persistVoiceHistory()
}

async function executeLiveToolCalls(
  functionCalls: Array<{ id?: string; name?: string; args?: Record<string, unknown> }>,
  session: LiveToolResponseSession,
  apiKey: string
): Promise<void> {
  const history = activeVoiceHistory
  if (!history || functionCalls.length === 0) return

  const abortController = new AbortController()
  activeLiveAbortController = abortController
  const loopGuard = activeLiveToolLoopGuard || new ToolLoopGuard()
  activeLiveToolLoopGuard = loopGuard
  const functionResponses: LiveFunctionResponse[] = []

  for (const functionCall of functionCalls) {
    const callId = functionCall.id || `live_call_${Date.now()}_${functionResponses.length}`
    const name = functionCall.name || 'unknown_tool'
    const args = functionCall.args || {}
    recordLiveToolCall(callId, name, args)

    const execution = await executeValidatedTool(
      name,
      args,
      {
        event: null,
        apiKey,
        signal: abortController.signal,
        chatId: history.chatId,
        onStart: (validatedArgs) => {
          broadcastIpc('chat-tool-start', {
            callId,
            name,
            args: validatedArgs,
            timestamp: Date.now(),
            chatId: history.chatId
          })
        }
      },
      loopGuard
    )

    recordLiveToolResult(
      callId,
      name,
      execution.args,
      execution.modelContent,
      execution.envelope,
      execution.attachments
    )
    broadcastIpc('chat-tool-end', {
      callId,
      name,
      result: execution.modelContent,
      chatId: history.chatId
    })

    const visualParts = (execution.attachments || [])
      .filter((attachment) => attachment.kind === 'image')
      .map((attachment) => ({
        inlineData: {
          mimeType: attachment.mimeType,
          data: attachment.data
        }
      }))

    functionResponses.push({
      id: callId,
      name,
      response: execution.envelope.ok
        ? { result: execution.envelope.output }
        : { error: execution.envelope.error.message, details: execution.envelope.error.details },
      ...(visualParts.length > 0 ? { parts: visualParts } : {})
    })

    if (pendingVoiceLeave) break
  }

  if (activeLiveSession !== session || abortController.signal.aborted) {
    if (activeLiveAbortController === abortController) activeLiveAbortController = null
    return
  }
  try {
    const farewellWasRequested = pendingVoiceLeave !== null
    if (farewellWasRequested) {
      pendingVoiceLeave!.farewellRequested = true
    }
    session.sendToolResponse({ functionResponses })
    console.log(
      `[Discord Gateway] Returned ${functionResponses.length} tool result(s) to Gemini Live.`
    )
  } catch (error) {
    console.error('[Discord Gateway] Failed to return Live tool results:', error)
    if (pendingVoiceLeave) leaveDiscordVoiceChannel()
  } finally {
    if (activeLiveAbortController === abortController) activeLiveAbortController = null
  }
}

function logVoiceAudioStats(): void {
  console.log(
    `[Discord Gateway] Voice audio stats: inputChunks=${voiceInputChunkCount}, ` +
      `inputBytes=${voiceInputByteCount}, outputChunks=${voiceOutputChunkCount}, ` +
      `outputBytes=${voiceOutputByteCount}`
  )
}

function clearVoiceSilenceTimer(): void {
  if (activeVoiceSilenceTimer) {
    clearTimeout(activeVoiceSilenceTimer)
    activeVoiceSilenceTimer = null
  }
}

function clearVoiceInactivityTimer(): void {
  if (activeVoiceInactivityTimer) {
    clearTimeout(activeVoiceInactivityTimer)
    activeVoiceInactivityTimer = null
  }
}

function resetVoiceInactivityTimer(): void {
  clearVoiceInactivityTimer()
  if (!activeLiveSession || pendingVoiceLeave) return

  activeVoiceInactivityTimer = setTimeout(() => {
    activeVoiceInactivityTimer = null
    triggerVoiceInactivityFarewell()
  }, VOICE_INACTIVITY_TIMEOUT_MS)
}

function triggerVoiceInactivityFarewell(): void {
  const session = activeLiveSession
  if (!session || pendingVoiceLeave) return

  console.log('[Discord Gateway] Inactivity timeout reached (240 minutes). Requesting voice farewell...')
  if (!pendingVoiceLeave) {
    pendingVoiceLeave = {
      farewellRequested: true,
      responseStarted: false,
      audioReceived: false,
      turnComplete: false,
      player: null
    }
  }
  void activeVoiceStatusMessage
    ?.edit('⌛ *User inactive for 240 minutes. Saying goodbye before leaving voice channel...*')
    .catch(() => {})

  try {
    if (activeSpeakerStream && !activeSpeakerStream.destroyed) {
      createVoiceAudioOutput()
    }
    appendVoiceTranscript('user', 'The user is now inactive for 240 minutes. Leave the call.')
    session.sendClientContent({
      turns: [
        {
          role: 'user',
          parts: [
            {
              text: 'The user is now inactive for 240 minutes. Leave the call.'
            }
          ]
        }
      ],
      turnComplete: true
    })
  } catch (error) {
    console.error('[Discord Gateway] Failed to trigger inactivity farewell:', error)
    leaveDiscordVoiceChannel()
  }
}

function scheduleVoiceStreamEnd(): void {
  clearVoiceSilenceTimer()
  activeVoiceSilenceTimer = setTimeout(() => {
    activeVoiceSilenceTimer = null
    if (!activeLiveSession) return

    try {
      activeLiveSession.sendRealtimeInput({ audioStreamEnd: true })
      console.log('[Discord Gateway] Sent audioStreamEnd after Discord voice silence.')
    } catch (error) {
      console.error('[Discord Gateway] Failed to flush silent voice turn:', error)
    }
  }, VOICE_SILENCE_FLUSH_MS)
}

function calculatePcmRms(pcm16k: Buffer): number {
  const sampleCount = Math.floor(pcm16k.length / 2)
  if (sampleCount === 0) return 0

  let sumSquares = 0
  for (let i = 0; i < sampleCount; i++) {
    const normalizedSample = pcm16k.readInt16LE(i * 2) / 32768
    sumSquares += normalizedSample * normalizedSample
  }
  return Math.sqrt(sumSquares / sampleCount)
}

function broadcastVoiceOverlayState(state: VoiceOverlayConnectionState): void {
  if (!activeVoiceOverlayChatId) return
  broadcastIpc('discord-voice-state', { chatId: activeVoiceOverlayChatId, state })
}

function setVoiceOverlaySpeaking(speaking: boolean): void {
  if (!activeVoiceOverlayChatId || voiceOverlaySpeaking === speaking) return
  voiceOverlaySpeaking = speaking
  broadcastIpc('discord-voice-speaking', { chatId: activeVoiceOverlayChatId, speaking })
}

function broadcastVoiceOverlayLevel(level: number, force = false): void {
  if (!activeVoiceOverlayChatId) return

  const now = Date.now()
  if (!force && now - lastVoiceOverlayLevelAt < 42) return

  lastVoiceOverlayLevelAt = now
  broadcastIpc('discord-voice-audio-level', {
    chatId: activeVoiceOverlayChatId,
    level: Math.min(1, Math.max(0, level))
  })
}

function broadcastVoiceOverlayOutput(): void {
  if (!activeVoiceOverlayChatId || voiceOutputAnnounced) return
  voiceOutputAnnounced = true
  broadcastIpc('discord-voice-output', { chatId: activeVoiceOverlayChatId })
}

function reportVoiceOutputLevel(pcm: Buffer): void {
  const rms = calculatePcmRms(pcm)
  const normalized = Math.min(1, Math.max(0, (rms - 0.004) / 0.16))
  broadcastVoiceOverlayLevel(Math.pow(normalized, 0.68))
}

function resetVoiceOverlay(): void {
  if (!activeVoiceOverlayChatId) return

  setVoiceOverlaySpeaking(false)
  broadcastVoiceOverlayLevel(0, true)
  broadcastVoiceOverlayState('disconnected')
  activeVoiceOverlayChatId = null
  voiceOutputAnnounced = false
  lastVoiceOverlayLevelAt = 0
}

function resetVoiceGate(): void {
  voiceGateOpen = false
  voiceGateLastSpeechAt = 0
}

function shouldForwardVoiceAudio(pcm16k: Buffer): boolean {
  const rms = calculatePcmRms(pcm16k)
  const now = Date.now()

  if (!voiceGateOpen) {
    if (rms < VOICE_GATE_START_RMS) return false
    voiceGateOpen = true
    voiceGateLastSpeechAt = now
    console.log(`[Discord Gateway] Voice gate opened (RMS ${rms.toFixed(4)}).`)
    return true
  }

  if (rms >= VOICE_GATE_CONTINUE_RMS) {
    voiceGateLastSpeechAt = now
    return true
  }

  if (now - voiceGateLastSpeechAt <= VOICE_GATE_HANGOVER_MS) return true

  voiceGateOpen = false
  console.log(`[Discord Gateway] Voice gate closed (RMS ${rms.toFixed(4)}).`)
  return false
}

function attachVoiceAudioPlayerErrorHandler(player: any): void {
  player.on('error', (err: any) => {
    if (activeAudioPlayer !== player && err?.code === 'ERR_STREAM_PREMATURE_CLOSE') return
    console.error('[Discord Gateway] Audio player error:', err)
  })
}

function maybeFinalizePendingVoiceLeave(): void {
  const pending = pendingVoiceLeave
  if (!pending || !pending.farewellRequested || !pending.turnComplete) return

  if (!pending.audioReceived && !pending.responseStarted) {
    finalizePendingVoiceLeave()
    return
  }

  // If the audio player is no longer playing, finalize.
  if (
    !activeAudioPlayer ||
    activeAudioPlayer.state.status === AudioPlayerStatus.Idle ||
    pending.player !== activeAudioPlayer
  ) {
    finalizePendingVoiceLeave()
    return
  }

  // Fallback: if we haven't finalized within 8 seconds of turn completion, force it.
  if (!pending.forceTimer) {
    pending.forceTimer = setTimeout(() => {
      if (pendingVoiceLeave === pending) finalizePendingVoiceLeave()
    }, 8000)
  }
}

function finalizePendingVoiceLeave(): void {
  const pending = pendingVoiceLeave
  if (pending?.forceTimer) {
    clearTimeout(pending.forceTimer)
  }

  const statusMessage = activeVoiceStatusMessage
  pendingVoiceLeave = null
  activeVoiceStatusMessage = null

  const left = leaveDiscordVoiceChannel()
  if (statusMessage) {
    void statusMessage
      .edit(left ? '✅ *Left the voice channel after saying goodbye.*' : '✅ *Voice session ended.*')
      .catch(() => {})
  }
}

function createVoiceAudioOutput(): void {
  const oldPlayer = activeAudioPlayer
  const oldStream = activeSpeakerStream

  if (oldPlayer) {
    try {
      if (activeVoiceConnection?.unsubscribe) activeVoiceConnection.unsubscribe(oldPlayer)
      oldPlayer.stop()
    } catch (error) {
      console.error('[Discord Gateway] Failed to replace Discord audio player:', error)
    }
  }
  if (oldStream && !oldStream.destroyed) oldStream.destroy()

  const stream = new PassThrough()
  const player = createAudioPlayer()
  activeSpeakerStream = stream
  activeAudioPlayer = player
  voiceOutputTurnActive = true
  voiceOutputAnnounced = false
  setVoiceOverlaySpeaking(false)
  broadcastVoiceOverlayLevel(0, true)
  player.play(createAudioResource(stream, { inputType: StreamType.Raw }))
  attachVoiceAudioPlayerErrorHandler(player)
  player.on(AudioPlayerStatus.Idle, () => {
    maybeFinalizePendingVoiceLeave()
  })

  if (activeVoiceConnection) activeVoiceConnection.subscribe(player)
}

function cleanupVoiceResources(): boolean {
  clearVoiceInputRecovery()
  broadcastVoiceOverlayState('disconnected')
  closeVoiceOverlayWindow()
  const hadVoiceResources = Boolean(
    activeLiveSession ||
    activeAudioPlayer ||
    activeVoiceConnection ||
    activeVoiceInputStream ||
    activeVoiceDecoder ||
    activeSpeakerStream
  )

  const liveSession = activeLiveSession
  activeLiveSession = null
  activeVoiceSessionParams = null
  isReconnectingLive = false
  pendingAudioChunks = []
  resetVoiceOverlay()
  pendingVoiceLeave = null
  activeVoiceStatusMessage = null
  activeLiveAbortController?.abort()
  activeLiveAbortController = null
  persistVoiceHistory()
  activeVoiceHistory = null
  activeLiveToolLoopGuard = null
  if (liveSession) {
    try {
      liveSession.close()
    } catch (error) {
      console.error('[Discord Gateway] Failed to close Gemini Live session:', error)
    }
  }

  const inputStream = activeVoiceInputStream
  activeVoiceInputStream = null
  activeVoiceReceiver = null
  activeVoiceMemberId = null
  clearVoiceSilenceTimer()
  clearVoiceInactivityTimer()
  resetVoiceGate()
  if (inputStream) {
    try {
      inputStream.destroy()
    } catch (error) {
      console.error('[Discord Gateway] Failed to stop Discord audio receiver:', error)
    }
  }

  const decoder = activeVoiceDecoder
  activeVoiceDecoder = null
  if (decoder) {
    try {
      decoder.destroy()
    } catch (error) {
      console.error('[Discord Gateway] Failed to stop Opus decoder:', error)
    }
  }

  const speakerStream = activeSpeakerStream
  activeSpeakerStream = null
  if (speakerStream && !speakerStream.destroyed) speakerStream.destroy()

  const audioPlayer = activeAudioPlayer
  activeAudioPlayer = null
  if (audioPlayer) {
    try {
      audioPlayer.stop()
    } catch (error) {
      console.error('[Discord Gateway] Failed to stop Discord audio player:', error)
    }
  }

  const voiceConnection = activeVoiceConnection
  activeVoiceConnection = null
  if (voiceConnection) {
    try {
      voiceConnection.destroy()
    } catch (error) {
      console.error('[Discord Gateway] Failed to destroy Discord voice connection:', error)
    }
  }

  logVoiceAudioStats()
  voiceInputChunkCount = 0
  voiceInputByteCount = 0
  voiceOutputChunkCount = 0
  voiceOutputByteCount = 0
  voiceOutputTurnActive = false

  return hadVoiceResources
}

function handleLiveMessage(msg: any, aiSession: any, apiKey: string): void {
  const serverContent = msg?.serverContent
  if (msg?.toolCallCancellation?.ids?.length) {
    console.log('[Discord Gateway] Gemini cancelled pending Live tool calls.')
    activeLiveAbortController?.abort()
  }

  const functionCalls = msg?.toolCall?.functionCalls
  if (
    Array.isArray(functionCalls) &&
    functionCalls.length > 0 &&
    !pendingVoiceLeave?.farewellRequested
  ) {
    console.log(
      `[Discord Gateway] Gemini requested ${functionCalls.length} Live tool call(s).`
    )
    void executeLiveToolCalls(functionCalls, aiSession, apiKey)
  }

  if (serverContent?.interrupted) {
    console.log('[Discord Gateway] Gemini interrupted its current audio response.')
    setVoiceOverlaySpeaking(false)
    broadcastVoiceOverlayLevel(0, true)
    createVoiceAudioOutput()
  }

  if (serverContent?.turnComplete) {
    console.log('[Discord Gateway] Gemini completed the current voice turn.')
  }

  const inputTranscript = serverContent?.inputTranscription?.text
  if (typeof inputTranscript === 'string' && inputTranscript.trim()) {
    console.log(`[Discord Gateway] Input transcription: ${inputTranscript.trim()}`)
    appendVoiceTranscript('user', inputTranscript)
    resetVoiceInactivityTimer()
  }

  const outputTranscript = serverContent?.outputTranscription?.text
  if (typeof outputTranscript === 'string' && outputTranscript.trim()) {
    appendVoiceTranscript('assistant', outputTranscript)
    if (pendingVoiceLeave?.farewellRequested) {
      pendingVoiceLeave.responseStarted = true
    }
  }

  const parts = serverContent?.modelTurn?.parts || []
  for (const part of parts) {
    if (part.inlineData?.data) {
      if (pendingVoiceLeave?.farewellRequested && pendingVoiceLeave.turnComplete) {
        continue
      }
      if (!voiceOutputTurnActive) createVoiceAudioOutput()

      const pcm24kBuffer = Buffer.from(part.inlineData.data, 'base64')
      broadcastVoiceOverlayOutput()
      setVoiceOverlaySpeaking(true)
      reportVoiceOutputLevel(pcm24kBuffer)
      const pcm48kBuffer = upsample24kMonoTo48kStereo(pcm24kBuffer)
      voiceOutputChunkCount += 1
      voiceOutputByteCount += pcm48kBuffer.length
      if (voiceOutputChunkCount === 1 || voiceOutputChunkCount % 50 === 0) {
        console.log(
          `[Discord Gateway] Received output audio chunk #${voiceOutputChunkCount} ` +
            `(${pcm48kBuffer.length} bytes PCM48k stereo).`
        )
      }
      if (activeSpeakerStream && !activeSpeakerStream.destroyed) {
        activeSpeakerStream.write(pcm48kBuffer)
      }
      if (pendingVoiceLeave?.farewellRequested) {
        pendingVoiceLeave.responseStarted = true
        pendingVoiceLeave.audioReceived = true
        pendingVoiceLeave.player = activeAudioPlayer
      }
    }
  }

  if (serverContent?.turnComplete) {
    if (voiceOutputTurnActive) {
      voiceOutputTurnActive = false
      setVoiceOverlaySpeaking(false)
      broadcastVoiceOverlayLevel(0, true)
      if (activeSpeakerStream && !activeSpeakerStream.destroyed) {
        activeSpeakerStream.end()
      }
    }

    if (pendingVoiceLeave?.farewellRequested) {
      pendingVoiceLeave.turnComplete = true
      maybeFinalizePendingVoiceLeave()
    }

    if (activeVoiceHistory) {
      activeVoiceHistory.activeUserMessageIndex = null
      activeVoiceHistory.activeAssistantMessageIndex = null
    }
  }
}

async function reconnectLiveVoiceSession(): Promise<boolean> {
  if (isReconnectingLive || !activeVoiceSessionParams || pendingVoiceLeave) return false
  isReconnectingLive = true
  console.log('[Discord Gateway] User spoke while WebSocket was idle. Reconnecting Gemini Live session...')

  try {
    const { apiKey, modelName } = activeVoiceSessionParams
    const ai = new GoogleGenAI({ apiKey })

    let historyContextPrompt = ''
    if (activeVoiceHistory?.messages?.length) {
      const historyLines = activeVoiceHistory.messages
        .filter((m) => typeof m.content === 'string' && m.content.trim())
        .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      if (historyLines.length > 0) {
        historyContextPrompt = `\n\n# Existing Conversation History in This Voice Session:\n${historyLines.join('\n')}`
      }
    }

    if (!activeAudioPlayer) createVoiceAudioOutput()

    const aiSession = await ai.live.connect({
      model: modelName,
      config: {
        responseModalities: [Modality.AUDIO],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        systemInstruction:
          `${getSystemToolsPrompt(modelName, 'main', undefined, 'execution', '')}\n\n` +
          '# Discord Voice Gateway\n' +
          'You are speaking with the user through Discord voice. Use the available tools whenever they are needed. ' +
          'When you use a tool, wait for its result before answering. Keep spoken answers concise and clear. ' +
          'Do not decide to leave because an isolated phrase in a transcript mentions leaving the call; consider the full conversation and use discord_leave_voice only when the user asks or leaving is contextually appropriate. ' +
          'When discord_leave_voice confirms a leave request, say a brief personalized goodbye and do not call any more tools. ' +
          'When a screenshot is returned, inspect it before answering the user.' +
          historyContextPrompt,
        tools: [
          {
            functionDeclarations: getGeminiFunctionDeclarations()
          }
        ]
      },
      callbacks: {
        onmessage: (msg: any) => handleLiveMessage(msg, aiSession, apiKey),
        onclose: () => {
          console.log('[Discord Gateway] Live WebSocket session closed.')
          if (activeLiveSession === aiSession) {
            activeLiveSession = null
            if (pendingVoiceLeave) {
              cleanupVoiceResources()
            } else {
              console.log(
                '[Discord Gateway] Standing by in Discord voice channel. Will reconnect Gemini Live WebSocket seamlessly when user speaks next.'
              )
            }
          }
        },
        onerror: (err: any) => {
          console.error('[Discord Gateway] Live session error:', err)
        }
      }
    })

    activeLiveSession = aiSession
    console.log('[Discord Gateway] Gemini Live WebSocket reconnected successfully with full history context!')

    const buffered = [...pendingAudioChunks]
    pendingAudioChunks = []
    for (const chunk of buffered) {
      activeLiveSession.sendRealtimeInput({
        audio: {
          mimeType: 'audio/pcm;rate=16000',
          data: chunk.toString('base64')
        }
      })
    }
    scheduleVoiceStreamEnd()
    return true
  } catch (err) {
    console.error('[Discord Gateway] Failed to reconnect Gemini Live session:', err)
    pendingAudioChunks = []
    return false
  } finally {
    isReconnectingLive = false
  }
}

async function startLiveVoiceSession(
  guild: any,
  voiceChannel: any,
  memberId: string,
  modelName: string,
  apiKey: string,
  statusMsg: Message
): Promise<boolean> {
  const normalizedModelName = normalizeLiveModelId(modelName)
  const voiceChatId = `discord-voice-${guild.id}-${voiceChannel.id}-${Date.now()}`
  activeVoiceHistory = {
    chatId: voiceChatId,
    title: `Voice Call - ${voiceChannel.name}`,
    modelName: normalizedModelName,
    messages: [],
    activeUserMessageIndex: null,
    activeAssistantMessageIndex: null
  }
  activeVoiceStatusMessage = statusMsg
  activeLiveToolLoopGuard = new ToolLoopGuard()
  activeVoiceOverlayChatId = voiceChatId
  activeVoiceSessionParams = { apiKey, modelName: normalizedModelName }
  persistVoiceHistory()
  broadcastIpc('chat-session-created', { id: voiceChatId })
  setCurrentSessionIdForTodo(voiceChatId)
  broadcastVoiceOverlayState('connecting')
  createVoiceOverlayWindow()
  let aiSession: any = null

  // Step 1: Connect to Gemini Live API FIRST
  try {
    console.log(`[Discord Gateway] Connecting to Gemini Live API (${normalizedModelName})...`)
    const ai = new GoogleGenAI({ apiKey })

    createVoiceAudioOutput()

    aiSession = await ai.live.connect({
      model: normalizedModelName,
      config: {
        responseModalities: [Modality.AUDIO],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        systemInstruction:
          `${getSystemToolsPrompt(normalizedModelName, 'main', undefined, 'execution', '')}\n\n` +
          '# Discord Voice Gateway\n' +
          'You are speaking with the user through Discord voice. Use the available tools whenever they are needed. ' +
          'When you use a tool, wait for its result before answering. Keep spoken answers concise and clear. ' +
          'Do not decide to leave because an isolated phrase in a transcript mentions leaving the call; consider the full conversation and use discord_leave_voice only when the user asks or leaving is contextually appropriate. ' +
          'When discord_leave_voice confirms a leave request, say a brief personalized goodbye and do not call any more tools. ' +
          'When a screenshot is returned, inspect it before answering the user.',
        tools: [
          {
            functionDeclarations: getGeminiFunctionDeclarations()
          }
        ]
      },
      callbacks: {
        onmessage: (msg: any) => handleLiveMessage(msg, aiSession, apiKey),
        onclose: () => {
          console.log('[Discord Gateway] Live WebSocket session closed.')
          if (activeLiveSession === aiSession) {
            activeLiveSession = null
            if (pendingVoiceLeave) {
              cleanupVoiceResources()
            } else {
              console.log(
                '[Discord Gateway] Standing by in Discord voice channel. Will reconnect Gemini Live WebSocket seamlessly when user speaks next.'
              )
            }
          }
        },
        onerror: (err: any) => {
          console.error('[Discord Gateway] Live session error:', err)
        }
      }
    })

    activeLiveSession = aiSession
    console.log(
      `[Discord Gateway] Gemini Live session connected successfully (${normalizedModelName}).`
    )
  } catch (e: any) {
    const errorText = e?.message || String(e)
    console.error('[Discord Gateway] Gemini Live API connection failed:', errorText)
    await statusMsg.edit(`❌ *Failed to connect to AI Live API:* ${errorText}`)
    cleanupVoiceResources()
    return false
  }

  // Step 2: Now that AI Live session is 100% working, join Discord voice channel
  try {
    await statusMsg.edit('⌛ *AI Live API Connected! Joining Discord voice channel...*')
    console.log(
      `[Discord Gateway] Joining voice channel ${voiceChannel.name} (${voiceChannel.id})...`
    )

    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false
    })
    activeVoiceConnection = connection

    connection.on('error', (err: any) => {
      console.error('[Discord Gateway] Voice connection error:', err)
    })

    connection.on('stateChange', (oldState: any, newState: any) => {
      console.log(
        `[Discord Gateway] Voice connection state: ${oldState.status} -> ${newState.status}`
      )
    })

    connection.subscribe(activeAudioPlayer)

    // Wait for VoiceConnectionStatus.Ready
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Voice connection timed out after 15 seconds.'))
      }, 15000)

      if (connection.state.status === VoiceConnectionStatus.Ready) {
        clearTimeout(timeout)
        resolve()
        return
      }

      connection.once(VoiceConnectionStatus.Ready, () => {
        clearTimeout(timeout)
        resolve()
      })

      connection.once(VoiceConnectionStatus.Disconnected, () => {
        clearTimeout(timeout)
        reject(new Error('Voice connection disconnected.'))
      })

      connection.once(VoiceConnectionStatus.Destroyed, () => {
        clearTimeout(timeout)
        reject(new Error('Voice connection destroyed.'))
      })
    })

    // Step 3: Capture Discord Audio & Stream to Gemini
    activeVoiceReceiver = connection.receiver
    activeVoiceMemberId = memberId
    if (!attachVoiceInputPipeline()) {
      throw new Error('Failed to attach Discord audio receiver.')
    }

    console.log(`[Discord Gateway] Voice session 100% active in channel ${voiceChannel.name}`)
    broadcastVoiceOverlayState('connected')
    resetVoiceInactivityTimer()
    await statusMsg.edit(`✅ *Connected to voice channel "${voiceChannel.name}"! Speak now.*`)
    return true
  } catch (e: any) {
    const errorText = e?.message || String(e)
    console.error('[Discord Gateway] Voice join error:', errorText)
    await statusMsg.edit(`❌ *Failed to join voice channel:* ${errorText}`)

    cleanupVoiceResources()
    return false
  }
}

export function requestDiscordVoiceLeave(): boolean {
  const hasVoiceResources = Boolean(
    activeLiveSession ||
      activeAudioPlayer ||
      activeVoiceConnection ||
      activeVoiceInputStream ||
      activeVoiceDecoder ||
      activeSpeakerStream
  )
  if (!hasVoiceResources) return false

  if (!activeLiveSession) {
    return leaveDiscordVoiceChannel()
  }

  if (!pendingVoiceLeave) {
    pendingVoiceLeave = {
      farewellRequested: false,
      responseStarted: false,
      audioReceived: false,
      turnComplete: false,
      player: null
    }
  }
  void activeVoiceStatusMessage?.edit('⌛ *Preparing a brief goodbye before leaving...*').catch(() => {})
  return true
}

export function requestDiscordVoiceFarewell(): boolean {
  const pending = pendingVoiceLeave
  const session = activeLiveSession
  if (!pending || !session) return false
  if (pending.farewellRequested) return true

  pending.farewellRequested = true
  try {
    if (activeSpeakerStream && !activeSpeakerStream.destroyed) {
      createVoiceAudioOutput()
    }
    appendVoiceTranscript('user', 'The user explicitly requested to end the Discord voice call.')
    session.sendClientContent({
      turns: [
        {
          role: 'user',
          parts: [
            {
              text:
                'The user explicitly requested to end this Discord voice call. Say a brief, personalized goodbye based on our conversation. Do not call any tools.'
            }
          ]
        }
      ],
      turnComplete: true
    })
    return true
  } catch (error) {
    console.error('[Discord Gateway] Failed to request Live farewell:', error)
    leaveDiscordVoiceChannel()
    return false
  }
}

export function startDiscordGateway(config: AppConfig): void {
  if (!config.discordGatewayEnabled || !config.discordBotToken) {
    if (client) {
      stopDiscordGateway()
    }
    return
  }

  currentConfig = config

  if (client) {
    stopDiscordGateway()
  }

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.GuildVoiceStates
    ],
    partials: [Partials.Channel, Partials.Message]
  })

  client.once('ready', async () => {
    console.log(`[Discord Gateway] Logged in as ${client?.user?.tag}`)
    try {
      const app = await client?.application?.fetch()
      if (app?.owner) {
        if ('members' in app.owner) {
          app.owner.members.forEach((m) => appOwnerIds.add(m.id))
        } else {
          appOwnerIds.add(app.owner.id)
        }
      }
    } catch (e) {
      console.error('[Discord Gateway] Failed to fetch application owner:', e)
    }
  })

  client.on('messageCreate', handleDiscordMessage)

  client.login(config.discordBotToken).catch((err) => {
    console.error('[Discord Gateway] Failed to login:', err)
  })
}

export function stopDiscordGateway(): void {
  leaveDiscordVoiceChannel()
  if (client) {
    console.log('[Discord Gateway] Disconnecting...')
    client.destroy()
    client = null
    appOwnerIds.clear()
  }
}

async function handleDiscordMessage(message: Message): Promise<void> {
  if (message.author.bot) return

  // Check if author is owner
  if (!appOwnerIds.has(message.author.id)) {
    if (!client?.application) return
    try {
      const app = await client.application.fetch()
      if (app.owner) {
        if ('members' in app.owner) {
          app.owner.members.forEach((m) => appOwnerIds.add(m.id))
        } else {
          appOwnerIds.add(app.owner.id)
        }
      }
    } catch (e) {
      // Ignore
    }
    if (!appOwnerIds.has(message.author.id)) {
      return // Ignore messages from non-owners
    }
  }

  const content = message.content.trim()
  const lowerContent = content.toLowerCase()
  const isDM = message.channel.type === ChannelType.DM
  const botId = client?.user?.id

  // Command: prism=new or prism=clear
  if (isDM && (lowerContent === 'prism=new' || lowerContent === 'prism=clear')) {
    const dmId = `discord-dm-${message.author.id}-${Date.now()}`
    activeDmSessions.set(message.author.id, dmId)
    await message.reply('Started a new conversation history.')
    return
  }

  // Command: prism=chat
  if (!isDM && lowerContent.startsWith('prism=chat')) {
    const requestText = content.substring('prism=chat'.length).trim()
    if (!requestText) {
      await message.reply('Please provide a message after prism=chat')
      return
    }

    try {
      const thread = await message.startThread({
        name: 'New Chat',
        autoArchiveDuration: 60,
        reason: 'Prism AI Gateway Chat'
      })
      await processAiMessage(thread, message.author, requestText, `discord-thread-${thread.id}`)
    } catch (e) {
      console.error('[Discord Gateway] Failed to create thread:', e)
      await message.reply('Failed to create a chat thread. Check my permissions.')
    }
    return
  }

  // Command: prism=join
  if (!isDM && lowerContent.startsWith('prism=join')) {
    const member = message.guild?.members.cache.get(message.author.id)
    if (!member?.voice.channel) {
      await message.reply('You need to join a voice channel first!')
      return
    }

    const configuredVoiceModel =
      currentConfig?.discordGatewayVoiceModel?.trim() || currentConfig?.discordGatewayModel?.trim()
    const fallbackVoiceModel = 'gemini-3.1-flash-live-preview'

    const statusMsg = await message.reply(
      '⌛ *Initializing Prism Voice Gateway... Verifying AI model & API key...*'
    )

    if (activeLiveSession || activeVoiceConnection) {
      console.log('[Discord Gateway] Replacing the existing voice session.')
      leaveDiscordVoiceChannel()
    }

    const modelKey =
      configuredVoiceModel ||
      currentConfig?.defaultModel ||
      currentConfig?.lastSelectedChatModel ||
      getChatModel() ||
      fallbackVoiceModel

    const { provider: activeProvider, model: activeModel } = resolveProviderAndModel(modelKey)
    const apiKey = activeProvider?.apiKey

    if (!apiKey || apiKey === 'prism_account_auth') {
      const errMsg = `Cannot start voice session: No valid API key found for provider "${activeProvider?.name || 'Active Provider'}" in Prism Settings.`
      console.error(`[Discord Gateway] Voice Error: ${errMsg}`)
      await statusMsg.edit(`❌ ${errMsg}`)
      return
    }

    const realtimeModel = normalizeLiveModelId(activeModel?.id || modelKey || fallbackVoiceModel)
    console.log(
      `[Discord Gateway] Voice model selected: ${realtimeModel} ` +
        `(provider: ${activeProvider?.name || 'unknown'})`
    )

    await startLiveVoiceSession(
      message.guild!,
      member.voice.channel,
      message.author.id,
      realtimeModel,
      apiKey,
      statusMsg
    )
    return
  }

  // Commands: prism=exit or prism=quit
  if (!isDM && (lowerContent === 'prism=exit' || lowerContent === 'prism=quit')) {
    if (requestDiscordVoiceLeave()) {
      if (requestDiscordVoiceFarewell()) {
        await message.reply('I will say goodbye before leaving the voice channel.')
      } else {
        await message.reply('Left the voice channel.')
      }
    } else {
      await message.reply('I am not currently in a voice channel.')
    }
    return
  }

  // Command: prism=help
  if (lowerContent.startsWith('prism=help')) {
    const args = lowerContent.split(' ')
    const page = args.length > 1 ? parseInt(args[1]) : 1

    if (page === 2) {
      await message.reply({
        embeds: [
          {
            color: 0x5865f2,
            title: 'Prism AI Gateway Help (Page 2/2)',
            description: 'Behavior & Notes:',
            fields: [
              {
                name: 'How to talk to Prism',
                value:
                  'In a DM or an active Thread, Prism will only respond if the message contains the word "prism" or if Prism is @mentioned.'
              },
              {
                name: 'Audio Features',
                value:
                  'When using `prism=join`, Prism will stream audio directly into the voice channel. Currently only the bot owner can trigger voice responses.'
              }
            ],
            footer: { text: 'Type "prism=help 1" for the commands list.' }
          }
        ]
      })
    } else {
      await message.reply({
        embeds: [
          {
            color: 0x5865f2,
            title: 'Prism AI Gateway Help (Page 1/2)',
            description: 'Commands to interact with Prism:',
            fields: [
              {
                name: '`prism=chat <message>`',
                value: 'Starts a new AI chat thread with your request (Servers only).'
              },
              {
                name: '`prism=new` or `prism=clear`',
                value: 'Clears history and starts a new conversation (DMs only).'
              },
              { name: '`prism=join`', value: 'Joins your current voice channel (Servers only).' },
              {
                name: '`prism=exit` or `prism=quit`',
                value: 'Says goodbye and leaves the current voice channel (Servers only).'
              }
            ],
            footer: { text: 'Type "prism=help 2" for more info.' }
          }
        ]
      })
    }
    return
  }

  // Non-command message processing (Threads and DMs)
  // For the owner, we skip the mention requirement.
  const isOwner = appOwnerIds.has(message.author.id)

  if (!isOwner) {
    const mentionsBot = botId ? message.mentions.has(botId) : false
    const botNameLower = client?.user?.username?.toLowerCase()
    const containsName =
      lowerContent.includes('prism') || (botNameLower ? lowerContent.includes(botNameLower) : false)

    if (!mentionsBot && !containsName) {
      return
    }
  }

  if (!isDM && message.channel.isThread()) {
    const thread = message.channel as ThreadChannel
    if (thread.ownerId === botId) {
      await processAiMessage(thread, message.author, content, `discord-thread-${thread.id}`)
    }
    return
  }

  if (isDM) {
    const dmId = getActiveDmSessionId(message.author.id)
    await processAiMessage(message.channel, message.author, content, dmId)
    return
  }
}

async function processAiMessage(channel: any, _author: any, userText: string, chatId: string) {
  if (!currentConfig) return

  const modelKey =
    currentConfig.discordGatewayModel?.trim() ||
    currentConfig.defaultModel ||
    currentConfig.lastSelectedChatModel ||
    getChatModel() ||
    'gemini-3.6-flash'

  const { provider, model } = resolveProviderAndModel(modelKey)

  if (!provider || !provider.apiKey || !model) {
    await channel.send('Gateway Error: No AI provider or API key configured in Prism Settings.')
    return
  }

  await channel.sendTyping()
  const typingInterval = setInterval(() => channel.sendTyping(), 9000)

  const session = loadChatSession(chatId)
  const historyMessages: OpenAiMessage[] = session
    ? hydrateHistoryToolAttachments(chatId, session.messages)
    : []
  const isFirstMessage = historyMessages.length === 0

  historyMessages.push({
    role: 'user',
    content: userText
  })

  saveChatSession(
    chatId,
    historyMessages,
    isFirstMessage ? 'New Conversation' : undefined,
    'execution',
    '',
    modelKey,
    true
  )

  if (isFirstMessage) {
    broadcastIpc('chat-session-created', { id: chatId })
    generateTitleInBackground(provider, model.id, userText, chatId, channel)
  }

  // Broadcast user message and start reply event to Prism renderer UI
  broadcastIpc('chat-reply-start', {
    chatId,
    userMessage: { role: 'user', content: userText }
  })

  const baseSystemPrompt = getSystemToolsPrompt(model.id, 'main', undefined, 'execution', '')
  const botName = client?.user?.username || 'AI'
  const discordSystemPrompt = `${baseSystemPrompt}\n\n# Discord Gateway Mode\nYou are ${botName} running on Discord via Prism Gateway. Adopt the name ${botName} and NOT Prism. Keep responses concise due to Discord limits (max 2000 chars). Use simple Markdown only (bold, italics, H1-H3, code blocks). Do not use HTML or Markdown tables.`

  const messagesForApi: OpenAiMessage[] = [
    { role: 'system', content: discordSystemPrompt },
    ...convertHistoryToOpenAi(historyMessages)
  ]

  const abortController = new AbortController()
  activeRuns.set(chatId, {
    chatId,
    abortController,
    streamedText: '',
    status: 'running'
  })
  setCurrentSessionIdForTodo(chatId)

  let replyMessage: Message | null = null
  try {
    replyMessage = await channel.send('*Thinking...*')
  } catch (e) {
    console.error('Failed to send initial reply message', e)
  }

  let currentText = ''
  let currentToolsText = ''
  let lastEditTime = Date.now()

  const updateDiscordMessage = async (text: string, force = false) => {
    if (!replyMessage) return
    const now = Date.now()
    if (force || now - lastEditTime > 1500) {
      lastEditTime = now
      let contentToEdit = text.length > 0 ? text : '*Thinking...*'
      if (currentToolsText) {
        contentToEdit += `\n\n${currentToolsText}`
      }

      if (contentToEdit.length > 2000) {
        contentToEdit = contentToEdit.substring(0, 1997) + '...'
      }

      try {
        await replyMessage.edit(contentToEdit)
      } catch (e) {
        if (is.dev) console.error('[Discord Gateway] Edit message failed:', e)
      }
    }
  }

  const parseThoughtAndContent = (
    rawText: string,
    extraReasoning: string
  ): { thoughts: string; content: string } => {
    let thoughts = extraReasoning || ''
    let content = rawText
    const thinkMatch = rawText.match(/<think>([\s\S]*?)(?:<\/think>|$)/i)
    if (thinkMatch) {
      thoughts = thoughts ? `${thoughts}\n${thinkMatch[1]}` : thinkMatch[1]
      content = rawText.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*/gi, '')
    }
    return { thoughts, content }
  }

  const openAiTools = getOpenAiToolDefinitions()

  try {
    const orchestration = await runToolOrchestration({
      provider,
      modelId: model.id,
      messages: messagesForApi,
      tools: openAiTools,
      signal: abortController.signal,
      reasoningLevel: normalizePrismThinkingLevel(provider, model.id, 'minimal'),
      onStreamEvent: (streamEvent, state) => {
        if (streamEvent.type === 'tool') {
          broadcastIpc('chat-tool-call-delta', { chatId, ...streamEvent.delta })
          currentToolsText = `*⚙️ ${streamEvent.delta.name || 'Working'}...*`
          updateDiscordMessage(currentText)
        } else {
          currentText = state.accumulatedText
            ? `${state.accumulatedText}\n\n${state.currentText}`
            : state.currentText
          const combinedReasoning = state.accumulatedReasoning
            ? `${state.accumulatedReasoning}\n\n${state.currentReasoning}`
            : state.currentReasoning
          const parsed = parseThoughtAndContent(currentText, combinedReasoning)

          broadcastIpc('chat-reply-chunk', {
            chatId,
            thoughts: parsed.thoughts,
            finalResponse: parsed.content,
            isThinking: streamEvent.type === 'reasoning',
            isWritingToolCall: state.streamingToolCalls.length > 0
          })

          const discordText = currentText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
          updateDiscordMessage(discordText)
        }
      },
      decorateAssistantMessage: (msg) => msg,
      createToolContext: ({ callId, name }) => ({
        event: null as any,
        apiKey: provider.apiKey,
        signal: abortController.signal,
        chatId,
        onStart: (args) => {
          broadcastIpc('chat-tool-start', {
            callId,
            name,
            args,
            timestamp: Date.now(),
            chatId
          })
          if (is.dev) console.log(`[Discord Gateway] Tool Start: ${name}`, args)
        }
      }),
      onToolResult: (call) => {
        broadcastIpc('chat-tool-end', {
          callId: call.callId,
          name: call.name,
          result: call.modelContent,
          chatId
        })
        if (is.dev) console.log(`[Discord Gateway] Tool End: ${call.name}`)
        currentToolsText = ''
      },
      onHistoryMessage: (historyMessage) => {
        historyMessages.push(prepareHistoryMessage(chatId, historyMessage))
        saveChatSession(chatId, historyMessages, undefined, 'execution', '', modelKey, true)
      },
      finalInstruction: 'Tool limit reached.'
    })

    const finalOutput = parseThoughtAndContent(
      orchestration.accumulatedText,
      orchestration.accumulatedReasoning
    )
    let discordFinalOutput = finalOutput.content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
    if (!discordFinalOutput) discordFinalOutput = '*No response generated.*'

    currentToolsText = ''
    await updateDiscordMessage(discordFinalOutput, true)

    broadcastIpc('chat-reply-end', {
      thoughts: finalOutput.thoughts,
      finalResponse: finalOutput.content,
      rawText: finalOutput.content,
      isThinking: false,
      chatId,
      ...(orchestration.loopLimitReached ? { loopLimitReached: true } : {})
    })
  } catch (error: any) {
    console.error('[Discord Gateway] Error:', error)
    broadcastIpc('chat-reply-error', { error: error.message || 'Unknown error occurred.', chatId })
    if (replyMessage) {
      await replyMessage.edit(`*Error:* ${error.message || 'Unknown error occurred.'}`)
    } else {
      await channel.send(`*Error:* ${error.message || 'Unknown error occurred.'}`)
    }
  } finally {
    activeRuns.delete(chatId)
    clearInterval(typingInterval)
  }
}

function convertHistoryToOpenAi(history: OpenAiMessage[]): OpenAiMessage[] {
  return history
    .filter((m) => m.role !== 'system')
    .map((m) => {
      if (m.role === 'tool') {
        return {
          role: 'tool',
          tool_call_id: m.tool_call_id || `call_${Date.now()}`,
          name: m.name,
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
          tool_attachments: m.tool_attachments
        }
      }
      const content =
        m.content ?? (m.parts ? m.parts.map((part) => part.text || '').join('\n') : null)
      return {
        role: m.role === 'model' ? 'assistant' : m.role,
        content: content || '',
        tool_calls: m.tool_calls,
        provider_metadata: m.provider_metadata
      }
    })
}

async function generateTitleInBackground(
  provider: import('../shared/types').ProviderConfig,
  modelId: string,
  firstMessage: string,
  chatId: string,
  channel: any
): Promise<void> {
  try {
    const prompt = `Summarize query into concise 3-5 word title in same language. No quotes or punctuation: "${firstMessage}"`
    const abortController = new AbortController()

    const res = await streamOpenAiCompletion(
      provider,
      modelId,
      [{ role: 'user', content: prompt }],
      [],
      abortController.signal,
      { onTextDelta: () => {}, onReasoningDelta: () => {}, onToolCallDelta: () => {} },
      undefined,
      { skipUsageIncrement: true }
    )

    let title = res.text.replace(/["']/g, '').trim()
    if (!title || title.length > 50) title = 'New Conversation'

    updateChatSessionTitle(chatId, title)
    broadcastIpc('chat-title-received', { id: chatId, title })

    if (channel.isThread()) {
      await (channel as ThreadChannel).setName(title)
    }
  } catch {
    updateChatSessionTitle(chatId, 'New Conversation')
    broadcastIpc('chat-title-received', { id: chatId, title: 'New Conversation' })
  }
}

export function leaveDiscordVoiceChannel(): boolean {
  const hadVoiceResources = cleanupVoiceResources()
  let left = hadVoiceResources

  if (client) {
    const guilds = client.guilds.cache.map((guild) => guild.id)
    for (const guildId of guilds) {
      const connection = getVoiceConnection(guildId)
      if (connection) {
        try {
          connection.destroy()
        } catch (error) {
          console.error('[Discord Gateway] Failed to destroy voice connection:', error)
        }
        left = true
      }
    }
  }

  if (left) console.log('[Discord Gateway] Voice session stopped.')
  return left
}
