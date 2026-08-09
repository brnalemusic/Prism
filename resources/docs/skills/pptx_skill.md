---
name: pptx_skill.md
title: Technical Skill: Professional 16:9 Widescreen PowerPoint Artifact Generation
description: Complete specification, 1080p slide architecture, CSS grid layouts, visual cards, background color mapping, and tool instructions for generating PowerPoint presentations (.pptx).
unlocked_tools:
  - write_pptx
  - edit_pptx
---

# Technical Skill: Professional 16:9 Widescreen PowerPoint Artifact Generation

## 1. Overview & Capabilities
This skill teaches you how to design modern, high-impact widescreen (16:9) PowerPoint presentations (.pptx) using HTML and CSS compiled via Prism's Chromium headless engine (1920x1080 resolution capture) and `PptxGenJS`.

By structuring each slide inside a `<div class="slide">` container, your presentation will be converted slide-by-slide into native, editable PowerPoint presentations with high visual quality, crisp typography, and visual cards.

---

## 2. Unlocked Tools Specification

When this skill is active, you are authorized to call the following PPTX artifact tools:

### 2.1 `write_pptx`
Generates a 16:9 PowerPoint presentation artifact from complete slide HTML and CSS.
- **`filename`** (string): Filename for the presentation (e.g. `product_pitch.pptx`).
- **`html`** (string): Complete HTML string containing elements with class `.slide` (or `<section>`).

### 2.2 `edit_pptx`
Updates an existing PowerPoint artifact while preserving its 6-digit artifact ID or path.
- **`id`** (string, optional): 6-digit artifact ID (e.g. `492018`).
- **`path`** (string, optional): Absolute path to the PPTX file if ID is omitted.
- **`html`** (string): Updated complete slide HTML and CSS document.

---

## 3. Slide Architecture & Viewport (16:9 Widescreen)

### 3.1 Slide Container (`.slide`)
Every slide MUST be wrapped in a container with class `.slide` (or `<section class="slide">`).
```html
<div class="slide">
  <!-- Slide content -->
</div>
```

### 3.2 Viewport CSS & Dimensions
- **Resolution**: `1920px` width x `1080px` height (1080p Full HD Widescreen).
- **CSS Rule**: Apply this exact style to `.slide`:
```css
.slide {
  width: 1920px;
  height: 1080px;
  box-sizing: border-box;
  padding: 60px 80px;
  overflow: hidden;
  page-break-after: always;
  break-after: page;
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  background: #0f172a;
  color: #f8fafc;
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
}
```

---

## 4. Design Guidelines & Slide Layout Rules

### 4.1 "1 Concept Per Slide" Rule
- Never overcrowd slides with large paragraphs.
- Use strong headlines, concise bullet points, large numbers, and multi-column visual cards.
- Aim for 3-6 slides per presentation unless specified otherwise.

### 4.2 Multi-Column Grids
Use CSS Grid to create multi-column layouts:
```css
.grid-2 {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 40px;
  align-items: center;
}

.grid-3 {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 32px;
}
```

### 4.3 Visual Cards & Callout Blocks
Enclose features, stats, or metrics in distinct background cards:
```css
.card {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  padding: 32px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
}
```

### 4.4 Slide Headers & Footers
Place topic tags at the top and slide counter badges at the bottom right:
```html
<div class="slide-header">
  <span class="category-badge">STRATEGY 2026</span>
  <h1>Market Opportunity</h1>
</div>

<div class="slide-footer">
  <span>Prism Executive Brief</span>
  <span class="slide-number">02 / 05</span>
</div>
```

---

## 5. Color Mapping & Background Rules

- **Native Color Detection**: Prism analyzes the `backgroundColor` computed style of each `.slide` element and maps it directly to native `PptxGenJS` slide backgrounds.
- **Set Explicit Backgrounds**: ALWAYS declare `background` or `background-color` on each `.slide` (e.g. `background: #0f172a;` for dark mode, or `background: #f8fafc;` for light mode).
- **Contrast**: Maintain high contrast between text and background (`#ffffff` text on `#0f172a` bg, or `#0f172a` text on `#ffffff` bg).

---

## 6. Typography Scale for 1080p Viewport

- **Main Slide Title (`h1`)**: `48px` - `64px`, `font-weight: 700`.
- **Section Title (`h2`)**: `32px` - `40px`, `font-weight: 600`.
- **Card Heading (`h3`)**: `24px` - `28px`, `font-weight: 600`.
- **Body / Bullet Text (`p`, `li`)**: `18px` - `22px`, `line-height: 1.5`.
- **Large Metric / Stat**: `72px` - `96px`, `font-weight: 800`, `color: #3b82f6`.

---

## 7. Complete Presentation HTML Boilerplate Example

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Presentation Deck</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #020617; font-family: 'Inter', system-ui, sans-serif; }
    
    .slide {
      width: 1920px; height: 1080px; padding: 60px 80px;
      overflow: hidden; page-break-after: always; break-after: page;
      position: relative; display: flex; flex-direction: column; justify-content: space-between;
      background: #0f172a; color: #f8fafc;
    }
    
    .tag { font-size: 14px; letter-spacing: 2px; color: #38bdf8; font-weight: 600; text-transform: uppercase; }
    h1 { font-size: 56px; font-weight: 700; margin-top: 8px; color: #ffffff; }
    p { font-size: 20px; color: #94a3b8; line-height: 1.6; }
    
    .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 32px; margin-top: 40px; }
    .card {
      background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 32px;
    }
    .card h3 { font-size: 24px; color: #f8fafc; margin-bottom: 12px; }
    .card p { font-size: 18px; color: #cbd5e1; }
    
    .footer { display: flex; justify-content: space-between; font-size: 14px; color: #64748b; }
  </style>
</head>
<body>

  <!-- Slide 1: Cover -->
  <div class="slide" style="background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);">
    <div>
      <span class="tag">EXECUTIVE BRIEF</span>
      <h1 style="font-size: 72px; margin-top: 20px;">Prism Platform Roadmap</h1>
      <p style="font-size: 24px; margin-top: 16px; color: #cbd5e1;">Next Generation Intelligence Architecture</p>
    </div>
    <div class="footer">
      <span>Prism AI Systems</span>
      <span>Slide 1 of 3</span>
    </div>
  </div>

  <!-- Slide 2: 3-Card Pillars -->
  <div class="slide">
    <div>
      <span class="tag">CORE PILLARS</span>
      <h1>Key Innovations</h1>
      <div class="grid-3">
        <div class="card">
          <h3>1. Dynamic Skills</h3>
          <p>Modular skill ingestion for PDF & PPTX compilation directly from internal docs.</p>
        </div>
        <div class="card">
          <h3>2. Chromium Rendering</h3>
          <p>Offscreen full 1080p capture providing pixel-perfect slide rasterization.</p>
        </div>
        <div class="card">
          <h3>3. Native Export</h3>
          <p>Direct binary output to editable PowerPoint presentations via PptxGenJS.</p>
        </div>
      </div>
    </div>
    <div class="footer">
      <span>Prism AI Systems</span>
      <span>Slide 2 of 3</span>
    </div>
  </div>

</body>
</html>
```

Now invoke `write_pptx` with your complete slide HTML!
