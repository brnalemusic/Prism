import path from 'path'
import fs from 'fs/promises'
import JSZip from 'jszip'
import { PDFParse } from 'pdf-parse'

export interface DocumentExtractResult {
  type: 'pdf' | 'pptx' | 'docx'
  totalUnits: number
  unitLabel: string
  text: string
}

const EXTRACTABLE_EXTENSIONS = new Set(['.pdf', '.pptx', '.docx'])

/**
 * Checks if the given file path has an extension supported by the document extractor.
 */
export function isExtractableDocument(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  return EXTRACTABLE_EXTENSIONS.has(ext)
}

/**
 * Decodes XML entities into standard characters.
 */
function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
}

/**
 * Extracts text from a PDF buffer.
 */
export async function extractPdfText(buffer: Buffer): Promise<DocumentExtractResult> {
  const parser = new PDFParse({ data: buffer })
  try {
    const textResult = await parser.getText()
    const totalPages = textResult.pages?.length || 1

    if (textResult.pages && textResult.pages.length > 0) {
      const pageBlocks: string[] = []
      for (const page of textResult.pages) {
        const trimmed = page.text.trim()
        pageBlocks.push(`--- Page ${page.num} ---\n${trimmed || '(Empty Page)'}`)
      }
      return {
        type: 'pdf',
        totalUnits: totalPages,
        unitLabel: 'Pages',
        text: pageBlocks.join('\n\n')
      }
    }

    // Fallback if pages array is empty
    return {
      type: 'pdf',
      totalUnits: 1,
      unitLabel: 'Pages',
      text: `--- Page 1 ---\n${textResult.text?.trim() || '(Empty Document)'}`
    }
  } finally {
    try {
      await parser.destroy()
    } catch {
      // Ignore cleanup error
    }
  }
}

/**
 * Extracts structured text from a PPTX (PowerPoint) presentation buffer.
 */
export async function extractPptxText(buffer: Buffer): Promise<DocumentExtractResult> {
  const zip = await JSZip.loadAsync(buffer)
  const slideFiles: { name: string; num: number }[] = []

  // Identify all slide XML files
  zip.forEach((relativePath) => {
    const match = relativePath.match(/^ppt\/slides\/slide(\d+)\.xml$/i)
    if (match) {
      slideFiles.push({
        name: relativePath,
        num: parseInt(match[1], 10)
      })
    }
  })

  // Sort slides in natural numeric order (slide1, slide2, ..., slide10)
  slideFiles.sort((a, b) => a.num - b.num)

  if (slideFiles.length === 0) {
    return {
      type: 'pptx',
      totalUnits: 0,
      unitLabel: 'Slides',
      text: '(No slides found in presentation)'
    }
  }

  const slideBlocks: string[] = []

  for (let i = 0; i < slideFiles.length; i++) {
    const slideInfo = slideFiles[i]
    const slideIndex = i + 1
    const file = zip.file(slideInfo.name)
    if (!file) continue

    const xml = await file.async('text')
    const paragraphs = extractPptxParagraphsFromXml(xml)

    // Check for optional slide notes
    const notesFile = zip.file(`ppt/notesSlides/notesSlide${slideInfo.num}.xml`)
    let notesText = ''
    if (notesFile) {
      const notesXml = await notesFile.async('text')
      const notesParagraphs = extractPptxParagraphsFromXml(notesXml)
      if (notesParagraphs.length > 0) {
        notesText = `\n[Notes]: ${notesParagraphs.join(' ')}`
      }
    }

    const content = paragraphs.length > 0 ? paragraphs.join('\n') : '(Empty Slide)'
    slideBlocks.push(`--- Slide ${slideIndex} ---\n${content}${notesText}`)
  }

  return {
    type: 'pptx',
    totalUnits: slideFiles.length,
    unitLabel: 'Slides',
    text: slideBlocks.join('\n\n')
  }
}

/**
 * Helper to parse paragraphs and text runs from PPTX slide XML.
 */
function extractPptxParagraphsFromXml(xml: string): string[] {
  const paragraphs: string[] = []

  // Match all <a:p>...</a:p> paragraphs
  const pRegex = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/gi
  let pMatch: RegExpExecArray | null

  while ((pMatch = pRegex.exec(xml)) !== null) {
    const pContent = pMatch[1]
    const textPieces: string[] = []

    // Match all <a:t>...</a:t> text runs inside the paragraph
    const tRegex = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/gi
    let tMatch: RegExpExecArray | null

    while ((tMatch = tRegex.exec(pContent)) !== null) {
      textPieces.push(decodeXmlEntities(tMatch[1]))
    }

    const fullParagraph = textPieces.join('').trim()
    if (fullParagraph) {
      paragraphs.push(fullParagraph)
    }
  }

  return paragraphs
}

/**
 * Extracts structured text from a DOCX (Microsoft Word) document buffer.
 */
