export type JsonSchemaType = 'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean'

export interface JsonSchema {
  type: JsonSchemaType
  description?: string
  enum?: Array<string | number | boolean>
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  default?: unknown
  minimum?: number
  maximum?: number
  minItems?: number
  maxItems?: number
  additionalProperties?: boolean
}

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: JsonSchema
}

const stringSchema = (
  description: string,
  options: Pick<JsonSchema, 'enum' | 'default'> = {}
): JsonSchema => ({ type: 'string', description, ...options })

const booleanSchema = (description: string, defaultValue?: boolean): JsonSchema => ({
  type: 'boolean',
  description,
  ...(defaultValue === undefined ? {} : { default: defaultValue })
})

const integerSchema = (
  description: string,
  options: Pick<JsonSchema, 'default' | 'minimum' | 'maximum'> = {}
): JsonSchema => ({ type: 'integer', description, ...options })

const objectSchema = (
  properties: Record<string, JsonSchema>,
  required: string[] = []
): JsonSchema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false
})

const tool = (
  name: string,
  description: string,
  properties: Record<string, JsonSchema> = {},
  required: string[] = []
): ToolDefinition => ({ name, description, inputSchema: objectSchema(properties, required) })

const pathArg = stringSchema('Absolute filesystem path.')
const contentArg = stringSchema('Complete UTF-8 text content. Preserve whitespace exactly.')

// Custom user-facing tool titles shown in Chat mode. Every tool accepts both
// fields; they are display-only and never affect execution. Values must be
// written in the user's conversational language, max 10 words.
const progressTitleArg = stringSchema('Progress label, <=10 words, gerund, specific.')
const completedTitleArg = stringSchema('Done label, <=10 words, past tense, specific.')

function withDisplayTitles(definition: ToolDefinition): ToolDefinition {
  const properties = definition.inputSchema.properties || {}
  if ('progressTitle' in properties || 'completedTitle' in properties) return definition
  return {
    ...definition,
    inputSchema: {
      ...definition.inputSchema,
      properties: {
        ...properties,
        progressTitle: progressTitleArg,
        completedTitle: completedTitleArg
      }
    }
  }
}

export const COMPUTER_READ_FILE_DEFAULT_LIMIT = 500
export const COMPUTER_READ_FILE_MAX_LINES = 800
export const COMPUTER_READ_FILE_MAX_CHARACTERS = 80_000

