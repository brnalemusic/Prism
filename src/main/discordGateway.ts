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
  VoiceConnectionStatus,
  EndBehaviorType,
  createAudioPlayer,
  createAudioResource,
  StreamType
} from '@discordjs/voice'
import { GoogleGenAI, Modality } from '@google/genai'
import prism from 'prism-media'
import { PassThrough } from 'stream'
import { AppConfig } from './config'
import { loadChatSession, saveChatSession, updateChatSessionTitle, listChatSessions } from './history'
import { resolveProviderAndModel } from './ai/providerManager'
import { getChatModel } from './ai/chatHandler'
import { runToolOrchestration } from './ai/toolOrchestrator'
import { OpenAiMessage } from './ai/types'
import { getSystemToolsPrompt, setCurrentSessionIdForTodo } from './systemTools'
import { getOpenAiToolDefinitions } from './toolRuntime'
import { normalizePrismThinkingLevel } from './ai/prismThinking'
import { streamOpenAiCompletion } from './ai/openaiClient'
import { is } from '@electron-toolkit/utils'

let client: Client | null = null
let currentConfig: AppConfig | null = null
let appOwnerIds: Set<string> = new Set()

let activeLiveSession: any = null
let activeAudioPlayer: any = null

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

function upsample16kMonoTo48kStereo(pcm16k: Buffer): Buffer {
  const numFrames = pcm16k.length / 2
  const numOutFrames = numFrames * 3
  const outBuffer = Buffer.alloc(numOutFrames * 4)

  for (let i = 0; i < numFrames; i++) {
    const sample = pcm16k.readInt16LE(i * 2)
    for (let j = 0; j < 3; j++) {
      const outIndex = (i * 3 + j) * 4
      outBuffer.writeInt16LE(sample, outIndex)
      outBuffer.writeInt16LE(sample, outIndex + 2)
    }
  }
  return outBuffer
}

