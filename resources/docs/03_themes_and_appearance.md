# Themes and Appearance Architecture

## 1. Overview of Prism's Styling System

Prism features a modern visual design system engineered with **Tailwind CSS v4** and **LightningCSS**. The UI emphasizes glassmorphism, responsive micro-animations, customizable typography using Google's **Outfit** font, and dynamic theme switching.

---

## 2. Visual Themes Directory

Prism provides eight built-in spectral themes. Themes dynamically reconfigure CSS custom properties across both the main chat workspace, Quick Launcher overlay, and glassmorphic surfaces.

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

### 4.1.1. Liquid Glass optics (Maximum mode)
In Maximum performance mode, true-glass surfaces mount a real refraction layer (`LiquidGlassSurface`): an SVG `feDisplacementMap` fed by a generated normal field bends the live backdrop at the edges — compression, fold/inversion and a slight magnification dip, in the manner of iOS Liquid Glass — with chromatic aberration, saturation lift and rim lighting. Center blur intentionally equals the band blur so background text stays recognizable without competing with foreground text. The effect covers the InputBar, Quick Launcher, the Search modal, all dropdown menus (model selector, attach `+`, session/permission modes, TabBar and harness menus), docked panels and small pills (scroll-to-bottom, citation). Details and tuning constants: `resources/docs/liquid_glass.md`.

### 4.1.2. Dialog surfaces and motion tokens
Prism-owned dialogs (`.prism-modal-backdrop` / `.prism-modal-panel`) follow the performance mode:
- **Medium:** Aero-Glass Dark — translucent plate with `blur(24px) saturate(140%)`, a top rim-light highlight and layered depth shadows; backdrop blur 12px.
- **Performance:** no backdrop blur; solid plate.
- **Maximum:** the plate hosts `LiquidGlassSurface` (currently the Search modal); ancestor filters are removed so the optics sample the live app, and the backdrop is a light dim only.

Shared motion tokens live next to the dialog CSS: `--ease-snappy` (`cubic-bezier(0.16, 1, 0.3, 1)`), `--dur-press` 160ms, `--dur-hover` 150ms, `--dur-enter` 190ms, `--dur-exit` 140ms. Controls must not use `transition-all`: use the `transition-interactive` utility (transform/translate/scale/colors/opacity/shadow only) or `.prism-tactile` (adds a `scale(0.98)` press). Dialog entrances scale from 0.98 with a 6px settle; exits are faster than entrances. All motion is disabled under `prefers-reduced-motion`.

### 4.2. Streamed Markdown Rendering
Chat bubbles render live token streams using `react-markdown` + `rehype-raw` + `rehype-katex` + `prismjs`. Math expressions (LaTeX `\(...\)` or `$$...$$`) compile smoothly via KaTeX without causing layout shifts.

### 4.3. ActionLoader Component
Tool calls render as animated `ActionLoader` widgets with status indicators (`writing`, `running`, `done`, `error`), showing real-time terminal output or browser steps.

### 4.4. Rendering Performance
Glass surfaces keep full quality when idle. Blurred panels use compositor
containment (`isolation: isolate`, `contain: layout style`) so streaming
text and scrolling do not invalidate fullscreen blur layers. `paint`
containment is deliberately excluded on glass/chrome surfaces because it
clips absolutely positioned flyout menus (model selector, attach/session
menus). Chat rows use `content-visibility: auto` virtualization, syntax highlighting reuses a bounded
Prism token cache, and the streaming timeline keeps a capped live window with
identical final output. Streaming reveal is driven by the `motion` library
(`AnimatedStreamingText` + `streamingMotion`): fade-in 0.8s plus a letter
tint of 1.2s, with an additional 1.0s unblur in Maximum mode only (blur is never
animated in other modes for frame-budget safety). `Settings > Appearance >
Rendering Performance` offers `Medium` (default, full visuals with a temporary
imperceptible step-down under load), `Performance` (lightweight look:
no backdrop blur or glassmorphism, fade-only streaming for maximum fluidity),
and `Maximum` (cinematic streaming with fade, tint, and unblur). The reveal
clears the inherited Motion presence context on every animated streaming node,
because the workspace shell lives inside `AnimatePresence initial={false}` and
that flag would otherwise make spans mount directly at their final frame. Chat,
Harness, the Quick Launcher, and the demo therefore share the exact same reveal.

### 4.5. Boot & Welcome Stage Architecture
- **Boot Loading Screen (`LoadingScreen.tsx`)**: Replaces simple indeterminate spinners with a staged diagnostic pipeline. Features a double-bezel glass container, the vector `PrismMark` seven-beam spectral dispersion fan that progressively illuminates with boot stages (Network Core → Provider Credentials → Model Diagnostic → System Ready), a shimmering progress bar, and frosted error recovery surfaces.
- **Empty Tab State (`EmptyTabState.tsx`)**: Renders when all workspace tabs are closed. Provides atmospheric depth lighting, the seven-beam Prism mark, an ergonomic primary "Open New Tab" button with button-in-button nested icons, and keyboard shortcut chips (`Ctrl+N`, `Ctrl+K`, `Ctrl+O`).
- **Interactive Landing Hub (`ChatPane.tsx`)**: When a tab is newly opened with no messages, displays an ambient mode status badge, refined hero typography, and mode-specific Quick Starter chips: Conversation mode offers pure chat & reasoning actions (`Explain a Concept`, `Brainstorm Ideas`, `Draft Content`, `Analyze Trade-offs`); Execution mode offers guarded terminal & profile diagnostics (`System Diagnostics`, `Terminal Command`, `Inspect Environment`, `Network Health`); Discipline mode offers project-bounded file actions (`Explore Project`, `Search Project`, `Run Project Scripts`, `Organize Files`); and Harness mode offers code-modification actions (`Inspect Codebase`, `Fix Bugs`, `Add Feature`, `Refactor Code`).
