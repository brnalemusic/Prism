import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
// These private components are exported only by the validation server's transform.
import { AiMessageRow } from '../../src/renderer/src/App'
import { LauncherAiMessage } from '../../src/renderer/src/components/QuickLauncher'
import { StaticMarkdownComponents } from '../../src/renderer/src/components/AnimatedStreamingText'
import {
  anchorStreamingCalls,
  bindChatTool,
  upsertChatRound
} from '../../src/renderer/src/chatTimeline'
import { applyToolCallStart, applyToolCallEnd } from '../../src/renderer/src/toolCallState'
import type { Message } from '../../src/renderer/src/types/tab'
import '../../src/renderer/src/assets/main.css'

const SAMPLE_IMAGE =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

function snapshot(step: number): Message {
  const msg: Message = {
    role: 'ai',
    content: 'Text A: I will inspect the files.',
    isStreaming: true,
    chatRounds: [{ round: 1, content: 'Text A: I will inspect the files.' }],
    workedDuration: 8
  }
  msg.streamingToolCalls = anchorStreamingCalls(
    [],
    [
      {
        index: 0,
        id: 'first',
        name: 'computer_use_read_file',
        arguments: step === 0 ? '{"path":"example.ts"' : '{"progressTitle":"Read',
        isComplete: false
      }
    ],
    1,
    msg.content
  )
  if (step < 2) return msg
  msg.toolCalls = applyToolCallStart([], {
    callId: 'first',
    name: 'computer_use_read_file',
    args: { path: 'example.ts', progressTitle: 'Reading the file', completedTitle: 'Read the file' }
  })
  bindChatTool(msg, 'first', 'computer_use_read_file', 1)
  msg.toolCalls = applyToolCallEnd(msg.toolCalls, {
    callId: 'first',
    name: 'computer_use_read_file',
    result: 'File content'
  })
  if (step === 2) return msg
  const middle =
    'Text B: I found the section to check.\n\n' +
    Array.from(
      { length: 24 },
      (_, i) => `Intermediate paragraph ${i + 1}: details remain inside the work history.`
    ).join('\n\n')
  msg.chatRounds = upsertChatRound(msg.chatRounds, 2, middle)
  msg.toolCalls = applyToolCallStart(msg.toolCalls, {
    callId: 'second',
    name: 'web_search',
    args: {
      progressTitle: 'Checking the reference',
      completedTitle: 'Checked the reference',
      query: 'example'
    }
  })
  bindChatTool(msg, 'second', 'web_search', 2)
  msg.toolCalls = applyToolCallEnd(msg.toolCalls, {
    callId: 'second',
    name: 'web_search',
    result: 'Reference found'
  })
  msg.content += '\n\n' + middle
  if (step === 3) return msg
  if (step === 4) {
    msg.chatRounds = upsertChatRound(
      msg.chatRounds,
      3,
      'Final answer: the verification is complete.'
    )
    msg.content += '\n\nFinal answer: the verification is complete.'
    msg.isStreaming = false
    return msg
  }
  msg.chatRounds = upsertChatRound(msg.chatRounds, 3, 'I will create the final visual now.')
  msg.content += '\n\nI will create the final visual now.'
  msg.toolCalls = applyToolCallStart(msg.toolCalls, {
    callId: 'image-result',
    name: 'generate_image',
    args: {
      progressTitle: 'Shaping the midnight landscape',
      completedTitle: 'Created the midnight landscape',
      prompt: 'A quiet midnight landscape',
      size: '1024x1024'
    }
  })
  bindChatTool(msg, 'image-result', 'generate_image', 3)
  if (step === 5) return msg
  msg.toolCalls = applyToolCallStart(msg.toolCalls, {
    callId: 'image-error',
    name: 'generate_image',
    args: {
      progressTitle: 'Trying an alternate treatment',
      completedTitle: 'Created an alternate treatment',
      prompt: 'An alternate treatment',
      size: '1024x1024'
    }
  })
  bindChatTool(msg, 'image-error', 'generate_image', 3)
  msg.toolCalls = applyToolCallEnd(msg.toolCalls, {
    callId: 'image-error',
    name: 'generate_image',
    result:
      '{"ok":false,"error":{"code":"IMAGE_RATE_LIMIT","message":"Please try again.","retryable":true}}'
  })
  msg.toolCalls = applyToolCallEnd(msg.toolCalls, {
    callId: 'image-result',
    name: 'generate_image',
    result: '{"ok":true}',
    attachments: [
      {
        kind: 'image',
        mimeType: 'image/png',
        data: SAMPLE_IMAGE,
        width: 1,
        height: 1,
        name: 'timeline-validation.png'
      }
    ]
  })
  msg.chatRounds = upsertChatRound(msg.chatRounds, 4, 'Here is the finished image.')
  msg.content += '\n\nHere is the finished image.'
  msg.isStreaming = false
  return msg
}

function Fixture() {
  const [step, setStep] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const msg = snapshot(step)
  useEffect(() => {
    const scrollers = root.current!.querySelectorAll<HTMLElement>('[data-prism-chat-scroll]')
    const cleanups = Array.from(scrollers).map((scroller) => {
      let follow = true
      const scroll = () => {
        follow = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 80
      }
      const toggle = () => {
        follow = false
      }
      const observer = new ResizeObserver(() => {
        if (follow) scroller.scrollTop = scroller.scrollHeight
      })
      observer.observe(scroller.firstElementChild!)
      scroller.addEventListener('scroll', scroll)
      scroller.addEventListener('prism-work-toggle', toggle)
      return () => {
        observer.disconnect()
        scroller.removeEventListener('scroll', scroll)
        scroller.removeEventListener('prism-work-toggle', toggle)
      }
    })
    return () => cleanups.forEach((fn) => fn())
  }, [])
  return (
    <div
      ref={root}
      style={{ padding: 24, background: '#171717', color: '#eee', minHeight: '100vh' }}
    >
      <h1>Prism timeline validation</h1>
      <nav style={{ display: 'flex', gap: 20, margin: '20px 0' }}>
        {[
          'No title',
          'Partial title',
          'Completed action',
          'Intermediate history',
          'Finished turn',
          'Generating image',
          'Image result'
        ].map((label, index) => (
          <button key={label} onClick={() => setStep(index)}>
            {label}
          </button>
        ))}
      </nav>
      <p role="status">Stage {step}</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
        {['Chat', 'Launcher'].map((label) => (
          <section key={label} aria-label={label}>
            <h2>{label}</h2>
            <div
              data-prism-chat-scroll="true"
              style={{ height: 480, overflowY: 'auto', border: '1px solid #444', marginTop: 16 }}
            >
              <div style={{ padding: 16 }}>
                {label === 'Chat' ? (
                  <AiMessageRow
                    msg={msg}
                    i={0}
                    sessionMode="execution"
                    markdownComponents={StaticMarkdownComponents}
                    suggestionMessageKey="fixture"
                    isSuggestionSendDisabled
                  />
                ) : (
                  <LauncherAiMessage msg={msg} markdownComponents={StaticMarkdownComponents} />
                )}
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
createRoot(document.getElementById('root')!).render(<Fixture />)
