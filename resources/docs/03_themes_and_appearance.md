# Themes and Appearance Guide

## 1. Introduction: The Prism Visual Ecosystem

Aesthetic pleasure is not secondary to functionality; it is an active component of user experience. When a developer works inside a beautiful, structured interface, their focus improves, cognitive load is reduced, and interaction feels more natural. Prism features a highly polished design system built on top of **Tailwind CSS v4** and compiled using **LightningCSS**.

The interface leverages glassmorphic textures, animated radial glows, customized typography, and micro-transitions to create a premium, state-of-the-art desktop workspace. This document details the styling variable tokens, the six integrated application themes (including the locked RGB Easter Egg), font configurations, and the dynamic output protocols used by the AI to build custom UI components on the fly.

---

## 2. Dynamic Design Tokens and CSS Variables

Prism's design system is fully tokenized using CSS custom properties (variables) declared in [main.css](../../src/renderer/src/assets/main.css). When the user changes their theme in the Settings panel, the application updates the `data-theme` attribute on the root HTML element:

```typescript
document.documentElement.setAttribute('data-theme', config.theme)
```

The CSS styles respond dynamically by shifting the values of the core tokens mapped under the Tailwind `@theme` directive. The key design tokens used across the application are:

| CSS Variable | Tailwind Mapped Class | Purpose |
| :--- | :--- | :--- |
| `--background-main` | `bg-background-main` | Primary application window background. |
| `--background-secondary` | `bg-background-secondary` | Sidebar, input panels, and menu drawer backgrounds. |
| `--surface` | `bg-surface` | Cards, buttons, inputs, and popups. |
| `--accent-primary` | `text-accent-primary`, `bg-accent-primary` | Focus outlines, active states, key icons, primary highlights. |
| `--accent-secondary` | `text-accent-secondary` | Auxiliary highlights, gradients, second-level state indicators. |
| `--accent-glow` | *Used inline or via custom utilities* | Transparent color shadow for glassmorphic focus highlights. |
| `--text-primary` | `text-text-primary` | Standard readable text. High contrast but slightly softened. |
| `--text-secondary` | `text-text-secondary` | Labels, details, descriptions, and descriptive text. |
| `--text-muted` | `text-text-muted` | Placeholders, disabled states, borders, and timestamps. |
| `--status-success` | `text-status-success` | Successful action results, completed subagent states. |
| `--status-warning` | `text-status-warning` | Pending approvals, command confirmation warnings. |
| `--status-error` | `text-status-error` | Sandboxed command rejections, connection failures, compilation errors. |
| `--home-glow-color-1` | *Used in radial-gradients* | Core glow layer 1 for active computing states. |
| `--home-glow-color-2` | *Used in radial-gradients* | Core glow layer 2 for ambient breathing effects. |
| `--theme-font-sans` | `font-sans` | Primary sans-serif font family. |

---

## 3. Deep Dive into the Six Application Themes

Prism ships with six pre-configured themes, each tailored to a specific mood, environment, or programming task.

### 3.1. Marine (The Default Theme)
* **Theme Code:** `marine`
* **Primary Accent:** `#8fb4ff` (Ice Blue) | **Secondary Accent:** `#78e0c2` (Sea Foam Mint)
* **Background Main:** `#13151a` | **Surface:** `#252832`
* **Typography Font:** `Outfit` (loaded via `@fontsource/outfit`)
* **Design Philosophy:** Marine is designed as a calm, balanced workspace. The slate-blue tones reduce eye fatigue during long coding sessions, while the ice-blue primary accent gives a high-tech, digital-first impression. The warm-white text (`#f4f1ea`) avoids the starkness of pure white, making reading soft and comfortable.

### 3.2. Vertez (Earthy & Hand-crafted)
* **Theme Code:** `vertez`
* **Primary Accent:** `#ff4e3a` (Burnt Orange) | **Secondary Accent:** `#ff9f1c` (Warm Gold)
* **Background Main:** `#161413` (Clay Black) | **Surface:** `#2b2623` (Charcoal Slate)
* **Typography Font:** `Shadows Into Light` (Cursive/Handwritten style)
* **Design Philosophy:** Vertez breaks away from traditional tech designs. It is inspired by organic elements like clay, sand, and warm wood fire. The cursive heading font gives the application a highly personalized, notebook-like feel. It is ideal for creative brainstorming, planning stages, and users who want their digital environment to feel warm and human.