export async function extractDocxText(buffer: Buffer): Promise<DocumentExtractResult> {
  const zip = await JSZip.loadAsync(buffer)
  const docFile = zip.file('word/document.xml')

  if (!docFile) {
    return {
      type: 'docx',
      totalUnits: 0,
      unitLabel: 'Sections',
      text: '(No main document content found in docx file)'
    }
  }

  const xml = await docFile.async('text')
  const bodyText = extractDocxContentFromXml(xml)

  // Also check for footnotes / endnotes if available
  const extraNotes: string[] = []
  const footnotesFile = zip.file('word/footnotes.xml')
  if (footnotesFile) {
    const fnXml = await footnotesFile.async('text')
    const fnContent = extractDocxContentFromXml(fnXml)
    if (fnContent) extraNotes.push(`\n--- Footnotes ---\n${fnContent}`)
  }

  const endnotesFile = zip.file('word/endnotes.xml')
  if (endnotesFile) {
    const enXml = await endnotesFile.async('text')
    const enContent = extractDocxContentFromXml(enXml)
    if (enContent) extraNotes.push(`\n--- Endnotes ---\n${enContent}`)
  }

  const combined = (bodyText + extraNotes.join('')).trim() || '(Empty Document)'

  return {
    type: 'docx',
    totalUnits: 1,
    unitLabel: 'Sections',
    text: combined
  }
}

/**
 * Helper to parse paragraphs and tables from DOCX XML.
 */
function extractDocxContentFromXml(xml: string): string {
  const lines: string[] = []

  // Process elements sequentially: paragraphs (<w:p>) and tables (<w:tbl>)
  const blockRegex = /<w:(p|tbl)\b[^>]*>([\s\S]*?)<\/w:\1>/gi
  let blockMatch: RegExpExecArray | null

  while ((blockMatch = blockRegex.exec(xml)) !== null) {
    const tag = blockMatch[1]
    const content = blockMatch[2]

    if (tag === 'p') {
      // Check if it has a heading style
      const headingMatch = content.match(/<w:pStyle\s+[^>]*w:val="Heading(\d)"/i)
      const headingLevel = headingMatch ? parseInt(headingMatch[1], 10) : 0

      // Extract text runs <w:t> and line breaks <w:br/>, <w:cr/>
      const parts: string[] = []
      const textRegex = /<w:(t|br|cr)\b[^>]*>([\s\S]*?)<\/w:\1>|<w:(br|cr)\b[^>]*\/>/gi
      let tMatch: RegExpExecArray | null

      while ((tMatch = textRegex.exec(content)) !== null) {
        if (tMatch[1] === 't') {
          parts.push(decodeXmlEntities(tMatch[2]))
        } else if (tMatch[1] === 'br' || tMatch[1] === 'cr' || tMatch[3] === 'br' || tMatch[3] === 'cr') {
          parts.push('\n')
        }
      }

      const pText = parts.join('').trim()
      if (pText) {
        if (headingLevel > 0) {
          const hashes = '#'.repeat(Math.min(6, headingLevel))
          lines.push(`${hashes} ${pText}`)
        } else {
          lines.push(pText)
        }
      }
    } else if (tag === 'tbl') {
      // Extract table rows and cells
      const rowRegex = /<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/gi
      let rowMatch: RegExpExecArray | null
      const tableRows: string[] = []

      while ((rowMatch = rowRegex.exec(content)) !== null) {
        const rowContent = rowMatch[1]
        const cellRegex = /<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/gi
        let cellMatch: RegExpExecArray | null
        const cells: string[] = []

        while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
          const cellContent = cellMatch[1]
          const cellTextParts: string[] = []
          const cellTRegex = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gi
          let ctMatch: RegExpExecArray | null

          while ((ctMatch = cellTRegex.exec(cellContent)) !== null) {
            cellTextParts.push(decodeXmlEntities(ctMatch[1]))
          }
          cells.push(cellTextParts.join('').trim() || ' ')
        }

        if (cells.length > 0) {
          tableRows.push(`| ${cells.join(' | ')} |`)
        }
      }

      if (tableRows.length > 0) {
        lines.push(tableRows.join('\n'))
      }
    }
  }

  return lines.join('\n\n')
}

/**
 * Universal document text extractor that reads from a file path.
 */
export async function extractDocumentText(filePath: string): Promise<DocumentExtractResult> {
  const ext = path.extname(filePath).toLowerCase()
  const buffer = await fs.readFile(filePath)

  switch (ext) {
    case '.pdf':
      return await extractPdfText(buffer)
    case '.pptx':
      return await extractPptxText(buffer)
    case '.docx':
      return await extractDocxText(buffer)
    default:
      throw new Error(`Unsupported document extension "${ext}". Supported formats: .pdf, .pptx, .docx`)
  }
}
