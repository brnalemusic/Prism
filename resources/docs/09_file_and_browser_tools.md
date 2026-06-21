# File and Browser Automation Tools Reference

## 1. Introduction: The Concept of Action-Capable Intelligence

Large Language Models are highly capable of generating plans, but without direct access to execution tools, they remain passive. To transform the model into an active collaborator, Prism equips the AI with a library of system-level action tools. These tools are declared under the `toolsManifest` (`src/main/toolsManifest.ts`) and execute inside the privileged Node.js context of the Main process, subject to sandbox restrictions and human-in-the-loop consent guards.

This document serves as the complete technical API reference manual for Prism's local filesystem tools, persistent Playwright browser automation engines, and system application execution utilities.

---

## 2. Computer Use Filesystem Tools (fs Wrappers)

Filesystem operations are handled via Node's native `fs-extra` or standard `fs` promises. All paths passed to these tools must be absolute (e.g. `C:/Users/Username/Project/index.js`). Slashes must be resolved, and operations are blocked if they target system protected roots.

### 2.1. Tool Reference and Parameter Definitions

#### `computer_use_create_file`
* **Purpose:** Creates a new file at the target path and writes the initial content.
* **Arguments:**
  * `path` (string, required): Absolute target file path.
  * `content` (string, required): Initial text content.
* **Behavior:** Fails with an error if a file already exists at that path, preventing accidental overwrites.

#### `computer_use_save_file`
* **Purpose:** Writes content to a file, creating it if it does not exist, or completely overwriting it if it does.
* **Arguments:**
  * `path` (string, required): Absolute target file path.
  * `content` (string, required): Full file content.
* **Behavior:** Executes a clean write stream. If the parent directories do not exist, they are created recursively.

#### `computer_use_append_file`
* **Purpose:** Appends a block of text to the end of an existing file.
* **Arguments:**
  * `path` (string, required): Absolute target file path.
  * `content` (string, required): Text content to append.
* **Behavior:** Ideal for appending logs, adding import statements at the end of scripts, or appending records.

#### `computer_use_edit_file`
* **Purpose:** Replaces a specific range of lines inside a file with new content.
* **Arguments:**
  * `path` (string, required): Absolute target file path.
  * `startLine` (number, required): 1-based start line index.
  * `endLine` (number, required): 1-based end line index (inclusive).
  * `newContent` (string, required): Replacement text.
* **Behavior:** This is the preferred editing tool. Instead of sending the entire file back and forth, it patches a specific block, reducing context tokens and saving CPU time.

#### `computer_use_remove_file`
* **Purpose:** Deletes a specific file.
* **Arguments:**
  * `path` (string, required): Absolute file path.
* **Behavior:** Subject to protected path registry verification. Fails if targeting system binaries.

#### `computer_use_create_directory`
* **Purpose:** Creates a directory recursively.
* **Arguments:**
  * `path` (string, required): Absolute directory path.

#### `computer_use_remove_directory`
* **Purpose:** Deletes a directory and all of its nested files and folders recursively.
* **Arguments:**
  * `path` (string, required): Absolute directory path.
* **Behavior:** Heavily guarded. Rejects immediately if targeting drive roots or broad home folders.

#### `computer_use_copy_file`
* **Purpose:** Copies a file or directory to a destination path.
* **Arguments:**
  * `sourcePath` (string, required): Absolute source path.
  * `destinationPath` (string, required): Absolute destination path.
  * `overwrite` (string, optional): `"true" | "false"` (default `"false"`).

#### `computer_use_move_file`
* **Purpose:** Moves or renames a file or directory.
* **Arguments:**
  * `sourcePath` (string, required): Absolute source path.
  * `destinationPath` (string, required): Absolute destination path.
  * `overwrite` (string, optional): `"true" | "false"` (default `"false"`).

#### `computer_use_get_file_info`
* **Purpose:** Retrieves size, modification times, permissions, and directory flags for a path.
* **Arguments:**
  * `path` (string, required): Absolute path.

#### `computer_use_list_directory`
* **Purpose:** Lists the children files and folders within a target directory.
* **Arguments:**
  * `path` (string, required): Absolute directory path.

#### `computer_use_read_file`
* **Purpose:** Reads the full text contents of a target file.
* **Arguments:**
  * `path` (string, required): Absolute file path.