async function startLiveVoiceSession(
  guild: any,
  voiceChannel: any,
  memberId: string,
  modelName: string,
  apiKey: string,
  statusMsg: Message
): Promise<boolean> {
  let aiSession: any = null
  let speakerStream: PassThrough | null = null

  // Step 1: Connect to Gemini Live API FIRST
  try {
    console.log(`[Discord Gateway] Connecting to Gemini Live API (${modelName})...`)
    const ai = new GoogleGenAI({ apiKey })

    speakerStream = new PassThrough()
    activeAudioPlayer = createAudioPlayer()
    const resource = createAudioResource(speakerStream, { inputType: StreamType.Raw })
    activeAudioPlayer.play(resource)

    activeAudioPlayer.on('error', (err: any) => {
      console.error('[Discord Gateway] Audio player error:', err)
    })

    aiSession = await ai.live.connect({
      model: modelName,
      config: {
        responseModalities: [Modality.AUDIO]
      },
      callbacks: {
        onmessage: (msg: any) => {
          const parts = msg?.serverContent?.modelTurn?.parts
          if (parts) {
            for (const part of parts) {
              if (part.inlineData?.data) {
                const pcm16kBuffer = Buffer.from(part.inlineData.data, 'base64')
                const pcm48kBuffer = upsample16kMonoTo48kStereo(pcm16kBuffer)
                if (speakerStream && !speakerStream.destroyed) {
                  speakerStream.write(pcm48kBuffer)
                }
              }
            }
          }
        },
        onclose: () => {
          console.log('[Discord Gateway] Live session closed')
          if (speakerStream && !speakerStream.destroyed) {
            speakerStream.end()
          }
        },
        onerror: (err: any) => {
          console.error('[Discord Gateway] Live session error:', err)
        }
      }
    })

    activeLiveSession = aiSession
    console.log('[Discord Gateway] Gemini Live Session connected successfully.')
  } catch (e: any) {
    const errorText = e?.message || String(e)
    console.error('[Discord Gateway] Gemini Live API connection failed:', errorText)
    await statusMsg.edit(`❌ *Failed to connect to AI Live API:* ${errorText}`)
    if (speakerStream) speakerStream.destroy()
    return false
  }

  // Step 2: Now that AI Live session is 100% working, join Discord voice channel
  try {
    await statusMsg.edit('⌛ *AI Live API Connected! Joining Discord voice channel...*')
    console.log(`[Discord Gateway] Joining voice channel ${voiceChannel.name} (${voiceChannel.id})...`)

    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false
    })

    connection.on('error', (err: any) => {
      console.error('[Discord Gateway] Voice connection error:', err)
    })

    connection.subscribe(activeAudioPlayer)

    // Wait for VoiceConnectionStatus.Ready
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Voice connection timed out after 15 seconds.'))
      }, 15000)

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
    const receiver = connection.receiver
    const audioStream = receiver.subscribe(memberId, {
      end: {
        behavior: EndBehaviorType.Manual
      }
    })

    const decoder = new prism.opus.Decoder({ frameSize: 960, channels: 2, rate: 48000 })

    audioStream.on('error', (err: any) => {
      console.error('[Discord Gateway] AudioStream error:', err)
    })

    decoder.on('error', (err: any) => {
      console.error('[Discord Gateway] Opus Decoder error:', err)
    })

    audioStream.pipe(decoder).on('data', (pcm48kChunk: Buffer) => {
      try {
        if (activeLiveSession) {
          const pcm16kChunk = downsample48kStereoTo16kMono(pcm48kChunk)
          const base64Data = pcm16kChunk.toString('base64')

          if (typeof activeLiveSession.sendRealtimeInput === 'function') {
            activeLiveSession.sendRealtimeInput([
              {
                mimeType: 'audio/pcm;rate=16000',
                data: base64Data
              }
            ])
          } else if (typeof activeLiveSession.send === 'function') {
            activeLiveSession.send({
              realtimeInput: {
                mediaChunks: [
                  {
                    mimeType: 'audio/pcm;rate=16000',
                    data: base64Data
                  }
                ]
              }
            })
          }
        }
      } catch (err) {
        console.error('[Discord Gateway] Error sending audio chunk to Gemini Live:', err)
      }
    })

    console.log(`[Discord Gateway] Voice session 100% active in channel ${voiceChannel.name}`)
    await statusMsg.edit(`✅ *Connected to voice channel "${voiceChannel.name}"! Speak now.*`)
    return true
  } catch (e: any) {
    const errorText = e?.message || String(e)
    console.error('[Discord Gateway] Voice join error:', errorText)
    await statusMsg.edit(`❌ *Failed to join voice channel:* ${errorText}`)

    if (activeLiveSession) {
      try {
        activeLiveSession.close()
      } catch {}
      activeLiveSession = null
    }
    if (activeAudioPlayer) {
      try {
        activeAudioPlayer.stop()
      } catch {}
      activeAudioPlayer = null
    }
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

    const realtimeModel =
      currentConfig?.discordGatewayModel || 'models/gemini-3.1-flash-live-preview'

    const statusMsg = await message.reply(
      '⌛ *Initializing Prism Voice Gateway... Verifying AI model & API key...*'
    )

    const modelToUse =
      currentConfig?.discordGatewayModel ||
      currentConfig?.defaultModel ||
      currentConfig?.lastSelectedChatModel ||
      getChatModel() ||
      realtimeModel

    const { provider: activeProvider } = resolveProviderAndModel(modelToUse)
    const apiKey = activeProvider?.apiKey

    if (!apiKey || apiKey === 'prism_account_auth') {
      const errMsg = `Cannot start voice session: No valid API key found for provider "${activeProvider?.name || 'Active Provider'}" in Prism Settings.`
      console.error(`[Discord Gateway] Voice Error: ${errMsg}`)
      await statusMsg.edit(`❌ ${errMsg}`)
      return
    }

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

  // Command: prism=exit
  if (!isDM && lowerContent.startsWith('prism=exit')) {
    if (leaveDiscordVoiceChannel()) {
      await message.reply('Left the voice channel.')
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
        embeds: [{
          color: 0x5865F2,
          title: 'Prism AI Gateway Help (Page 2/2)',
          description: 'Behavior & Notes:',
          fields: [
            { name: 'How to talk to Prism', value: 'In a DM or an active Thread, Prism will only respond if the message contains the word "prism" or if Prism is @mentioned.' },
            { name: 'Audio Features', value: 'When using `prism=join`, Prism will stream audio directly into the voice channel. Currently only the bot owner can trigger voice responses.' }
          ],
          footer: { text: 'Type "prism=help 1" for the commands list.' }
        }]
      })
    } else {
      await message.reply({
        embeds: [{
          color: 0x5865F2,
          title: 'Prism AI Gateway Help (Page 1/2)',
          description: 'Commands to interact with Prism:',
          fields: [
            { name: '`prism=chat <message>`', value: 'Starts a new AI chat thread with your request (Servers only).' },
            { name: '`prism=new` or `prism=clear`', value: 'Clears history and starts a new conversation (DMs only).' },
            { name: '`prism=join`', value: 'Joins your current voice channel (Servers only).' }
          ],
          footer: { text: 'Type "prism=help 2" for more info.' }
        }]
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
    const containsName = lowerContent.includes('prism') || (botNameLower ? lowerContent.includes(botNameLower) : false)

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

async function processAiMessage(
  channel: any,
  _author: any,
  userText: string,
  chatId: string
) {
  if (!currentConfig) return

  const modelKey =
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
  const historyMessages: OpenAiMessage[] = session ? session.messages : []
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
    generateTitleInBackground(provider, model.id, userText, chatId, channel)
  }

  const baseSystemPrompt = getSystemToolsPrompt(model.id, 'main', undefined, 'execution', '')
  const botName = client?.user?.username || 'AI'
  const discordSystemPrompt = `${baseSystemPrompt}\n\n# Discord Gateway Mode\nYou are ${botName} running on Discord via Prism Gateway. Adopt the name ${botName} and NOT Prism. Keep responses concise due to Discord limits (max 2000 chars). Use simple Markdown only (bold, italics, H1-H3, code blocks). Do not use HTML or Markdown tables.`

  const messagesForApi: OpenAiMessage[] = [
    { role: 'system', content: discordSystemPrompt },
    ...convertHistoryToOpenAi(historyMessages)
  ]

  const abortController = new AbortController()
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
          currentToolsText = `*⚙️ ${streamEvent.delta.name || 'Working'}...*`
          updateDiscordMessage(currentText)
        } else {
          currentText = state.accumulatedText ? `${state.accumulatedText}\n\n${state.currentText}` : state.currentText
          currentText = currentText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
          updateDiscordMessage(currentText)
        }
      },
      decorateAssistantMessage: (msg) => msg,
      createToolContext: ({ name }) => ({
        event: null as any,
        apiKey: provider.apiKey,
        signal: abortController.signal,
        chatId,
        onStart: (args) => {
          if (is.dev) console.log(`[Discord Gateway] Tool Start: ${name}`, args)
        }
      }),
      onToolResult: (call) => {
        if (is.dev) console.log(`[Discord Gateway] Tool End: ${call.name}`)
        currentToolsText = ''
      },
      onHistoryMessage: (historyMessage) => {
        historyMessages.push(historyMessage)
        saveChatSession(chatId, historyMessages, undefined, 'execution', '', modelKey, true)
      },
      finalInstruction: 'Tool limit reached.'
    })

    let finalOutput = orchestration.accumulatedText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
    if (!finalOutput) finalOutput = '*No response generated.*'
    
    currentToolsText = ''
    await updateDiscordMessage(finalOutput, true)

  } catch (error: any) {
    console.error('[Discord Gateway] Error:', error)
    if (replyMessage) {
      await replyMessage.edit(`*Error:* ${error.message || 'Unknown error occurred.'}`)
    } else {
      await channel.send(`*Error:* ${error.message || 'Unknown error occurred.'}`)
    }
  } finally {
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
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
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
    
    if (channel.isThread()) {
      await (channel as ThreadChannel).setName(title)
    }

  } catch {
    updateChatSessionTitle(chatId, 'New Conversation')
  }
}

export function leaveDiscordVoiceChannel(): boolean {
  if (client) {
    if (activeLiveSession) {
      // Just close it if there's a close method
      try { activeLiveSession.close() } catch {}
      activeLiveSession = null
    }
    if (activeAudioPlayer) {
      try { activeAudioPlayer.stop() } catch {}
      activeAudioPlayer = null
    }

    const guilds = client.guilds.cache.map((guild) => guild.id)
    let left = false
    const { getVoiceConnection } = require('@discordjs/voice')
    for (const guildId of guilds) {
      const connection = getVoiceConnection(guildId)
      if (connection) {
        connection.destroy()
        left = true
      }
    }
    return left
  }
  return false
}
