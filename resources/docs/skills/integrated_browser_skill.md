---
name: integrated_browser_skill.md
title: Technical Skill: Prism Integrated AI Browser & Web Automation
description: Complete specification, session management, Playwright DOM inspection, element ID resolution, form interaction, JS scripting, and tool instructions for operating the Prism integrated browser.
unlocked_tools:
  - open_browser
  - browser_navigate
  - browser_snapshot
  - browser_click
  - browser_type
  - browser_press
  - browser_scroll
  - browser_back
  - browser_screenshot
  - web_script
  - detailed_dom_page
---

# Technical Skill: Prism Integrated AI Browser & Web Automation

## 1. Scope, Purpose & System Browser Distinction

### 1.1 Critical Scope Rule
The Prism platform features two distinct browser interaction modes:

1. **System Default Browser (`open_browser_link`)**:
   - **Purpose**: Opens external URLs directly in the user's primary operating system browser (e.g. Google Chrome, Microsoft Edge, Mozilla Firefox, Brave, Safari).
   - **When to Use**: MANDATORY default whenever the user asks to open a link, visit a website, or view a webpage (e.g., *"Abre o link https://..."*, *"Visita o site do Google"*).
   - **Tool**: `open_browser_link({ url: "https://..." })`. Does NOT require this skill file to be read.

2. **Prism Integrated AI Browser (`open_browser` and `browser_*` tools)**:
   - **Purpose**: An embedded, persistent, Playwright-controlled Chromium instance running inside Prism for autonomous web navigation, interactive form filling, live DOM inspection, and visual snapshotting.
   - **When to Use**: ONLY when the user EXPLICITLY requests the AI in-app browser using terms such as *"navegador integrado"*, *"navegador da IA"*, *"seu navegador"*, *"navegador do Prism"*, *"navegador in-app"*, *"AI Browser"*, *"browser interno"*, etc.
   - **Activation**: Requires reading this skill file (`integrated_browser_skill.md`), which unlocks the 11 integrated browser execution tools for the session.

---

## 2. Integrated Browser Tool Specifications

Reading this skill unlocks the following 11 integrated browser tools:

### 2.1 Session & Navigation Tools
- **`open_browser`**: Initializes or attaches to the persistent Prism in-app browser session. Accepts an optional `url` parameter (e.g. `{ url: "https://example.com" }`).
- **`browser_navigate`**: Navigates the active browser session to a new URL (e.g. `{ url: "https://news.ycombinator.com" }`).
- **`browser_back`**: Navigates backwards in the active browser history tab.

### 2.2 Inspection & Reading Tools
- **`browser_snapshot`**: Generates a high-level semantic accessibility tree and interactive DOM snapshot with unique numerical element IDs (e.g., `[42] <button>Submit</button>`). Accepts an optional `full: true` parameter for full-page inspection.
- **`detailed_dom_page`**: Extracts the structured HTML DOM tree of the active page for deep inspection of nested elements, hidden fields, and custom web components.
- **`browser_screenshot`**: Captures a full high-resolution PNG image of the current browser viewport for visual verification.

### 2.3 Interaction Tools
- **`browser_click`**: Clicks an interactive element using its assigned `elementId` from the latest `browser_snapshot` (e.g. `{ elementId: "42" }`).
- **`browser_type`**: Enters text into an input field, textarea, or content-editable element by its `elementId` (e.g. `{ elementId: "18", text: "Prism AI" }`).
- **`browser_press`**: Sends keypress events (such as `"Enter"`, `"Escape"`, `"Tab"`, `"Backspace"`, `"ArrowDown"`) to the active element or document.
- **`browser_scroll`**: Scrolls the active browser viewport up or down by pixel amount (e.g. `{ direction: "down", amount: 500 }`).
- **`web_script`**: Executes arbitrary JavaScript code inside the page context and returns the evaluation result (e.g. `{ script: "document.title" }`).

---

## 3. Persistent Session Architecture & Lifecycle

