/**
 * Model calls for QuizForge, all through the DeepSpace integrations proxy
 * (`tools.integration`). No provider key exists in this app: the platform
 * bills the app owner ('developer' billing in src/integrations.ts) and the
 * key never reaches the worker or the browser.
 */

import type { ActionTools } from 'deepspace/worker'
import { extractJson, validateQuestions, type DraftQuestion } from '../../lib/quiz-logic'
import type { SourceDoc } from './search'

export const QUIZ_MODEL = 'claude-sonnet-5-5'
export const RECAP_MODEL = 'claude-haiku-5-5'

interface AnthropicMessage {
  content?: Array<{ type: string; text?: string }>
}

/** Call the Anthropic messages endpoint and return the first text block. */
async function complete(
  tools: ActionTools,
  model: string,
  system: string,
  user: string,
  maxTokens: number,
): Promise<string> {
  const result = await tools.integration<AnthropicMessage>('anthropic/chat-completion', {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  })
  if (!result.success) throw new Error(`AI request failed: ${result.error}`)
  // Older proxy versions wrapped the body in `{ response }`; accept both.
  const body = result.data as unknown as Record<string, unknown>
  const message = (body && 'response' in body ? body.response : body) as AnthropicMessage
  const text = message?.content?.find((block) => block.type === 'text')?.text ?? ''
  if (!text) throw new Error('AI returned an empty reply.')
  return text
}

const QUIZ_SYSTEM = [
  'You write multiple-choice quiz questions for a live classroom game.',
  'Rules:',
  '- Every question has exactly 4 options and exactly one correct option.',
  '- Wrong options must be plausible to someone who skimmed the material, never jokes.',
  '- Test understanding, not trivia about formatting or page numbers.',
  '- Prompts under 200 characters; options under 80 characters.',
  '- Vary the position of the correct answer.',
  '- Use only facts supported by the provided material. If the material is thin, write fewer questions rather than inventing facts.',
  '- Write in the same language as the material.',
  'Reply with JSON only, no prose, in this shape:',
  '{"questions":[{"prompt":"...","options":["a","b","c","d"],"answerIndex":0,"explanation":"one sentence on why","sourceUrl":"https://... or omit"}]}',
].join('\n')

export async function generateQuestions(
  tools: ActionTools,
  input: { notes?: string; topic?: string; sources?: SourceDoc[]; count: number },
): Promise<DraftQuestion[]> {
  const parts: string[] = [`Write ${input.count} questions.`]
  if (input.topic) parts.push(`Topic: ${input.topic}`)
  if (input.notes) parts.push(`Material:\n"""\n${input.notes}\n"""`)
  if (input.sources?.length) {
    parts.push(
      'Material from web sources. Set sourceUrl on each question to the URL it is based on:',
      ...input.sources.map((s, i) => `[${i + 1}] ${s.title}\nURL: ${s.url}\n${s.text}`),
    )
  }

  // One retry: a malformed reply is common enough to be worth a second try,
  // rare enough that a third would only hide a real problem.
  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await complete(tools, QUIZ_MODEL, QUIZ_SYSTEM, parts.join('\n\n'), 4000)
      return validateQuestions(extractJson(text), input.count)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Could not generate questions.')
}

/** After the game: which ideas did the room struggle with, and what to review. */
export async function generateRecap(
  tools: ActionTools,
  rows: Array<{ prompt: string; correctOption: string; correctRate: number; explanation: string }>,
): Promise<string> {
  const table = rows
    .map(
      (r, i) =>
        `Q${i + 1} (${Math.round(r.correctRate * 100)}% correct): ${r.prompt}\nCorrect answer: ${r.correctOption}\nWhy: ${r.explanation}`,
    )
    .join('\n\n')
  const system = [
    'You help a teacher debrief a quiz they just ran.',
    'Given each question and the share of the room that got it right, write a short recap:',
    '- One sentence on overall performance.',
    '- The 2-3 weakest ideas, each as a bullet: the misconception in plain words and one line to re-teach it.',
    'Plain text with "- " bullets, under 120 words. No headings, no scores repeated back verbatim.',
    'Write in the same language as the questions.',
  ].join('\n')
  return (await complete(tools, RECAP_MODEL, system, table, 600)).trim()
}