const baseToolsManifest: ToolDefinition[] = [
  tool(
    'generate_image',
    'Generate or edit a chat image. Supply a complete final prompt. For edits use operation "edit" + exact prism-image://asset/<uuid> ref. Never invent refs or paths.',
    {
      prompt: stringSchema('Final prompt for the image model.'),
      operation: stringSchema('Generate or edit a chat image.', {
        enum: ['generate', 'edit'],
        default: 'generate'
      }),
      source_image_ref: stringSchema(
        'Exact prism-image://asset/<uuid> to edit. Required for edit.'
      ),
      size: stringSchema('Requested output dimensions.', {
        enum: [
          '256x256',
          '512x512',
          '1024x1024',
          '1024x1536',
          '1536x1024',
          '1024x1792',
          '1792x1024'
        ],
        default: '1024x1024'
      }),
      quality: stringSchema('Provider-supported output quality.', {
        enum: ['auto', 'low', 'medium', 'high', 'standard', 'hd']
      }),
      n: integerSchema('Number of images to generate.', { default: 1, minimum: 1, maximum: 4 })
    },
    ['prompt']
  ),
  tool(
    'send_message_to_chat',
    'Send a message or delegate a task to another chat or to Harness. Runs in a new background tab without stealing user focus. When target is "harness", path is mandatory (project folder) and harness_mode can be "plan" or "build". When target is "chat", path is optional (if provided, opens in Discipline mode; if omitted, opens in default Execution mode). Stay in standby after delegating; you will be automatically notified with complete results once the receiving agent truly completes (including after background terminal processes finish).',
    {
      target: stringSchema(
        'Destination agent environment: "chat" for conventional chat, "harness" for Harness coding workspace.',
        {
          enum: ['chat', 'harness'],
          default: 'chat'
        }
      ),
      message: stringSchema('The instruction, prompt, or task to send to the receiving agent.'),
      path: stringSchema(
        'Target directory path. Mandatory when target is "harness". Optional for "chat" (opens in Discipline mode if provided, Execution mode if omitted).'
      ),
      harness_mode: stringSchema('Harness workflow mode. Used only when target is "harness".', {
        enum: ['plan', 'build'],
        default: 'build'
      }),
      target_chat_id: stringSchema(
        'Optional chat ID to send to an existing conversation instead of creating a new one.'
      )
    },
    ['target', 'message']
  ),
  tool(
    'read_chat',
    'Inspect the current status, active terminal state, API errors, and recent history of a chat. Use only when the user explicitly asks for progress or status; otherwise remain in standby to receive the automatic completion notification.',
    {
      chat_id: stringSchema('The ID of the chat to inspect.')
    },
    ['chat_id']
  ),
  tool(
    'approve_harness_plan',
    'Approve an implementation plan generated by a Harness agent in planning mode that was activated by this agent. You can decide how to implement the plan: "same_chat" continues execution in the same Harness chat in Build mode, while "new_chat" generates a handoff context and executes the plan in a new Harness chat with a clean context. Remain in standby after approving; you will be notified upon completion.',
    {
      chat_id: stringSchema(
        'The ID of the Harness chat containing the implementation plan to approve.'
      ),
      mode: stringSchema(
        'How to implement the plan: "same_chat" continues in the same chat in Build mode, "new_chat" creates a new chat with clean context and handoff notes.',
        {
          enum: ['same_chat', 'new_chat'],
          default: 'same_chat'
        }
      ),
      plan: stringSchema(
        'Optional specific implementation plan markdown. If omitted, the latest published plan in the Harness session is automatically selected.'
      ),
      feedback: stringSchema(
        'Optional additional guidance, constraints, or feedback to provide to the Harness agent for implementation.'
      )
    },
    ['chat_id', 'mode']
  ),
  tool(
    'answer_subagent_question',
    'Submit decisions and answers to a clarifying questionnaire raised by a delegated sub-agent. Unblocks the sub-agent so it can continue running.',
    {
      session_id: stringSchema(
        'The questionnaire session ID provided in the question notification.'
      ),
      answers: {
        type: 'object',
        description:
          'Key-value map of question IDs to chosen answers (e.g. { "q1": "choice_value", "q2": ["choice1", "choice2"] }).'
      }
    },
    ['session_id', 'answers']
  ),
  tool(
    'cancel_subagent_task',
    'Abort and cancel an active sub-agent task that was delegated by this agent. Stops model execution, terminates any associated background terminal processes, and cleans up resources.',
    {
      target_chat_id: stringSchema('The chat ID of the sub-agent to cancel.'),
      reason: stringSchema('Optional reason or explanation for the cancellation.')
    },
    ['target_chat_id']
  ),
  tool(
    'discord_leave_voice',
    'Leave the Discord voice channel. Then say a brief goodbye, no more tools.',
    {},
    []
  ),
  tool(
    'execute_terminal_command',
    'Run one shell command. Short cmds return output; long ones return a Run ID and auto-notify on completion. Do not poll.',
    { command: stringSchema('Shell command.') },
    ['command']
  ),
  tool(
    'read_terminal_output',
    'Read output so far for a Run ID. Only for live services/debugging. Never poll in a loop.',
    { runId: stringSchema('Terminal Run ID.') },
    ['runId']
  ),
  tool(
    'send_terminal_input',
    'Send text/keys to stdin of a running command.',
    {
      runId: stringSchema('Terminal Run ID.'),
      input: stringSchema('Optional stdin text. Enter-confirmed by default.'),
      keys: {
        type: 'array',
        description: 'Optional keys to press, e.g. ["Enter"], ["Ctrl+C"].',
        items: stringSchema('Key name or combo.')
      },
      pressEnter: booleanSchema('Confirm input with Enter. Default true.', true)
    },
    ['runId']
  ),
  tool(
    'kill_terminal_process',
    'Kill a running terminal command by Run ID.',
    { runId: stringSchema('Terminal Run ID.') },
    ['runId']
  ),
  tool(
    'computer_use_create_file',
    'Create a new file. Fails if the file already exists.',
    { path: pathArg, content: contentArg },
    ['path', 'content']
  ),
  tool('computer_use_create_directory', 'Create a directory recursively.', { path: pathArg }, [
    'path'
  ]),
  tool('computer_use_remove_file', 'Delete one file.', { path: pathArg }, ['path']),
  tool('computer_use_remove_directory', 'Delete one directory recursively.', { path: pathArg }, [
    'path'
  ]),
  tool(
    'computer_use_save_file',
    'Create or overwrite a file with complete content.',
    { path: pathArg, content: contentArg },
    ['path', 'content']
  ),
  tool(
    'computer_use_append_file',
    'Append text to a file.',
    { path: pathArg, content: contentArg },
    ['path', 'content']
  ),
  tool(
    'computer_use_edit_file',
    'Replace a line range in a file.',
    {
      path: pathArg,
      startLine: integerSchema('First line (1-based).', { minimum: 1 }),
      endLine: integerSchema('Last line, inclusive.', { minimum: 1 }),
      newContent: contentArg
    },
    ['path', 'startLine', 'endLine', 'newContent']
  ),
  tool(
    'computer_use_copy_file',
    'Copy a file or directory.',
    {
      sourcePath: stringSchema('Source path.'),
      destinationPath: stringSchema('Destination path.'),
      overwrite: booleanSchema('Overwrite destination.', false)
    },
    ['sourcePath', 'destinationPath']
  ),
  tool(
    'computer_use_move_file',
    'Move/rename a file or directory.',
    {
      sourcePath: stringSchema('Source path.'),
      destinationPath: stringSchema('Destination path.'),
      overwrite: booleanSchema('Overwrite destination.', false)
    },
    ['sourcePath', 'destinationPath']
  ),
  tool('computer_use_get_file_info', 'Read file/directory metadata.', { path: pathArg }, ['path']),
  tool('computer_use_list_directory', 'List a directory.', { path: pathArg }, ['path']),
  tool(
    'computer_use_read_file',
    'Read a line range from text, PDF, PPTX, or DOCX.',
    {
      path: pathArg,
      startLine: integerSchema('First line (1-based).', { default: 1, minimum: 1 }),
      limit: integerSchema(`Max lines (up to ${COMPUTER_READ_FILE_MAX_LINES}).`, {
        default: COMPUTER_READ_FILE_DEFAULT_LIMIT,
        minimum: 1,
        maximum: COMPUTER_READ_FILE_MAX_LINES
      })
    },
    ['path']
  ),
  tool(
    'search_installed_applications',
    'Search installed apps by name.',
    { query: stringSchema('Search term.') },
    ['query']
  ),
  tool(
    'open_application',
    'Open an app/file in the default app.',
    { appPath: stringSchema('File or exe path.') },
    ['appPath']
  ),
  tool(
    'web_search',
    'Quick web search; auto-reads matching pages. Use 2-4 sources typically, max 10.',
    {
      query: stringSchema('Search query.'),
      resultCount: integerSchema('Sources to return (1-10, 2-4 typical).', {
        minimum: 1,
        maximum: 10
      })
    },
    ['query', 'resultCount']
  ),
  tool(
    'web_fetch',
    'Deep research: 5 queries x 10 pages, subagent synthesis. Use for deep/comprehensive requests.',
    {
      title: stringSchema("Research title in the user language."),
      queries: {
        type: 'array',
        description: 'Exactly 5 distinct Google-style queries on different facets.',
        minItems: 5,
        maxItems: 5,
        items: stringSchema('Search query.')
      }
    },
    ['title', 'queries']
  ),
  tool(
    'read_page',
    'Read and extract the full content of a web page URL directly. MANDATORY tool whenever a web URL is provided or whenever the user asks to visit, enter, check, view, inspect, or summarize a website (e.g. "entra nesse site", "acesse o link", "visite a página", "check this link", "dá uma olhada no site", "veja a página"). Extracts clean DOM text directly without launching any browser. NEVER use browser tools or call read_skill for web URLs.',
    {
      url: stringSchema('HTTP(S) URL of the web page to read.'),
      maxCharacters: integerSchema('Maximum characters to return (default 50,000, max 100,000).', {
        default: 50_000,
        minimum: 1_000,
        maximum: 100_000
      })
    },
    ['url']
  ),
  tool(
    'open_browser_link',
    'Launch a URL in the user\'s default external OS browser window so the user can view it. NEVER use this tool when you need to read, inspect, summarize, or analyze page content yourself (use read_page instead). Only call this when the user explicitly asks you to open a link in their browser for them.',
    { url: stringSchema('HTTP(S) URL.') },
    ['url']
  ),
  tool(
    'open_browser',
    'Open or attach the persistent Prism in-app browser session for interactive UI automation. NEVER use this simply to read or inspect the text of a URL (use read_page instead).',
    {
      url: stringSchema('Optional initial URL.')
    }
  ),
  tool('browser_navigate', 'Navigate the active browser.', { url: stringSchema('HTTP(S) URL.') }, [
    'url'
  ]),
  tool('browser_snapshot', 'Read a semantic snapshot of the page.', {
    full: booleanSchema('Full snapshot.', false)
  }),
  tool(
    'browser_click',
    'Click a snapshot element.',
    { elementId: stringSchema('Element ID from snapshot.') },
    ['elementId']
  ),
  tool(
    'browser_type',
    'Type text into a snapshot element.',
    {
      elementId: stringSchema('Element ID from snapshot.'),
      text: stringSchema('Text to type.')
    },
    ['elementId', 'text']
  ),
  tool(
    'browser_press',
    'Press a key in the browser.',
    { key: stringSchema('Key name, e.g. Enter.') },
    ['key']
  ),
  tool(
    'browser_scroll',
    'Scroll the page.',
    {
      direction: stringSchema('Direction.', { enum: ['up', 'down'] }),
      amount: integerSchema('Pixels to scroll.', { minimum: 1 })
    },
    ['direction']
  ),
  tool('browser_back', 'Go back in browser history.'),
  tool(
    'web_script',
    'Run JavaScript in the page.',
    {
      script: stringSchema('JS source.'),
      url: stringSchema('Optional expected URL.')
    },
    ['script']
  ),
  tool(
    'detailed_dom_page',
    'Read the detailed page DOM of the active in-app browser page. Requires an active open_browser session; never use to simply read a URL (use read_page instead).',
    {
      url: stringSchema('Optional expected URL.')
    }
  ),
  tool('search_chat_history', 'Search saved chats by keywords.', { query: stringSchema('Keywords.') }, [
    'query'
  ]),
  tool(
    'open_main_app',
    'Open main Prism window with instructions.',
    {
      instructions: stringSchema('Instructions for main chat.'),
      model: stringSchema('Optional model key.'),
      searchEnabled: booleanSchema('Enable search mode.', false)
    },
    ['instructions']
  ),
  tool('computer_use_see_screen', 'Screenshot the full screen.', {
    appName: stringSchema('Ignored; full screen always.', { default: 'Entire Screen' })
  }),
  tool('configure_prism', 'Change non-secret settings. One property required.', {
    launcherShortcut: stringSchema('Launcher hotkey.'),
    modelSelectionShortcut: stringSchema('Model picker hotkey.'),
    screenshotShortcut: stringSchema('Screenshot hotkey.'),
    newChatShortcut: stringSchema('New chat hotkey.'),
    dictationShortcut: stringSchema('Dictation hotkey.'),
    webSearchShortcut: stringSchema('Search hotkey.'),
    youtubeModeShortcut: stringSchema('YouTube hotkey.'),
    lastSelectedChatModel: stringSchema('Chat model key.'),
    defaultModel: stringSchema('Chat model alias.'),
    searchModel: stringSchema('Search model key.'),
    quickLauncherModel: stringSchema('Launcher model key.'),
    sttModel: stringSchema('STT model key.'),
    generativeBrowserModel: stringSchema('Generative browser model key.'),
    imageGenerationModel: stringSchema('Image model route key.'),
    minimizeToTray: booleanSchema('Minimize to tray on close.'),
    autoLaunch: booleanSchema('Start with OS.'),
    quickLauncherMode: stringSchema('Launcher mode.', { enum: ['simple', 'advanced'] }),
    theme: stringSchema('Color theme.', {
      enum: [
        'marine',
        'vertez',
        'akoustik',
        'terno',
        'ursula',
        'rgb',
        'fire',
        'lava',
        'gold',
        'forest',
        'indigo',
        'violet',
        'white'
      ]
    }),
    username: stringSchema('Display name.'),
    ttsVoice: stringSchema('TTS voice.', {
      enum: ['Aoede', 'Puck', 'Charon', 'Kore', 'Fenrir']
    }),
    terminalShell: stringSchema('Shell exe or path.'),
    zoomFactor: {
      type: 'number',
      description: 'App zoom.',
      minimum: 0.5,
      maximum: 3
    }
  }),
  tool('internal_docs_list', 'List Prism docs.'),
  tool(
    'internal_docs_read',
    'Read one Prism doc file.',
    { filename: stringSchema('Filename from internal_docs_list.') },
    ['filename']
  ),
  tool('internal_docs_search', 'Search Prism docs.', { query: stringSchema('Query.') }, ['query']),
  tool(
    'to_ask',
    'Ask questions and wait for the answer.',
    {
      session_id: stringSchema('Questionnaire ID.'),
      questions: {
        type: 'array',
        minItems: 1,
        description: 'Questions rendered by Prism.',
        items: objectSchema(
          {
            id: stringSchema('Question ID.'),
            type: stringSchema('Type.', {
              enum: ['multiple-choice', 'multiple-select', 'essay']
            }),
            title: stringSchema('Category.'),
            prompt: stringSchema('Question text.'),
            options: {
              type: 'array',
              description: 'Choices.',
              minItems: 2,
              maxItems: 10,
              items: objectSchema(
                {
                  value: stringSchema('Choice value.'),
                  label: stringSchema('Choice title.'),
                  description: stringSchema('Choice help.'),
                  recommended: booleanSchema('True for the recommended option.')
                },
                ['value', 'label']
              )
            },
            max_selections: integerSchema('Max selections; omit for unlimited.', {
              minimum: 1,
              maximum: 10
            })
          },
          ['id', 'type', 'title', 'prompt']
        )
      }
    },
    ['session_id', 'questions']
  ),
  tool('render_chat_history', 'Render a saved chat in the UI.', { query: stringSchema('Chat ID or file.') }, [
    'query'
  ]),
  tool('search_chat_memory', 'Search conversation memory.', { query: stringSchema('Keywords.') }, [
    'query'
  ]),
  tool('not_found_chat_history', 'Report no matching chat history.'),
  tool('list_workflows', 'List slash workflows.'),
  tool(
    'save_workflow',
    'Create/update a slash workflow.',
    {
      command: stringSchema('Slash command, e.g. "/review".'),
      name: stringSchema('Workflow name.'),
      systemInstruction: stringSchema('Workflow instruction.'),
      description: stringSchema('Optional description.'),
      id: stringSchema('Existing ID when updating.'),
      toolConstraints: {
        type: 'array',
        description: 'Allowed tool names.',
        items: stringSchema('Tool name.')
      }
    },
    ['command', 'name', 'systemInstruction']
  ),
  tool('delete_workflow', 'Delete a workflow by command or ID.', {
    command: stringSchema('Slash command.'),
    id: stringSchema('Workflow ID.')
  }),
  tool(
    'create_todo',
    'Create a task list.',
    {
      tasks: {
        type: 'array',
        description: 'Task titles.',
        minItems: 1,
        maxItems: 30,
        items: stringSchema('Task title.')
      }
    },
    ['tasks']
  ),
  tool(
    'edit_todo',
    'Update one task status.',
    {
      id: stringSchema('Task ID, e.g. task-0.'),
      status: stringSchema('New status.', { enum: ['working', 'done'] })
    },
    ['id', 'status']
  ),
  tool(
    'create_mini_app',
    'Create an interactive Mini App.',
    {
      title: stringSchema('App title.'),
      html: stringSchema('HTML, no script/style tags.'),
      css: stringSchema('Responsive CSS.'),
      js: stringSchema('Interaction JS.')
    },
    ['title', 'html', 'css', 'js']
  ),
  tool(
    'read_skill',
    'Read a skill file to learn rules and unlock its tools (e.g. "pdf_skill.md", "pptx_skill.md"). NEVER call this tool with "integrated_browser_skill.md" just because a URL is present or because the user asks to visit, enter, check, or interact with a website (use "read_page" instead). The integrated browser skill is ONLY for explicit user requests to open the in-app browser.',
    {
      skill_name: stringSchema('Skill filename, e.g. "pdf_skill.md".')
    },
    ['skill_name']
  ),
  tool(
    'write_pdf',
    'Generate a PDF from HTML/CSS.',
    { filename: stringSchema('PDF filename.'), html: stringSchema('Full A4 HTML/CSS.') },
    ['filename', 'html']
  ),
  tool(
    'edit_pdf',
    'Update a PDF artifact.',
    {
      id: stringSchema('Artifact ID.'),
      path: stringSchema('PDF path if no ID.'),
      html: stringSchema('Updated full HTML/CSS.')
    },
    ['html']
  ),
  tool(
    'write_pptx',
    'Generate 16:9 slides from HTML/CSS.',
    {
      filename: stringSchema('Filename.'),
      html: stringSchema('Full 1920x1080 HTML/CSS.')
    },
    ['filename', 'html']
  ),
  tool(
    'edit_pptx',
    'Update a PowerPoint artifact.',
    {
      id: stringSchema('Artifact ID.'),
      path: stringSchema('Path if no ID.'),
      html: stringSchema('Updated full HTML/CSS.')
    },
    ['html']
  ),
  tool(
    'memory',
    'Curate long-term memory. add: save fact. replace: fix fact (old_text = unique substring, content = new fact). remove: delete stale fact. target "user" = user profile; "memory" = general notes. Save stable facts proactively, same turn. Compact, no secrets. Current message wins.',
    {
      action: stringSchema('Operation.', {
        enum: ['add', 'replace', 'remove']
      }),
      target: stringSchema('Store.', { enum: ['user', 'memory'] }),
      kind: stringSchema('Entry class.', {
        enum: ['about_user', 'preference', 'fact', 'event', 'project', 'behavioral']
      }),
      content: stringSchema("Fact to save (add/replace), compact, user language."),
      old_text: stringSchema('Unique substring of entry (replace/remove).')
    },
    ['action', 'target']
  )
]

export const toolsManifest: ToolDefinition[] = baseToolsManifest.map(withDisplayTitles)

export const toolNames = new Set(toolsManifest.map((definition) => definition.name))

export function getToolDefinition(name: string): ToolDefinition | undefined {
  return toolsManifest.find((definition) => definition.name === name)
}