### 3.1 Single Live Session Rule
Prism maintains a **single persistent browser session** across tool invocations within a conversation.
- **Initialization**: Call `open_browser({ url: "..." })` once to start or attach to the live session.
- **Subsequent Operations**: Do NOT call `open_browser` multiple times if a session is already active. Once initialized, use `browser_navigate`, `browser_snapshot`, `browser_click`, etc., directly.
- **State Preservation**: Cookies, localStorage, sessionStorage, and navigation history persist across turns until closed.

### 3.2 Navigation & Load Lifecycle
When invoking `open_browser` or `browser_navigate`:
1. The browser initiates page load and waits for DOM network idle state (`load` event).
2. For single-page applications (SPAs) like React, Vue, or Next.js, content may load asynchronously after initial HTML render.
3. If an initial `browser_snapshot` returns placeholder skeletons or missing data, execute a short delay or re-issue `browser_snapshot` / `web_script` to wait for dynamic elements to render.

---

## 4. Semantic DOM Inspection & Element ID Resolution

### 4.1 How `browser_snapshot` Works
The `browser_snapshot` tool renders a simplified, token-efficient text representation of the web page based on its accessibility object model (AOM). Every interactive or structural element is assigned an `elementId`:

```text
- [12] <link "Home" href="/">
- [15] <input type="text" placeholder="Search products...">
- [18] <button "Search">
- [24] <heading "Featured Products" level=2>
```

### 4.2 Element ID Resolution Protocol
1. **Always Snapshot First**: Before calling `browser_click` or `browser_type`, you MUST take a `browser_snapshot` to obtain up-to-date `elementId` references.
2. **Dynamic ID Invalidation**: Whenever a page navigates, submits a form, or dynamically updates its DOM via JavaScript (AJAX/Fetch), old `elementId` numbers become invalid. Re-run `browser_snapshot` after interaction to fetch fresh IDs.
3. **Compact vs Full Snapshots**: Use `browser_snapshot({ full: false })` for standard interactive inspection. Use `browser_snapshot({ full: true })` or `detailed_dom_page` for long articles, complex dashboards, or nested forms.

---

## 5. Form Interaction & User Input Protocols

### 5.1 Text Typing (`browser_type`)
To fill text fields, search bars, or login inputs:
1. Locate the input element in the latest `browser_snapshot` (e.g. `[15] <input placeholder="Username">`).
2. Call `browser_type({ elementId: "15", text: "user@example.com" })`.
3. If submitting a search form requires pressing Enter immediately after typing, invoke `browser_press({ key: "Enter" })`.

### 5.2 Element Clicking (`browser_click`)
To click links, buttons, checkboxes, or dropdown options:
1. Identify the target `elementId` from `browser_snapshot`.
2. Call `browser_click({ elementId: "18" })`.
3. Check the returned result. If the click triggers a page navigation, wait for the response and issue a new `browser_snapshot` to inspect the updated page.

### 5.3 Keypresses & Keyboard Navigation (`browser_press`)
Common keyboard interactions:
- Submit forms: `browser_press({ key: "Enter" })`
- Close popups/modals: `browser_press({ key: "Escape" })`
- Tab between form fields: `browser_press({ key: "Tab" })`
- Scroll or select dropdown items: `browser_press({ key: "ArrowDown" })`

### 5.4 Page Scrolling (`browser_scroll`)
When content is below the fold or lazy-loaded on scroll:
- Call `browser_scroll({ direction: "down", amount: 600 })` to trigger infinite scroll or bring lower elements into view.
- Take a new `browser_snapshot` to inspect newly revealed DOM nodes.

---

## 6. Advanced Scripting with `web_script`

When standard click or snapshot tools are insufficient (e.g. shadow DOM, hidden inputs, custom canvas controls, or bulk data extraction), use `web_script` to run JavaScript directly in the page:

### 6.1 Data Extraction Examples
Extracting all links from a page:
```javascript
web_script({
  script: `Array.from(document.querySelectorAll('a')).map(a => ({ text: a.innerText.trim(), href: a.href })).filter(x => x.text)`
})
```

Extracting table data to structured JSON:
```javascript
web_script({
  script: `Array.from(document.querySelectorAll('table tr')).map(tr => Array.from(tr.querySelectorAll('th, td')).map(td => td.innerText.trim()))`
})
```

