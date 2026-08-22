# Prism Design System: Ultra-Minimalist Glassmorphism

> **Status:** Active Specification | **Style:** Frosted Glassmorphism & Spectral Theming

---

## 1. Executive Vision & Core Pillars

Prism's visual identity reflects an **optical prism**: an ethereal, translucent aperture that disperses complex AI execution into crisp, focused output. The system prioritizes **extreme minimalism, frosted glass surfaces, specular light edges, and deep ambient contrast**.

1. **Pure Translucency & Blur:** Multi-tiered frosted surfaces (`backdrop-filter: blur(...)`) create spatial depth without obstructing the background canvas.
2. **Specular Edge Refraction:** 1px frosted top borders (`rgba(255, 255, 255, 0.08–0.18)`) simulating physical glass light reflection.
3. **Adaptive Thematic Depth:** All glass surfaces dynamically tint to match the active spectral theme palette.
4. **Extreme Minimalism:** Zero visual clutter, generous whitespace, content-first layout, and no harsh opaque dividers.
5. **Floating Spatial Canvas:** Capsules, floating command islands, and diffused soft shadows (`0 16px 48px rgba(0,0,0,0.45)`).

---

## 2. Surface & Elevation Token Architecture

Prism organizes elevation into four translucent layers:

| Layer Token | Background Alpha | Backdrop Blur | Specular Border | Target UI Elements |
| :--- | :--- | :--- | :--- | :--- |
| `Canvas (L0)` | `rgba(0, 0, 0, 1.0)` | None | None | Application base backdrop |
| `Subtle (L1)` | `rgba(255, 255, 255, 0.02)` | `blur(12px)` | `rgba(255, 255, 255, 0.05)` | Sidebars, inactive tab strips, panels |
| `Card (L2)` | `rgba(255, 255, 255, 0.04)` | `blur(16px)` | `rgba(255, 255, 255, 0.08)` | Assistant messages, tool execution pills |
| `Floating (L3)` | `rgba(255, 255, 255, 0.08)` | `blur(24px)` | `rgba(255, 255, 255, 0.14)` | Floating Input Bar, dropdowns, menus |
| `Modal (L4)` | `rgba(10, 10, 15, 0.75)` | `blur(32px)` | `rgba(255, 255, 255, 0.16)` | Settings, Quick Launcher, Auth dialogs |

### Specular Lighting & Shadow Tokens
```css
--border-glass-subtle: rgba(255, 255, 255, 0.06);
--border-glass-default: rgba(255, 255, 255, 0.10);
--border-glass-highlight: rgba(255, 255, 255, 0.18);
--border-glass-accent: color-mix(in srgb, var(--accent-primary) 35%, rgba(255, 255, 255, 0.1));

--glass-specular-top: inset 0 1px 0 0 rgba(255, 255, 255, 0.12);
--glass-shadow-sm: 0 4px 16px rgba(0, 0, 0, 0.25);
--glass-shadow-md: 0 12px 32px rgba(0, 0, 0, 0.40);
--glass-shadow-lg: 0 24px 64px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.08);
```

---

## 3. Theme Compatibility & Tinting Formulas

The design system harmonizes with Prism's 8 built-in themes using CSS `color-mix`:

```css
.glass-panel {
  background: color-mix(in srgb, var(--surface) 65%, transparent);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid var(--border-glass-default);
  box-shadow: var(--glass-specular-top), var(--glass-shadow-md);
}

.glass-panel-floating {
  background: color-mix(in srgb, var(--surface-raised) 75%, transparent);
  backdrop-filter: blur(28px);
  -webkit-backdrop-filter: blur(28px);
  border: 1px solid var(--border-glass-highlight);
  box-shadow: var(--glass-specular-top), var(--glass-shadow-lg);
}
```

### Spectral Theme Palettes
- **`marine` (Default):** Cyan `#38bdf8` / Sky `#7dd3fc` / Deep Slate Blue `#030d15`
- **`fire`:** Crimson `#ff3b2f` / Coral `#ff6b35` / Garnet `#150607`
- **`lava`:** Amber `#ff6b00` / Gold `#ffae42` / Warm Embers `#160900`
- **`gold`:** Executive Gold `#f5c518` / Champagne `#ffe066` / Slate `#151100`
- **`forest`:** Emerald `#22c55e` / Mint `#86efac` / Deep Forest `#04120a`
- **`indigo`:** Electric Indigo `#6366f1` / Periwinkle `#a5b4fc` / Midnight `#070918`
- **`violet`:** Amethyst `#a855f7` / Lavender `#d8b4fe` / Orchid `#100718`
- **`white`:** Crystal White `#ffffff` / Silver `#e4e4e7` / Monochrome `#080808`

---

## 4. Global Layout & UX Architecture

1. **Frameless Title Bar (38px):** Minimal drag region with typewriter session title and system window controls.
2. **Frosted Glass Sidebar:** Translucent vertical pane (`backdrop-blur-xl`), "+ New Chat" glass button, grouped folder history, active highlight pills (`bg-white/[0.06] text-white`), and bottom user profile card.
3. **Floating Tab Strip:** Active tab renders as a frosted glass pill with top specular shimmer and accent dot. Inactive tabs stay understated. Integrated model dropdown directly in the tab header.
4. **Distraction-Free Conversation Canvas:** Centered optimal reading column (`max-w-[820px]`). Right-aligned glass bubbles for user prompts; clean typographic flow with character-fade streaming for assistant responses.
5. **Floating Command Input Island:** Centered frosted capsule floating 20px above the bottom edge. Includes attachment clip, camera screenshot, web search toggle, voice dictation wave pill, Session Mode selector (`Conversation`, `Execution`, `Discipline`), and skills popover.

---

## 5. Component Specifications

- **Tool Calls (`ActionLoader`):** Floating rounded-full glass pill (`h-8 px-3 py-1`) with animated status icon. Smoothly expands into a dark monospace terminal box (`#05080c`).
- **Thinking Bubbles:** Frosted thought capsule with soft accent border, pulsing brain icon, and duration badge. Collapsible with a single click.
- **Code Blocks:** Translucent dark container (`bg-black/60 backdrop-blur-md`) with 1px frosted border, syntax highlighting, copy button, and run shortcut.
- **Artifact Cards (PDF / PPTX):** Clean presentation cards with thumbnail preview, file metadata, and quick action buttons.
- **Modals & Overlays:** Background dark blur scrim (`bg-black/75 backdrop-blur-md`) with centered floating frosted glass panel (`rounded-2xl border border-glass-highlight`).

---

## 6. Motion & Interaction Tokens

- **Hover:** Subtle elevation (`translateY(-1px)`) and border brightening.
- **Active Click:** Elastic micro-press (`scale(0.98)`).
- **Transitions:** `--ease-spring: cubic-bezier(0.16, 1, 0.3, 1)` with `200ms` duration.
- **Reduced Motion:** Respects `prefers-reduced-motion: reduce` with instant opacity fades.

---

## 7. Contributor Design Checklist

- [ ] Use glass tokens (`backdrop-blur`, `color-mix`, `rgba`) over opaque solid colors.
- [ ] Ensure 1px specular light border exists on elevated elements.
- [ ] Preserve dynamic theme variables (`var(--accent-primary)`, `var(--surface)`).
- [ ] All UI strings and code comments strictly in **English**.
- [ ] Verify WCAG AA contrast against frosted backgrounds.
