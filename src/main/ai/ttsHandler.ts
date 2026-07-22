
export async function generateTts(text: string): Promise<string> {
  // Simple TTS fallback or mock audio payload
  const cleanText = text.replace(/<[^>]+>/g, '').trim()
  if (!cleanText) return ''
  return ''
}
