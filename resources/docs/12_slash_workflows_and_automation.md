# Slash Workflows and Automation Macros

## 1. Introduction: The Need for Custom AI Modes

Artificial intelligence is highly flexible, but developers often perform repetitive tasks that require specific behavior profiles. For example, a developer might want the AI to *only* review code changes without writing any code, or run a search continuously without attempting local edits, or write documentation in a specific tone. Under normal chat operations, the developer has to write long, repetitive setup prompts (e.g., "Act as a code reviewer. Do not write code, only comment on style...") at the start of every session.

To solve this friction, Prism introduces **Slash Workflows**. Workflows are customizable macros that allow users to map a shortcut command (starting with a `/`) to a specific system configuration. When triggered, a workflow dynamically injects pre-configured system instructions and locks down the tool execution engine to a restricted set of allowed tools. This document serves as the complete technical manual for creating, managing, and executing Slash Workflows in Prism.

---

## 2. Autocomplete and Textarea Menu Interceptors

The entry point for slash workflows is the input textarea in the renderer process (`src/renderer/src/components/InputBar.tsx`).

### 2.1. Triggering the Slash Menu
When the user types a forward slash `/` at the beginning of an input line, the React input handler catches the event:
* **The Regex Check:** The renderer checks if the textarea text starts with `/` and contains no spaces.
* **Menu Rendering:** A floating autocomplete popover menu (`SlashMenu`) is displayed directly above the input bar.
* **Fuzzy Matching:** As the user continues typing (e.g. `/ref`), the list is dynamically filtered against the cached list of configured workflows:
  ```typescript
  const filteredWorkflows = workflows.filter((w) =>
    w.command.toLowerCase().startsWith(text.toLowerCase())
  )
  ```

