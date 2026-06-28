import type { DemoScript } from '../../../../shared/demo'
import { answerChunks, doneAfter } from './utils'

const answer =
  `I found a simple focus setup that keeps your desktop ready for writing and light research.

**Workspace plan**
- Open your notes app and browser side by side.
- Move music and chat apps to a secondary virtual desktop.
- Turn on a 50 minute focus timer with a 10 minute break.
- Keep Downloads and Desktop cleanup out of the focus window so the session does not turn into maintenance work.

**PrismCLI angle**
You could run this as a repeatable command later, for example:

` +
  '```powershell\nprism "set up my writing workspace and start a focus timer"\n```' +
  `

The useful part is not just launching apps. It is remembering the sequence: arrange windows, reduce distractions, start the timer, and keep a short note of what you planned to finish.`

const answerEvents = answerChunks(answer, 5300, 46, 36)

export const focusWorkspaceScript: DemoScript = {
  id: 'focus-workspace',
  trigger: 'Set up my writing workspace',
  subtitle: 'Window setup, timer, and distraction control.',
  category: 'Productivity',
  events: [
    { kind: 'user_message', text: 'Set up my writing workspace', at: 0 },
    {
      kind: 'tool_start',
      tool: 'search_installed_applications',
      toolType: 'task',
      label: 'Finding workspace apps',
      at: 420
    },
    { kind: 'tool_update', text: 'Looking for notes, browser, and calendar apps...', at: 1180 },
    { kind: 'tool_update', text: 'Preparing a non-destructive window layout...', at: 2520 },
    { kind: 'tool_end', at: 3650 },
    {
      kind: 'thinking_chunk',
      text: '**Choosing focus defaults**\nKeeping the setup reversible and easy to repeat.\n',
      at: 4120
    },
    ...answerEvents,
    doneAfter(answerEvents)
  ]
}
