/**
 * Pure game rules shared by the worker (authoritative) and the browser
 * (display only). No DeepSpace imports here, so it is unit-testable with
 * plain Vitest and safe to import from both sides.
 */

export const OPTION_COUNT = 4
export const MIN_QUESTIONS = 3
export const MAX_QUESTIONS = 12
export const DEFAULT_DURATION_SEC = 20
/** Grace window for an answer that left the browser just before the deadline. */
export const ANSWER_GRACE_MS = 750

export const BASE_POINTS = 500
export const SPEED_POINTS = 500
export const STREAK_BONUS = 100
export const MAX_STREAK_BONUS = 300

export type GamePhase = 'lobby' | 'question' | 'reveal' | 'finished'

/** A question as the AI must return it and as the host stores it. */
export interface DraftQuestion {
  prompt: string
  options: string[]
  answerIndex: number
  explanation: string
  sourceUrl?: string
}

/**
 * Points for one answer. Correct answers earn a base amount plus a speed
 * bonus that falls linearly to zero at the deadline, plus a streak bonus for
 * consecutive correct answers. Wrong or missing answers earn nothing.
 *
 * `streakBefore` is the player's streak *before* this answer.
 */
export function scoreAnswer(opts: {
  correct: boolean
  msTaken: number
  durationMs: number
  streakBefore: number
}): number {
  if (!opts.correct) return 0
  const duration = Math.max(1, opts.durationMs)
  const taken = Math.min(Math.max(0, opts.msTaken), duration)
  const speed = Math.round(SPEED_POINTS * (1 - taken / duration))
  const streak = Math.min(MAX_STREAK_BONUS, Math.max(0, opts.streakBefore) * STREAK_BONUS)
  return BASE_POINTS + speed + streak
}

/** Whether an answer arriving at `now` is still inside the question window. */
export function isWithinWindow(now: number, endsAt: number): boolean {
  return now <= endsAt + ANSWER_GRACE_MS
}

/** Count answers per option, for the reveal bar chart. */
export function tallyChoices(choices: number[], optionCount = OPTION_COUNT): number[] {
  const counts = new Array<number>(optionCount).fill(0)
  for (const c of choices) {
    if (Number.isInteger(c) && c >= 0 && c < optionCount) counts[c]++
  }
  return counts
}

/** Join codes avoid look-alike characters (0/O, 1/I/L) so they read aloud well. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function makeJoinCode(random: () => number = Math.random, length = 6): string {
  let code = ''
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)]
  }
  return code
}

export function normalizeJoinCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
}

/**
 * Validate and normalize whatever the model returned. Throws a readable error
 * on anything we cannot use; trims and de-duplicates otherwise. The model is
 * treated as untrusted input: nothing it says is stored without passing here.
 */
export function validateQuestions(raw: unknown, wanted: number): DraftQuestion[] {
  const list =
    raw && typeof raw === 'object' && 'questions' in raw
      ? (raw as { questions: unknown }).questions
      : raw
  if (!Array.isArray(list)) throw new Error('The model did not return a list of questions.')

  const out: DraftQuestion[] = []
  const seenPrompts = new Set<string>()
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const q = item as Record<string, unknown>
    const prompt = typeof q.prompt === 'string' ? q.prompt.trim() : ''
    const options = Array.isArray(q.options)
      ? q.options.map((o) => (typeof o === 'string' ? o.trim() : '')).filter(Boolean)
      : []
    const answerIndex = typeof q.answerIndex === 'number' ? q.answerIndex : Number(q.answerIndex)
    const explanation = typeof q.explanation === 'string' ? q.explanation.trim() : ''
    const sourceUrl =
      typeof q.sourceUrl === 'string' && /^https?:\/\//.test(q.sourceUrl) ? q.sourceUrl : undefined

    if (!prompt || prompt.length > 300) continue
    if (options.length !== OPTION_COUNT) continue
    if (new Set(options.map((o) => o.toLowerCase())).size !== OPTION_COUNT) continue
    if (options.some((o) => o.length > 120)) continue
    if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= OPTION_COUNT) continue
    const key = prompt.toLowerCase()
    if (seenPrompts.has(key)) continue
    seenPrompts.add(key)

    out.push({ prompt, options, answerIndex, explanation: explanation.slice(0, 400), sourceUrl })
    if (out.length >= wanted) break
  }

  if (out.length < Math.min(wanted, MIN_QUESTIONS)) {
    throw new Error(`Only ${out.length} usable questions came back; need at least ${Math.min(wanted, MIN_QUESTIONS)}.`)
  }
  return out
}

/** Pull the first JSON object out of a model reply that may wrap it in prose or fences. */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : text
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('No JSON object in the model reply.')
  return JSON.parse(body.slice(start, end + 1))
}

/** Rank players: score desc, then more correct answers, then earlier join. */
export function rankPlayers<T extends { score: number; correctCount: number; joinedAt: number }>(
  players: T[],
): T[] {
  return [...players].sort(
    (a, b) => b.score - a.score || b.correctCount - a.correctCount || a.joinedAt - b.joinedAt,
  )
}
