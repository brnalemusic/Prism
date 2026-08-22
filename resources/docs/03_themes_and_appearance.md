# Themes and Appearance Architecture

## 1. Overview of Prism's Styling System

Prism features a modern visual design system engineered with **Tailwind CSS v4** and **LightningCSS**. The UI emphasizes glassmorphism, responsive micro-animations, customizable typography using Google's **Outfit** font, and dynamic theme switching.

---

## 2. Visual Themes Directory

Prism provides eight built-in spectral themes. Themes dynamically reconfigure CSS custom properties across both the main chat workspace, Quick Launcher overlay, and glassmorphic surfaces. Full design system specifications are documented in [DESIGN.md](../../.agents/rules/DESIGN.md).

| Theme Key | Theme Name | Visual Profile | Dominant Palette |
| --- | --- | --- | --- |
| `marine` | Marine (Default) | Deep ocean glassmorphism with vivid cyan and dark blue accents | `#38bdf8`, `#7dd3fc`, `#030d15` |
| `fire` | Fire Red | Energetic crimson and ruby glassmorphism with vivid warm glow | `#ff3b2f`, `#ff6b35`, `#150607` |
| `lava` | Lava Orange | Luminous amber-orange glass with warm embers | `#ff6b00`, `#ffae42`, `#160900` |
| `gold` | Corporate Gold | Elegant champagne and gold glass with executive slate | `#f5c518`, `#ffe066`, `#151100` |
| `forest` | Forest Green | Crisp emerald and mint glass with botanical accents | `#22c55e`, `#86efac`, `#04120a` |
| `indigo` | Indigo | Deep sapphire and twilight purple glass with futuristic neon | `#6366f1`, `#a5b4fc`, `#070918` |
| `violet` | Soft Violet | Amethyst and orchid glass with ethereal violet tones | `#a855f7`, `#d8b4fe`, `#100718` |
| `white` | Classic White | Minimalist monochrome crystal glass with pure highlights | `#ffffff`, `#e4e4e7`, `#080808` |

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
