/**
 * Single source of truth for the Prism Demo build variant.
 *
 * `__DEMO_MODE__` is injected at build time by the vite `define` option
 * (see electron.vite.config.ts). It is `true` only when the app is built with
 * the `DEMO_MODE` env var set (the `dev:demo` / `build:demo` scripts).
 *
 * The Demo variant is a scripted, key-less showcase: it never talks to the
 * Gemini API, so no API key is ever embedded in the build. When a user wants
 * the real thing, the Demo downloads the official Prism installer.
 */
export const IS_DEMO: boolean = __DEMO_MODE__ === true

// ---------------------------------------------------------------------------
// Scripted conversation model
// ---------------------------------------------------------------------------

/**
 * A single moment in a scripted Demo conversation. `at` is the delay (ms)
 * relative to playback start. Events are emitted in chronological order by
 * the playback controller, which feeds them into DemoChatView's state.
 */
export type DemoEvent =
  | { kind: 'user_message'; text: string; at: number }
  | { kind: 'tool_start'; tool: string; toolType: 'task' | 'search' | 'mini-app'; label: string; at: number }
  | { kind: 'tool_update'; text: string; at: number }
  | { kind: 'tool_end'; at: number }
  | { kind: 'thinking_chunk'; text: string; at: number }
  | { kind: 'answer_chunk'; text: string; at: number }
  | { kind: 'done'; at: number }

/** A ready-to-play scripted conversation. */
export interface DemoScript {
  id: string
  /** The trigger phrase shown on the DemoHome card — the user's "message". */
  trigger: string
  /** Short subtitle shown under the trigger on the card. */
  subtitle: string
  /** Category badge for grouping (e.g. "Productivity", "Research"). */
  category: string
  /** Ordered timeline of playback events. Must be sorted by `at`. */
  events: DemoEvent[]
}

/** Flatten all `answer_chunk` text of a script into one string. */
export function fullAnswer(script: DemoScript): string {
  return script.events
    .filter((e): e is Extract<DemoEvent, { kind: 'answer_chunk' }> => e.kind === 'answer_chunk')
    .map((e) => e.text)
    .join('')
}

// ---------------------------------------------------------------------------
// Demo installer IPC model
// ---------------------------------------------------------------------------

export type DemoInstallStage =
  | 'idle'
  | 'resolving-release'
  | 'downloading'
  | 'downloaded'
  | 'launching-installer'
  | 'installer-running'
  | 'installer-finished'
  | 'deps-running'
  | 'deps-finished'
  | 'cli-running'
  | 'cli-finished'
  | 'completed'
  | 'failed'

export interface DemoInstallProgress {
  stage: DemoInstallStage
  message: string
  setupPath?: string
  cliOutput?: string
  error?: string
  updatedAt: number
}

export interface DemoDownloadResult {
  ok: boolean
  setupPath?: string
  filename?: string
  version?: string
  error?: string
}

export interface DemoProcessResult {
  ok: boolean
  exitCode?: number | null
  output?: string
  error?: string
}

export interface DemoOpenResult {
  ok: boolean
  path?: string
  error?: string
}