* **Behavior:** Reads text encoding formats (UTF-8). Rejects binary formats like executable packages.

### 2.2. Line Calculations and Collision Prevention
When the AI uses `computer_use_edit_file`, it must calculate the exact line numbers to avoid corrupting code.
* **Off-by-One Protection:** Prism uses standard 1-based indexing for line numbers. If the AI targets line 10 to 12, the edit replaces lines 10, 11, and 12.
* **Dynamic Shifts:** If a subagent team edits the same file in parallel, the line numbers can shift. For example, if Agent #0 inserts 5 lines at the top of the file, any edits Agent #1 makes to the bottom of the file must be adjusted by +5 lines. To prevent collisions, subagents are instructed to coordinate their writes, or use `computer_use_save_file` for complete updates if a file undergoes major structural changes.

### 2.3. Walkthrough Example: Editing a File
Suppose we have a file `utils.js` containing:
```javascript
1: // Math utilities
2: function add(a, b) {
3:   return a + b;
4: }
5: // End of utilities
```
The model wants to replace the `add` implementation with a more robust version that checks parameters. It runs:
`<tool_call>{"type": "computer_use_edit_file", "path": "C:/Projects/utils.js", "startLine": 2, "endLine": 4, "newContent": "function add(a, b) {\n  if (typeof a !== 'number' || typeof b !== 'number') throw new Error('Params must be numbers');\n  return a + b;\n}"}</tool_call>`
This modifies the file lines 2 to 4, leaving lines 1 and 5 unchanged, resulting in:
```javascript
1: // Math utilities
2: function add(a, b) {
3:   if (typeof a !== 'number' || typeof b !== 'number') throw new Error('Params must be numbers');
4:   return a + b;
5: }
6: // End of utilities
```

---

## 3. Playwright Browser Automation Tools

Browser automation allows the AI to navigate websites, click buttons, input form data, scrape reference wikis, and check live web application outputs. Prism uses **Playwright** to run these sessions.

### 3.1. Persistent Browser Context Architecture
Prism initializes browser sessions using a persistent launch context:
```typescript
context = await playwright.chromium.launchPersistentContext(userDataDir, {
  headless: false,
  viewport: { width: 1280, height: 800 }
})
```
* **Cookie Retention:** Using a persistent context folder saves cookie caches, session storage logs, and site preferences. If the AI logs into a developer portal or dashboard in Turn 1, the session remains active in Turn 2, allowing the AI to run multi-step authenticated workflows.

### 3.2. Browser API Reference

#### `open_browser`
* **Purpose:** Spawns a Chromium browser session.
* **Arguments:**
  * `url` (string, optional): Target URL to load immediately.

#### `browser_navigate`
* **Purpose:** Directs the active browser tab to a new URL.
* **Arguments:**
  * `url` (string, required): Target website address.

#### `browser_snapshot`
* **Purpose:** Retrieves a structured, semantic representation of the page DOM.
* **Arguments:**
  * `full` (string, optional): `"true" | "false"` (default `"false"`).
* **DOM Tagging Mechanics:**
  1. The browser script searches the active DOM tree for interactive elements (buttons, inputs, anchors, textareas).
  2. It tags each matching node with a temporary custom attribute: `data-prism-id="X"` (where X is a sequential integer).
  3. It strips away styling boilerplate, scripts, dynamic tracking tags, and ads.
  4. It returns a simplified, text-based HTML layout map to the AI (e.g. `<button data-prism-id="12">Submit</button>`), allowing the model to target elements precisely by their ID without inflating the prompt's token size.

#### `browser_click`
* **Purpose:** Triggers a click event on an element.
* **Arguments:**
  * `elementId` (string, required): The target ID from the semantic snapshot (e.g., `"12"`).
* **Behavior:** If the click initiates a file download, Playwright intercepts the download stream and saves the file directly to the user's Downloads folder.

#### `browser_type`
* **Purpose:** Inputs text into a form field or text area.
* **Arguments:**
  * `elementId` (string, required): Target element ID.
  * `text` (string, required): Text payload to input.

#### `browser_press`
* **Purpose:** Dispatches a physical keyboard press event.
* **Arguments:**
  * `key` (string, required): Key name (e.g. `"Enter"`, `"Tab"`, `"Backspace"`).