### 3.3. Akoustik (High-Energy Cyberpunk)
* **Theme Code:** `akoustik`
* **Primary Accent:** `#b07aff` (Neon Purple) | **Secondary Accent:** `#e88cff` (Electric Pink)
* **Background Main:** `#12101a` (Midnight Violet) | **Surface:** `#262233` (Amethyst Slate)
* **Typography Font:** `Righteous` (Retro-futuristic style)
* **Design Philosophy:** Akoustik is a loud, high-contrast, neon-drenched theme. It draws heavy inspiration from retro-synthesizer interfaces, electronic music workstations, and cyberpunk environments. The bold, styled typeface and purple-pink accents inject energy into the workspace, making it a favorite for late-night programming sprints.

### 3.4. Terno (Raw Minimalist Black & White)
* **Theme Code:** `terno`
* **Primary Accent:** `#ffffff` (Pure White) | **Secondary Accent:** `#d0d0d0` (Light Silver)
* **Background Main:** `#000000` (Absolute Obsidian) | **Surface:** `#111111` (Deep Grey)
* **Typography Font:** `Playfair Display` (Elegant serif)
* **Design Philosophy:** Terno is designed for distraction-free reading and raw literary focus. By setting the background to absolute black (`#000000`), it maximizes screen contrast while minimizing pixel brightness (saving battery on OLED displays). The inclusion of a serif font makes long transcripts read like a printed novel or newspaper, making it perfect for studying complex technical concepts or reviewing historical records.

### 3.5. Ursula (Nature-Infused Green)
* **Theme Code:** `ursula`
* **Primary Accent:** `#388e3c` (Forest Green) | **Secondary Accent:** `#c8e6c9` (Mint Green)
* **Background Main:** `#0a110a` (Deep Moss) | **Surface:** `#182418` (Foliage Charcoal)
* **Typography Font:** `Playfair Display` (Elegant serif)
* **Design Philosophy:** Ursula is a reading-focused theme that mimics paper and forest colors. Studies show that deep green hues lower heart rates and decrease visual stress. The deep green tones, combined with mint accents and readable serif text, provide a soothing visual environment that makes analyzing long logs or debugging codebase structures feel relaxing.

### 3.6. RGB (The Hidden Easter Egg Theme)
* **Theme Code:** `rgb`
* **Primary Accent:** `#007bff` (Dynamic Blue) | **Secondary Accent:** `#ff0000` (Dynamic Red)
* **Background Main:** `#0c0d12` | **Surface:** `#1b1e2a`
* **Typography Font:** `Exo 2` (Sci-Fi geometric sans-serif)
* **Unlocking Mechanism:** The RGB theme is a locked secret. If a user asks for it, the AI is instructed to remain enigmatic and offer a 4-question quiz. To unlock the theme, the user must answer all 4 questions *incorrectly*. Any correct answer instantly fails and resets the quiz.
* **Aesthetic Features:** Once unlocked, the RGB theme activates a custom keyframe animation in the application layout:
  ```css
  .rgb-border-glow {
    animation: rgb-shift 10s infinite linear;
  }
  ```
  The window borders, active glowing backgrounds, and selection frames cycle continuously through a spectrum of red, green, blue, purple, and gold, transforming the workspace into a gamer-style RGB layout. The theme remains active for a configured time limit before expiring.

---

## 4. UI Layout, Panels, and Scaling

Prism's main interface features a three-panel workspace designed to support fluid multitasking.

```
+--------------------------------------------------------------------------------+
|  [Logo] Chat list   |  Main Chat Frame (Simple/Rich Markdown)  | Subagent Info |
|                     |                                          |               |
|  - Active Chats     |  - Streamed AI Messages                  | - Swarm Logs  |
|  - Saved Transcripts|  - File Diffs & Terminal Outputs         | - Active Tasks|
|  - Settings Button  |  - Execution Authorization Prompts        | - Group Chat  |
|                     |                                          |               |
|                     |  [========== Text Input Area ==========] |               |
+--------------------------------------------------------------------------------+
```

### 4.1. Panel Architecture
* **Sidebar (Left Panel):** Houses the conversation history, active chat switches, config settings access, and theme customization selectors.
* **Workspace (Center Panel):** The focal point of the application. It renders the primary message thread, syntax-highlighted codeblocks, math formulas (via KaTeX), and tool execution card prompts.
* **Agent swarms (Right Panel):** Toggles into view when a workflow triggers subagents. It displays active subagent tabs, parallel task list states, and the group chat log, letting the user watch background automation in real-time.

