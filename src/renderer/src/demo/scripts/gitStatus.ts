import type { DemoScript } from '../../../../shared/demo'
import { answerChunks, doneAfter } from './utils'

const answer =
  `Your folder has a cleanly understandable Git state: there are edited source files, one new component folder, and no merge conflict markers.

**Current summary**
- Branch: ` +
  '`feature/demo-installer`' +
  `
- Modified: renderer UI, preload typings, and main-process IPC.
- Added: demo playback data and installer overlay components.
- No staged files yet.

**What I would do next**
1. Run the typecheck so we know the IPC typings and renderer imports are sound.
2. Start the demo build in dev mode and click through one scripted conversation.
3. Stage only the demo-related files.
4. Commit with a message like ` +
  '`Add Prism Demo installer showcase`' +
  `.

I can also prepare the exact staging command, but I would wait until the typecheck passes so the commit represents a working point instead of a partial checkpoint.`

const answerEvents = answerChunks(answer, 5000, 45, 36)

export const gitStatusScript: DemoScript = {
  id: 'git-status',
  trigger: 'Gimme the Git status of this folder',
  subtitle: 'A repo-aware summary with next steps.',
  category: 'Coding',
  events: [
    { kind: 'user_message', text: 'Gimme the Git status of this folder', at: 0 },
    {
      kind: 'tool_start',
      tool: 'execute_terminal_command',
      toolType: 'task',
      label: 'Running git status',
      at: 380
    },
    { kind: 'tool_update', text: 'git status --short completed...', at: 1160 },
    { kind: 'tool_update', text: 'Checking staged vs unstaged files...', at: 2300 },
    { kind: 'tool_end', at: 3450 },
    {
      kind: 'thinking_chunk',
      text: '**Interpreting repo state**\nSeparating demo work from unrelated local changes.\n',
      at: 3900
    },
    ...answerEvents,
    doneAfter(answerEvents)
  ]
}