#### `browser_scroll`
* **Purpose:** Scrolls the active viewport window.
* **Arguments:**
  * `direction` (string, required): `"up" | "down"`.
  * `amount` (string, optional): Distance in pixels.

#### `browser_back`
* **Purpose:** Navigates back one step in browser history.

#### `browser_screenshot`
* **Purpose:** Grabs a screenshot of the active browser view and appends the base64 image payload to the message context.

#### `browser_close`
* **Purpose:** Closes the active page and terminates the Chromium browser process context.

#### `web_script`
* **Purpose:** Executes a custom JavaScript expression inside the browser context and returns the result.
* **Arguments:**
  * `url` (string, optional): URL to load first.
  * `script` (string, required): Raw JavaScript code to evaluate.

#### `detailed_dom_page`
* **Purpose:** Extracts a detailed structural DOM tree showing CSS classes, IDs, placeholders, roles, and text.
* **Arguments:**
  * `url` (string, optional): URL to load first.

### 3.3. Walkthrough Example: Automating a Search and Click
Below is a trace of the tool payloads exchanged when the AI automates a search query on a documentation wiki:
1. **Model calls `open_browser`:**
   `<tool_call>{"type": "open_browser", "url": "https://wiki.example.com"}</tool_call>`
2. **Model requests a page snapshot:**
   `<tool_call>{"type": "browser_snapshot", "full": "false"}</tool_call>`
   * *Returns:*
     `<body><input data-prism-id="1" placeholder="Search..." /><button data-prism-id="2">Go</button></body>`
3. **Model inputs search query:**
   `<tool_call>{"type": "browser_type", "elementId": "1", "text": "installation guide"}</tool_call>`
4. **Model clicks search button:**
   `<tool_call>{"type": "browser_click", "elementId": "2"}</tool_call>`
5. **Model closes browser:**
   `<tool_call>{"type": "browser_close"}</tool_call>`

### 3.4. Automated File Downloads handling
When executing browser click actions, the page may trigger an asynchronous file download (e.g. clicking a "Download ZIP" link). If left unhandled, headless browsers might discard the file or prompt a blocking native save-as dialog box. 
Prism configures Playwright context handlers to listen to download promises:
```typescript
page.on('download', async (download) => {
  const suggestName = download.suggestedFilename();
  const targetPath = path.join(os.homedir(), 'Downloads', suggestName);
  await download.saveAs(targetPath);
});
```
This listener intercepts the download binary stream and writes the file directly to the user's OS downloads folder, returning a success log containing the exact file path back to the AI.

---

## 4. System Utility Tools

These tools handle native operating system queries and app execution outside of the terminal or browser contexts.

### 4.1. `list_installed_applications`
* **Purpose:** Lists installed applications and executables.
* **Behavior:** Faster than running command shell scripts, this tool queries system registries directly and returns app names and paths.

### 4.2. `open_application`
* **Purpose:** Spawns an executable application process.
* **Arguments:**
  * `appPath` (string, required): Absolute target path to the application executable file.
* **Behavior:** Resolves shortcuts and link files recursively before spawning the process.

### 4.3. `open_browser_link`
* **Purpose:** Opens a URL inside the user's default system browser (e.g. Chrome, Firefox, Edge) instead of the sandboxed Playwright browser.
* **Arguments:**
  * `url` (string, required): Target link to open.

---

## 5. IPC Routing Architecture for Tools

When the React renderer process requests a tool execution (for example, when the AI generates a tool call XML block in the streaming response), it goes through the following security bridge:
1. **Renderer Event:** The React view parses the `<tool_call>` tag and calls the secure bridge API:
   `window.api.runTool(toolCallJSON)`
2. **Preload Redirection:** The preload script forwards the JSON payload across the Electron IPC channel:
   `ipcRenderer.invoke('execute-tool-command', payload)`
3. **Main Process Reception:** The Main process receives the event. It runs the payload through the command sandbox or path registers to verify security.
4. **Consent Request:** If the tool modifies state (like writing a file or running a terminal command), the main process sends a message back to the renderer to show a consent popup card.
5. **Tool Execution:** Once the user clicks "Allow", the main process runs the corresponding Node or Playwright function.
6. **Bridge Response:** The tool output is captured, serialized, and returned back across the IPC promise resolution to the React view, which formats the output in the chat history.
