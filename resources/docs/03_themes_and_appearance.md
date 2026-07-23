# Themes and Appearance Architecture

## 1. Overview of Prism's Styling System

Prism features a modern visual design system engineered with **Tailwind CSS v4** and **LightningCSS**. The UI emphasizes glassmorphism, responsive micro-animations, customizable typography using Google's **Outfit** font, and dynamic theme switching.

---

## 2. Visual Themes Directory

Prism provides six distinct built-in visual themes. Themes dynamically reconfigure CSS custom properties across both the main chat workspace and the Quick Launcher overlay.

| Theme Key | Theme Name | Visual Profile | Dominant Palette |
| --- | --- | --- | --- |
| `marine` | Marine (Default) | Deep ocean glassmorphism with vivid cyan and dark blue accents | `#0b132b`, `#1c2541`, `#3a506b`, `#48cae4` |
| `vertez` | Vertez | Emerald forest palette with luminous neon green indicators | `#062c22`, `#0b4d3c`, `#137559`, `#2ec4b6` |
| `akoustik` | Akoustik | Cyberpunk studio aesthetic with electric amber and magenta hues | `#1a0933`, `#341159`, `#5a189a`, `#ff007f` |
| `terno` | Terno | Sleek dark slate monochrome for distraction-free coding | `#121212`, `#1e1e1e`, `#2d2d2d`, `#e0e0e0` |
| `ursula` | Ursula | Deep amethyst purple glass with subtle glowing borders | `#160f29`, `#241747`, `#36246e`, `#9d4edd` |
| `rgb` | RGB Easter Egg (discontinued) | Dynamic cycling spectrum theme unlocked via app Easter egg | Dynamic multi-color gradient keyframes |

---

## 3. UI Zoom Factor and Scaling

Users can scale the entire user interface dynamically to match high-DPI displays or custom font size preferences:
- **Range:** `0.5x` (50% scale) to `3.0x` (300% scale).
- **Configuration:** Updated via System Settings or programmatically via the `configure_prism` tool (`zoomFactor` parameter).
- **Implementation:** Applies Electron `webFrame.setZoomFactor` synchronously across renderer views.

---

## 4. Layout Architecture and Micro-Animations

### 4.1. Glassmorphism Panels
Panels, modals, floating action bars, and the Quick Launcher utilize backdrop blur filters (`backdrop-blur-md`, `backdrop-blur-xl`) with semi-transparent background colors (`rgba(..., 0.75)`).

### 4.2. Streamed Markdown Rendering
Chat bubbles render live token streams using `react-markdown` + `rehype-raw` + `rehype-katex` + `prismjs`. Math expressions (LaTeX `\(...\)` or `$$...$$`) compile smoothly via KaTeX without causing layout shifts.

### 4.3. ActionLoader Component
Tool calls render as animated `ActionLoader` widgets with status indicators (`writing`, `running`, `done`, `error`), showing real-time terminal output or browser steps.
