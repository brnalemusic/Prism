---
name: pdf_skill.md
title: Technical Skill: Professional A4 PDF Artifact Generation
description: Complete specification, HTML/CSS rules, page break control, cover design, table splitting, and tool instructions for generating A4 PDF documents.
unlocked_tools:
  - write_pdf
  - edit_pdf
---

# Technical Skill: Professional A4 PDF Artifact Generation

## 1. Overview & Capabilities
This skill teaches you how to construct high-quality, pixel-perfect A4 PDF documents using HTML and CSS compiled via Prism's Chromium headless engine (`win.webContents.printToPDF`).

By following these rules, your generated PDFs will have precise page breaks, elegant cover pages, responsive multi-page tables, single-container Table of Contents (TOC), and flawless visual styling without horizontal cuts or overlapping text.

---

## 2. Unlocked Native Tool Schemas (JSON Definitions)

Reading this skill unlocks the native PDF generation tools. You are now authorized to invoke these tools directly:

```json
[
  {
    "type": "function",
    "function": {
      "name": "write_pdf",
      "description": "Generate a PDF artifact from HTML and CSS.",
      "parameters": {
        "type": "object",
        "properties": {
          "filename": {
            "type": "string",
            "description": "PDF filename (e.g. executive_summary.pdf)."
          },
          "html": {
            "type": "string",
            "description": "Complete A4 HTML and CSS document content."
          }
        },
        "required": ["filename", "html"]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "edit_pdf",
      "description": "Update an existing PDF artifact.",
      "parameters": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "description": "Existing six-digit artifact ID (e.g. 849201)."
          },
          "path": {
            "type": "string",
            "description": "Existing PDF path when no artifact ID is available."
          },
          "html": {
            "type": "string",
            "description": "Updated complete HTML and CSS document content."
          }
        },
        "required": ["html"]
      }
    }
  }
]
```

---

## 3. Physical A4 Layout & CSS Box Model

### 3.1 Standard Page Setup (`@page`)
Every PDF HTML document MUST start with `@page` declaration in the CSS:
```css
@page {
  size: A4;
  margin: 0;
}
```
*Note:* The `@page` rule has zero margins because all margins and padding are handled explicitly inside your HTML page containers.

### 3.2 Main Container Dimensions
- **Width**: `210mm` (Exact standard A4 width).
- **Height**: `297mm` (Exact standard A4 height per page).
- **Box Sizing**: ALWAYS set `box-sizing: border-box;` on all elements.

---

## 4. Document Structure & Page Break Controls

### 4.1 Cover Page (`.cover`)
Every formal PDF report should start with a dedicated cover page.
```html
<div class="cover">
  <div class="brand">PRISM REPORT</div>
  <h1 class="title">Document Title</h1>
  <p class="subtitle">Detailed Subtitle & Objective Description</p>
  <div class="meta">
    <span>Date: August 2026</span>
    <span>Author: Prism AI</span>
  </div>
</div>
```
```css
.cover {
  width: 210mm;
  height: 297mm;
  box-sizing: border-box;
  padding: 24mm 20mm;
  overflow: hidden;
  page-break-after: always;
  break-after: page;
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
  color: #f8fafc;
}
```

### 4.2 Inner Content Pages (`.page` or `.section`)
Inner pages contain body content, headings, graphs, and tables:
```css
.page {
  width: 210mm;
  min-height: 297mm;
  box-sizing: border-box;
  padding: 20mm 18mm;
  background: #ffffff;
  color: #0f172a;
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  line-height: 1.6;
}
```

### 4.3 Controlling Page Breaks (Crucial Rules)

1. **Forcing a Page Break (New Chapter / Section):**
   When starting a major new topic, force it to move to a fresh page:
   ```css
   .chapter-break {
     page-break-before: always;
     break-before: page;
   }
   ```

2. **Preventing Mid-Element Page Splits (`break-inside: avoid`):**
   NEVER let cards, code blocks, info callouts, or charts split awkwardly across two pages. Wrap them or apply:
   ```css
   .card, .callout, pre, blockquote, .chart-container, img {
     page-break-inside: avoid;
     break-inside: avoid;
   }
   ```