### 4.2. Interface Scaling
In the Settings screen, users can adjust the global interface scaling factor. This modifies the base font size on the root element:
```css
html {
  font-size: var(--config-scale-factor, 14px);
}
```
Because the entire application stylesheet utilizes relative `rem` units for paddings, heights, margins, and border radii, scaling the root font size scales the entire interface uniformly. This ensures that users with high-resolution 4K monitors or users who prefer compact, high-density layouts can adjust Prism to match their visual preferences perfectly.

---

## 5. Visual Protocols for AI Outputs

Prism does not restrict the AI's responses to standard markdown text. Depending on the task context, the AI chooses between three distinct visual rendering tiers to maximize UI efficiency.

### 5.1. Simple Markdown (95% of Responses)
* **Description:** Standard, clean markdown styling. It features clean headers, lists, links, bold highlights, and syntax-highlighted codeblocks.
* **Constraint:** The AI is instructed to never inject HTML wrappers or inline style cards for normal conversational replies. This keeps the interface clean, lightweight, and fast to parse.

### 5.2. Rich Markdown (HTML/CSS Dashboards)
* **Description:** When the user explicitly requests cards, dashboards, profiles, grids, or data layouts (e.g. "create a visual dashboard for my server status"), the AI shifts to Rich Markdown.
* **Implementation:** The AI outputs raw HTML codeblocks with inline styles that leverage Prism’s theme variables. By using CSS variables instead of hardcoded hex values, the visual cards automatically adapt to the user's selected theme.
* **Example Code Output:**
  ```html
  <div style="background: var(--surface); border: 1px solid var(--text-muted); border-radius: 12px; padding: 20px; box-shadow: 0 4px 12px var(--accent-glow);">
    <h3 style="color: var(--accent-primary); margin: 0 0 10px 0;">Server Monitor</h3>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
      <div style="background: var(--background-main); padding: 10px; border-radius: 8px;">
        <span style="color: var(--text-secondary); font-size: 12px;">CPU Load</span>
        <h4 style="color: var(--status-success); margin: 5px 0 0 0;">18%</h4>
      </div>
      <div style="background: var(--background-main); padding: 10px; border-radius: 8px;">
        <span style="color: var(--text-secondary); font-size: 12px;">Memory Usage</span>
        <h4 style="color: var(--status-warning); margin: 5px 0 0 0;">76%</h4>
      </div>
    </div>
  </div>
  ```

### 5.3. Mini Apps (`<mini_app>`)
* **Description:** For stateful, interactive widgets (e.g. calculators, input forms, interactive games, interactive graphs), the AI outputs a full Mini App.
* **Syntax structure:**
  ```xml
  <mini_app>
    <title>Visual Calc</title>
    <html>
      <div class="calc-box">
        <input id="num" type="number" />
        <button onclick="double()">Calc</button>
      </div>
    </html>
    <css>
      .calc-box { background: var(--surface); padding: 10px; }
    </css>
    <js>
      function double() {
        const val = document.getElementById('num').value;
        alert(val * 2);
      }
    </js>
  </mini_app>
  ```
* **Renderer Interception & Iframe Security Sandboxing:** When the React rendering engine detects a `<mini_app>` tag in the streamed LLM output, it intercepts it and parses the content. It dynamically constructs a data-URI or a local blob containing the HTML structure, the CSS styles, and the JS script tags. This is then loaded into an `<iframe>` element.
* **Security Constraints:** To prevent the AI-generated code from accessing the parent Electron window (which would bypass the preload security bridge and expose Node.js execution capabilities), the iframe is heavily sandboxed using standard HTML attributes:
  ```html
  <iframe 
    sandbox="allow-scripts" 
    src="data:text/html;charset=utf-8,..." 
    style="border: none; width: 100%; height: 300px; background: transparent;">
  </iframe>
  ```
  By restricting the sandbox to `allow-scripts` and intentionally omitting `allow-same-origin`, the mini app runs in an isolated origin. It has no access to the parent document, `window.parent`, cookies, localStorage, or IPC channels.
* **Theme Synchronization:** To keep the styles aligned with the parent theme, the parent React window sends postMessage updates containing the current CSS variables map. The iframe’s initialization script intercepts these events and writes the CSS custom properties onto its own document root, ensuring seamless theme updates inside the sandboxed widget.