### 2.2. Keyboard Interception
When the menu is open, the input textarea temporarily overrides standard key bindings to allow rapid menu navigation:
* **`ArrowDown` / `ArrowUp`:** Navigates between options.
* **`Enter`:** Selects the highlighted workflow. It replaces the typed slash character with the full workflow configuration (or updates the input bar's active workflow badge) and closes the menu.
* **`Escape`:** Dismisses the menu, returning the input bar to standard text typing.

### 2.3. Autocomplete UI Render Architecture
The popup menu is rendered as a absolute-positioned floating layer at the bottom of the chat view (using standard glassmorphism styled selectors). It iterates over the `filteredWorkflows` array:
```tsx
{showSlashMenu && (
  <div className="absolute bottom-full left-0 mb-2 w-72 bg-surface border border-text-muted rounded-xl shadow-2xl backdrop-blur-md overflow-hidden z-50">
    <div className="text-xs font-semibold px-3 py-2 bg-background-secondary text-text-secondary border-b border-text-muted">
      AI Workflows
    </div>
    <ul className="max-h-60 overflow-y-auto">
      {filteredWorkflows.map((workflow, idx) => (
        <li
          key={workflow.id}
          className={clsx(
            "px-3 py-2 cursor-pointer transition-colors text-sm",
            idx === slashSelectedIndex ? "bg-accent-primary text-background-main font-semibold" : "text-text-primary hover:bg-background-secondary"
          )}
          onClick={() => handleSelectWorkflow(workflow)}
        >
          <div className="font-mono text-xs">{workflow.command}</div>
          <div className="text-xs opacity-80 mt-0.5">{workflow.description}</div>
        </li>
      ))}
    </ul>
  </div>
)}
```
This rendering block uses standard hardware-accelerated animations for entry slides, maintaining a responsive visual interface.

---

## 3. Configuration and Serialization Schema

Workflows are defined as structured TypeScript interfaces in `src/main/config.ts` and saved inside `prismconfigs.cfg` on disk.

### 3.1. The `SlashWorkflow` Interface
```typescript
export interface SlashWorkflow {
  id: string                   // Unique UUID
  command: string              // Trigger token (e.g., "/refactor")
  name: string                 // Display label in Settings and UI
  description: string          // Short summary of what the macro does
  systemInstruction: string    // Custom prompt injected to system instructions
  toolConstraints?: string[]   // Array of explicitly allowed tool name strings
}
```

### 3.2. Configuration Defaults
Prism ships with a set of default built-in workflows:
* **Subagents Swarm (`/subagents`):**
  * **System Instruction:** `"You are running in Subagent Mode. Your goal is to delegate and orchestrate the user's request using worker subagents..."`
  * **Tool Constraints:** `['run_subagents']` (Blocks the main model from editing files directly, forcing it to delegate all work to background workers).
* **Code Reviewer (`/review`):**
  * **System Instruction:** `"You are a senior software quality engineer. Perform a line-by-line review of the provided code. Check for logic errors, formatting consistency, and security vulnerabilities. Do not write replacement code files unless asked."`
  * **Tool Constraints:** `['computer_use_read_file']` (Locks the AI to read-only mode).

---

## 4. Main Process System Prompt Injection

When a chat message begins with an active workflow command, the prompt compilation engine in the main process (`src/main/gemini.ts`) alters how the LLM session is initialized.

```
       [User sends prompt starting with "/refactor"]
                             |
                             v
         [gemini.ts checks text prefix match]
                             |
                             v
           [Loads "/refactor" Workflow Config]
                             |
         +-------------------+-------------------+
         |                                       |
  [System Instruction]                   [Tool Constraints]
         |                                       |
         v                                       v
Appends instruction block to            Locks allowed API keys to
base prompt:                            ['read_file', 'edit_file']
"# Active Workflow: Refactor\n..."               |
         |                                       |
         +-------------------+-------------------+
                             |
                             v
               Dispatched to Gemini API
```

### 4.1. The Injection Pipeline
1. The message dispatcher parses the user's text input.
2. It loops through the `config.workflows` array to check if the prefix matches a registered command:
   ```typescript
   const matchedWorkflow = config.workflows?.find((w) =>
     message.toLowerCase().startsWith(w.command.toLowerCase())
   )
   ```
3. If a match is found, the system prompt generator dynamically appends the workflow's system instruction to the default system tools prompt:
   ```typescript
   let fullPrompt = baseSystemPrompt;
   if (matchedWorkflow) {
     fullPrompt += `\n\n# Active Workflow: ${matchedWorkflow.name}\n${matchedWorkflow.systemInstruction}`;
   }
   ```
4. This combined instruction is passed to the Gemini API as the primary system context, forcing the model to adopt the requested guidelines.

---

## 5. Runtime Tool Constraints and Sandbox Enforcement

A key security feature of Prism's workflows is **Tool Constraints**. If a workflow restricts the allowed tools (using `toolConstraints`), the main process enforces these constraints at the API gateway level.

### 5.1. The Model Bypass Risk
Even if the system prompt instructs the model: "Do not write files, only read files", advanced models might occasionally ignore these instructions if the user prompt is written persuasively. Prompt injection attempts could easily override text instructions.

### 5.2. Hard Enforcement at the Gateway
To prevent this bypass, Prism uses hardcoded validation in the tool execution router (`src/main/gemini.ts`):
1. When the model requests a tool call (e.g. trying to call `computer_use_save_file`), the main process intercepts the JSON payload.
2. It checks if the active workflow contains a `toolConstraints` array.
3. If the array is defined, the process validates the requested tool name:
   ```typescript
   if (matchedWorkflow.toolConstraints && matchedWorkflow.toolConstraints.length > 0) {
     const actualName = toolCall.name;
     if (!matchedWorkflow.toolConstraints.includes(actualName)) {
       // Block execution
       validation.errorMessage = `Error: The tool "${actualName}" is not allowed under the active workflow constraints. Allowed tools for this workflow are: ${matchedWorkflow.toolConstraints.join(', ')}.`;
     }
   }
   ```
4. If a match is not found, the tool execution is blocked, and the validation error is returned directly to the model as the tool response payload, explaining that the action is prohibited. This forces the model to stay within its configured tool boundaries.

---

## 6. How to Add a Programmatic Built-In Workflow

Developers can add a new default workflow directly in the codebase:
1. Open [config.ts](../../src/main/config.ts).
2. Locate the `DEFAULT_CONFIG` object definition.
3. Append a new object entry to the `workflows` array:
   ```typescript
   {
     id: 'default-docs-writer',
     command: '/docs',
     name: 'Documentation Assistant',
     description: 'Write comprehensive technical documentation.',
     systemInstruction: 'You are a technical writer. Write descriptive markdown documents with details, examples, and file structures. Focus on readability.',
     toolConstraints: ['computer_use_read_file', 'computer_use_save_file']
   }
   ```
4. Save the file. When Prism compiles, any user who resets their configuration to default settings will instantly see the `/docs` workflow available in their autocomplete trigger registry.

---

## 7. IPC Config Serialization and safeStorage

When settings are saved, custom workflows must be written securely.
* **JSON Serialization:** The custom workflows list is converted to a JSON string payload.
* **Configuration Storage:** The main config wrapper (`src/main/config.ts`) writes the config properties to `prismconfigs.cfg`.
* **safeStorage encryption:** If the workflows contain sensitive API variables or custom headers, the main config engine automatically uses Electron's `safeStorage` to encrypt these fields before writing them to the system disk.
* **IPC Config Broadcast:** Once written, the main process broadcasts a `config-changed` event to both the `mainWindow` and `launcherWindow` to update their active autocomplete lists in real time.

---

## 8. Multi-Agent Workflows and Chaining

When you trigger a workflow that spawns subagents (like the default `/subagents` swarm macro), the subagents inherit the workflow's tool constraints.
* **Propagation:** If the parent workflow limits allowed tools to `['run_subagents', 'computer_use_read_file']`, the main model can spawn subagents. However, the spawned subagents will also be locked to read-only tools.
* **Enforcement:** If a worker subagent attempts to call `computer_use_save_file`, the main validation scanner detects that the parent workflow context has blocked writes, rejecting the subagent's tool call at the API gate, ensuring absolute safety for the parent project.

---

## 9. Creating Custom Workflows: A User Guide

Users can create, edit, or delete custom workflows inside the **System Settings** dashboard.

### 9.1. Step-by-Step Creation
1. Open Prism (either the main workspace or the launcher) and click the **Settings** gear icon.
2. Navigate to the **Slash Workflows** tab.
3. Click the **Create Workflow** button.
4. Input the configuration details:
   * **Command:** Define the trigger key (must start with a slash and contain no spaces, e.g. `/document`).
   * **Name:** Provide a friendly display name (e.g., "Doc Writer").
   * **Description:** Write a brief description of its purpose.
   * **System Instruction:** Write the guidelines the AI must follow. Be specific about constraints, formatting preferences, and tone.
5. **Tool Permissions Checklist:** Use the checkboxes to select which tools are allowed for this workflow. Leaving the list empty grants access to all system tools.
6. Click **Save Configuration**. The new workflow is serialized into `prismconfigs.cfg` and is instantly available in the input bar's autocomplete list.

---

## 10. Troubleshooting Workflows and Autocomplete Issues

### 10.1. Autocomplete Menu Not Appearing
If typing a forward slash `/` fails to open the popover menu:
* **The Cause:** The slash was typed in the middle of a sentence or preceded by a character. The regex trigger checks for `text.startsWith('/')` and requires that the slash be the first character on a line.
* **The Resolution:** Clear the line, press `/` as the first character, and the menu will appear.

### 10.2. Tool Execution Block Error
If you run a custom workflow and see the message: `Error: The tool "X" is not allowed under the active workflow constraints`:
* **The Cause:** The workflow is running under strict tool boundaries that exclude tool `X`.
* **The Resolution:** Go back to System Settings, edit the target workflow, check the box next to tool `X` in the permissions checklist, and save the settings.
