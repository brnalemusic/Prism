import type { DemoScript } from '../../../../shared/demo'
import { answerChunks, doneAfter } from './utils'

const answer = `I found a safe cleanup plan for your Downloads folder. I would not delete anything immediately; I would group files first, then ask before removing duplicates or installers.

**What I would organize**
- Move PDFs, invoices, and docs into \`Downloads/Documents\`.
- Move images and screenshots into \`Downloads/Images\`.
- Move installers into \`Downloads/Installers\`.
- Move zip files and archives into \`Downloads/Archives\`.
- Keep anything modified in the last 7 days where it is.

**Likely cleanup candidates**
- Old \`.exe\` installers that already have newer copies.
- Duplicate archives with names like \`(1)\` or \`copy\`.
- Temporary browser downloads with \`.crdownload\` or partial names.
- Large videos you may want to move to an external drive instead of deleting.

**Before deleting**
I would create a review list with filename, size, last modified date, and reason. Then I would only delete files you confirm. That keeps the automation useful without making risky assumptions about personal files.

If you approve, the next step would be a dry run that shows exactly what will be moved and what will be left untouched.`

const answerEvents = answerChunks(answer, 5250, 44, 36)

export const downloadsCleanupScript: DemoScript = {
  id: 'downloads-cleanup',
  trigger: 'Clean up my Downloads folder',
  subtitle: 'Safe file grouping with a dry-run mindset.',
  category: 'Automation',
  events: [
    { kind: 'user_message', text: 'Clean up my Downloads folder', at: 0 },
    {
      kind: 'tool_start',
      tool: 'execute_terminal_command',
      toolType: 'task',
      label: 'Scanning Downloads metadata',
      at: 430
    },
    { kind: 'tool_update', text: 'Listing files by type and modified date...', at: 1100 },
    { kind: 'tool_update', text: 'Found 182 files across 9 common categories...', at: 2240 },
    {
      kind: 'tool_update',
      text: 'Marking risky files for review instead of deletion...',
      at: 3340
    },
    { kind: 'tool_end', at: 4050 },
    {
      kind: 'thinking_chunk',
      text: '**Safety check**\nUsing a dry-run plan and avoiding destructive actions without confirmation.\n',
      at: 4380
    },
    ...answerEvents,
    doneAfter(answerEvents)
  ]
}