---

## 5. Multi-Page Tables & Lists Handling

### 5.1 Table Splitting & Header Repetition
Long tables must break naturally across pages without truncating rows:
```css
table {
  width: 100%;
  border-collapse: collapse;
  margin: 20px 0;
}

/* Repeat table header at the top of each new page */
thead {
  display: table-header-group;
}

tfoot {
  display: table-footer-group;
}

/* Prevent individual rows from splitting mid-text */
tr {
  page-break-inside: avoid;
  break-inside: avoid;
}

th, td {
  padding: 10px 14px;
  border-bottom: 1px solid #e2e8f0;
  text-align: left;
}
```

### 5.2 Table Fallback & Overflow Prevention
If a table or card section is too tall to fit the remaining space on a page, applying `break-inside: avoid;` to its container forces Chromium to shift the entire table cleanly to the top of the next page instead of clipping it.

---

## 6. Table of Contents (TOC) Architecture

Wrap the entire Table of Contents in a single container with `break-inside: avoid;`:
```html
<div class="toc-container">
  <h2>Table of Contents</h2>
  <ul class="toc-list">
    <li><span>1. Executive Summary</span><span class="dots"></span><span class="page-num">2</span></li>
    <li><span>2. Financial Analysis</span><span class="dots"></span><span class="page-num">4</span></li>
  </ul>
</div>
```
```css
.toc-container {
  page-break-inside: avoid;
  break-inside: avoid;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 16px 20px;
  margin-bottom: 24px;
}
```

---

## 7. Color Palette & Typography Guidelines

- **Background**: Soft clean white (`#ffffff`) for inner pages, slate/navy (`#0f172a`) for covers.
- **Primary Text**: High-contrast dark charcoal (`#0f172a` or `#1e293b`).
- **Secondary Text**: Muted slate (`#64748b`).
- **Accent Color**: Deep indigo/blue (`#2563eb`) or emerald (`#059669`).
- **Typography Hierarchy**:
  - `h1`: `28px` - `36px`, font-weight `700`, margin bottom `16px`.
  - `h2`: `20px` - `24px`, font-weight `600`, border-bottom accent line.
  - `h3`: `16px` - `18px`, font-weight `600`.
  - `p`, `li`: `14px` (`1.6` line-height).

---

## 8. Complete HTML Boilerplate Example

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Executive Report</title>
  <style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 0; background: #e2e8f0; font-family: 'Inter', system-ui, sans-serif; }
    
    .cover {
      width: 210mm; height: 297mm; padding: 24mm 20mm;
      background: #0f172a; color: #ffffff;
      display: flex; flex-direction: column; justify-content: space-between;
      page-break-after: always; break-after: page;
    }
    .page {
      width: 210mm; min-height: 297mm; padding: 20mm 18mm;
      background: #ffffff; color: #0f172a;
    }
    .card {
      background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;
      padding: 16px; margin: 16px 0;
      page-break-inside: avoid; break-inside: avoid;
    }
    .chapter-title { page-break-before: always; break-before: page; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; break-inside: avoid; }
    th, td { padding: 8px 12px; border-bottom: 1px solid #e2e8f0; }
  </style>
</head>
<body>
  <div class="cover">
    <div>
      <h1 style="font-size: 36px; margin-top: 60px;">Quarterly Report</h1>
      <p style="color: #94a3b8; font-size: 18px;">Performance & Strategic Outlook</p>
    </div>
    <div style="font-size: 14px; color: #64748b;">Prism Intelligence Systems</div>
  </div>

  <div class="page">
    <h2>1. Executive Overview</h2>
    <div class="card">
      <p>This report details financial performance and key growth indicators...</p>
    </div>
    
    <h2 class="chapter-title">2. Detailed Metrics</h2>
    <table>
      <thead>
        <tr><th>Metric</th><th>Q1</th><th>Q2</th><th>Growth</th></tr>
      </thead>
      <tbody>
        <tr><td>Revenue</td><td>$1.2M</td><td>$1.5M</td><td>+25%</td></tr>
      </tbody>
    </table>
  </div>
</body>
</html>
```

Now invoke `write_pdf` natively with your clean HTML!
