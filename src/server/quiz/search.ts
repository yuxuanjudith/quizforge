/**
 * Topic mode: ground the quiz in fresh web sources (Exa search through the
 * DeepSpace integrations proxy) instead of the model's memory, so each
 * question can cite where its answer came from.
 */

import type { ActionTools } from 'deepspace/worker'

export interface SourceDoc {
  title: string
  url: string
  text: string
}

interface ExaResult {
  title?: string
  url?: string
  text?: string
  summary?: string
  highlights?: string[]
}

const MAX_SOURCES = 5
const MAX_CHARS_PER_SOURCE = 1800

export async function searchSources(tools: ActionTools, topic: string): Promise<SourceDoc[]> {
  // Ask for page text when the endpoint supports it; if the proxy's schema
  // rejects the extra fields, fall back to the minimal documented body.
  let result = await tools.integration<{ results?: ExaResult[] }>('exa/search', {
    query: topic,
    numResults: MAX_SOURCES,
    contents: { text: { maxCharacters: MAX_CHARS_PER_SOURCE } },
  })
  if (!result.success && (result.code === 'validation_failed' || result.issues?.length)) {
    result = await tools.integration<{ results?: ExaResult[] }>('exa/search', { query: topic })
  }
  if (!result.success) throw new Error(`Web search failed: ${result.error}`)

  const body = result.data as unknown as Record<string, unknown>
  const payload = (body && 'response' in body ? body.response : body) as { results?: ExaResult[] }

  return (payload?.results ?? [])
    .filter((r): r is ExaResult & { url: string } => typeof r.url === 'string')
    .slice(0, MAX_SOURCES)
    .map((r) => ({
      title: (r.title ?? r.url).slice(0, 160),
      url: r.url,
      text: (r.text ?? r.summary ?? r.highlights?.join(' ') ?? '').slice(0, MAX_CHARS_PER_SOURCE),
    }))
}