### 6.2 Triggering Custom DOM Events
Clicking hidden or non-standard elements:
```javascript
web_script({
  script: `const btn = document.querySelector('.custom-submit-btn'); if (btn) btn.click();`
})
```

Scrolling to specific elements:
```javascript
web_script({
  script: `document.querySelector('#section-pricing').scrollIntoView({ behavior: 'smooth' });`
})
```

---

## 7. Visual Inspection & Screenshot Verification

### 7.1 Using `browser_screenshot`
When visual layout, UI styling, charts, image placement, or canvas elements need inspection:
- Execute `browser_screenshot()`.
- Prism will capture a full-resolution PNG screenshot of the current page viewport and return image metadata.
- Use screenshots to verify layout correctness, visual alignment, modal overlay states, or graphical charts.

---

## 8. Anti-Bot Awareness & Error Recovery Strategies

### 8.1 Captchas & Bot Detection
Modern websites may deploy Cloudflare, CAPTCHA, or anti-bot verification challenges:
- If `browser_snapshot` reveals CAPTCHA prompts or Cloudflare challenge pages, inform the user clearly that interactive human verification is required.
- Do NOT attempt to brute-force CAPTCHAs.

### 8.2 Cookie Banners & Overlays
Modals, GDPR banners, and subscription popups often obscure page elements:
1. Check `browser_snapshot` for button element IDs with text like `"Accept All"`, `"Agree"`, `"Close"`, or `"X"`.
2. Click the dismissal button via `browser_click` or send `browser_press({ key: "Escape" })`.
3. Take a fresh `browser_snapshot` to resume main task execution.

### 8.3 Handling Navigation Timeouts
If a page load times out or fails:
1. Re-try navigation with `browser_navigate({ url: "..." })`.
2. Verify URL formatting (ensure `https://` protocol is included).
3. If page continues to fail, report error status and offer fallback recommendations.

---

## 9. Comprehensive Step-by-Step Automation Workflows

### 9.1 Workflow Example 1: Autonomous E-Commerce Product Search
1. **Initialize Session**:
   `open_browser({ url: "https://www.example-store.com" })`
2. **Inspect Home Page**:
   `browser_snapshot()` -> Identifies `[14] <input placeholder="Search products">` and `[15] <button "Search">`.
3. **Type Search Query**:
   `browser_type({ elementId: "14", text: "Wireless Headphones" })`
4. **Submit Form**:
   `browser_press({ key: "Enter" })`
5. **Inspect Search Results**:
   `browser_snapshot()` -> Identifies item links `[32] <link "Noise Cancelling Headphones - $199">`.
6. **Navigate to Item**:
   `browser_click({ elementId: "32" })`
7. **Extract Details**:
   `web_script({ script: "document.querySelector('.product-description').innerText" })`

### 9.2 Workflow Example 2: Multi-Page Article Scraping
1. **Initialize Session**:
   `open_browser({ url: "https://tech-blog.example.com/latest" })`
2. **Scroll Down Page**:
   `browser_scroll({ direction: "down", amount: 800 })`
3. **Extract Structured Data**:
   `web_script({ script: "Array.from(document.querySelectorAll('article')).map(a => ({ title: a.querySelector('h2')?.innerText, url: a.querySelector('a')?.href }))" })`
4. **Capture Visual Proof**:
   `browser_screenshot()`

---

## 10. Summary Protocol & Checklist

- **System Browser Default**: Always use `open_browser_link` for general user URL opening requests.
- **In-App AI Browser**: Use `open_browser` and `browser_*` tools ONLY when the user explicitly requests the AI/integrated/in-app browser.
- **Snapshot Before Action**: Always take a `browser_snapshot` to get fresh `elementId` tags before interacting.
- **Re-Snapshot After Change**: Navigations, clicks, and form submissions invalidate old `elementId` tags. Take a new snapshot after DOM mutations.
- **JS Scripting Fallback**: Use `web_script` for complex DOM extraction or custom JS evaluation.
