# Themes and Appearance Architecture

## 1. Overview of Prism's Styling System

Prism features a modern visual design system engineered with **Tailwind CSS v4** and **LightningCSS**. The UI emphasizes glassmorphism, responsive micro-animations, customizable typography using Google's **Outfit** font, and dynamic theme switching.

---

## 2. Visual Themes Directory

Prism provides eight built-in spectral themes, plus the unlockable `hero` reward theme (see 2.1). Themes dynamically reconfigure CSS custom properties across both the main chat workspace, Quick Launcher overlay, and glassmorphic surfaces.

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

## 2.1. The Hero Theme (Easter-Egg Reward)

The `hero` theme is a special reward unlocked by mastering **Prism Arcade**, the version-9 easter egg hidden behind the version number in `Settings > About` (click it five times). It is the successor of the discontinued time-limited `rgb` theme.

- **Unlock condition:** beat all nine Arcade mini-games (each has an explicit target score). Progress is stored in `arcadeScores` (high score per game id) and the unlock flag in `heroUnlocked`, both persisted in `AppConfig`. The unlock is permanent **until the user resets it**: with the theme unlocked, Settings → Appearance & Scaling → Hero Progress offers "Reset Arcade Progress" (inline two-step confirmation), which clears `arcadeScores`, sets `heroUnlocked: false` and reverts the theme to Marine — revoking the particle "9", the accent driver and the Sidebar HERO badge; everything can be re-earned by beating the nine games again.
- **Visual behavior:** the "9" is rendered by `HeroParticles` (`src/renderer/src/components/HeroParticles.tsx`) as a detailed, analytic signed-distance-field glyph (bowl ring + tail) made of light particles that clump into the stroke, pulse in brightness, cycle the full hue spectrum and react to the cursor (radial push, drag along cursor motion, slight swirl — all fluid, spring-damped). It appears in two places inside `ChatPane`, never app-wide:
  - **Landing stage** (`mode="stage"`): when a tab has no messages, a large bright "9" owns the space where the "Search & Create" / hero titles and the "Prism session is ready" copy used to be — both are hidden in Hero mode.
  - **Conversation backdrop** (`mode="backdrop"`): once a conversation has messages, a dim ambient "9" becomes a true full-pane background layer behind the messages and input bar, still mouse-reactive and pointer-transparent.
  - A separate `HeroAccentDriver` (exported from the same file, mounted app-wide in `App.tsx`) rotates the `--hero-accent` / `--hero-accent-2` CSS variables (throttled interval, no rAF) so the entire themed interface shifts color continuously. Canvases use ResizeObserver-driven rebuilds (split-view safe) and a 0.7 s fade-in.
- **Performance model (GPU-first):** rendering goes through WebGL point sprites — the entire field is a single draw call; per-particle hue, pulse, twinkle and depth shading run in the fragment shader, and only positions are streamed to the GPU each frame (one `bufferSubData` into fixed-capacity VBOs). Physics is a fixed 60 Hz CPU step (spring + damping + cursor forces) with a spiral-of-death clamp, plus containment: a soft force wall engages just past the glyph's home bounds and a hard damped clamp at the canvas edge backstops it, so a violent cursor fling can never push particles outside the canvas (which would clip them mid-glyph as a hard black slice). Cursor velocity is capped in the input layer as a further bound. The simulation is warmed up synchronously before the canvas fades in, so the glyph appears fully formed. The render loop pauses when the canvas is offscreen (`IntersectionObserver`), when the tab is hidden (`visibilitychange`) and on WebGL context loss (rebuilt on restore). A prerendered-sprite 2D canvas renderer is the fallback when WebGL is unavailable. DPR is capped at 1.5.
- **Module structure:** the engine lives in `src/renderer/src/hero/` with one owner per concern — `glyph.ts` (pure "9" signed-distance-field geometry), `simulation.ts` (`createSimulation`: the single owner of all mutable particle state, mode configs, physics accumulator, mouse state — the React component only writes cursor coordinates into it) and `renderer.ts` (`createHeroRenderer`: presenters only, WebGL + 2D fallback behind one selector; renderers read the field and never mutate it). `components/HeroParticles.tsx` is now React wiring only (mounting, mouse events, loop, observers) and re-exports the same public surface (`HeroParticles`, `HeroAccentDriver`), so `App.tsx` and `ChatPane.tsx` are untouched by the split.
- **Selection gating:** the theme picker shows the Hero card with a lock badge until `heroUnlocked` is true; the Settings gear in the Sidebar shows a permanent `HERO` badge once unlocked.
- **Icon assets:** the tray/window icons exist only for the eight classic themes (`getEffectiveIconTheme` in `src/main/index.ts` and `getIconPath` in `src/main/demo.ts` map `hero` to the marine icon).
- **Arcade implementation:** `src/renderer/src/components/ArcadeGame.tsx` — nine games (Photon Reflex, Data Serpent, Brick Cascade, Drift Vector, Aperture, Echo Matrix, Light Stack, Glyph Rush, Orbit Trap). Four physics-based games render on canvas engines layered over a shared decorative backdrop; the rest use DOM/SVG. No audio, no assets, pointer-first input.

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

### 4.1.1. Liquid Glass optics (Max mode)
In Max performance mode, true-glass surfaces mount a real refraction layer (`LiquidGlassSurface`): an SVG `feDisplacementMap` fed by a generated normal field bends the live backdrop at the edges — compression, fold/inversion and a slight magnification dip, in the manner of iOS Liquid Glass — with chromatic aberration, saturation lift and rim lighting. Center blur intentionally equals the band blur so background text stays recognizable without competing with foreground text. The effect covers the InputBar, Quick Launcher, all dropdown menus (model selector, attach `+`, session/permission modes, TabBar and harness menus), docked panels and small pills (scroll-to-bottom, citation). Details and tuning constants: `resources/docs/liquid_glass.md`.

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
tint of 1.2s, with an additional 1.0s unblur in Max mode only (blur is never
animated in other modes for frame-budget safety). `Settings > Appearance >
Rendering Performance` offers `Auto` (default, full visuals with a temporary
imperceptible step-down under load), `Performance (Beta)` (lightweight look:
no backdrop blur or glassmorphism, fade-only streaming for maximum fluidity),
and `Max` (cinematic streaming with fade, tint, and unblur).
