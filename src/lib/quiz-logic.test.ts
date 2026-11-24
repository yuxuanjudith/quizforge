import { describe, expect, it } from 'vitest'
import {
  ANSWER_GRACE_MS,
  BASE_POINTS,
  MAX_STREAK_BONUS,
  SPEED_POINTS,
  extractJson,
  isWithinWindow,
  makeJoinCode,
  normalizeJoinCode,
  rankPlayers,
  scoreAnswer,
  tallyChoices,
  validateQuestion,
  validateQuestions,
} from './quiz-logic'

describe('scoreAnswer', () => {
  const base = { durationMs: 20_000, streakBefore: 0 }

  it('gives nothing for a wrong answer, however fast', () => {
    expect(scoreAnswer({ ...base, correct: false, msTaken: 0 })).toBe(0)
  })

  it('gives full speed bonus for an instant correct answer', () => {
    expect(scoreAnswer({ ...base, correct: true, msTaken: 0 })).toBe(BASE_POINTS + SPEED_POINTS)
  })

  it('gives half the speed bonus at the halfway mark', () => {
    expect(scoreAnswer({ ...base, correct: true, msTaken: 10_000 })).toBe(BASE_POINTS + SPEED_POINTS / 2)
  })

  it('never goes below the base for a correct answer inside the grace window', () => {
    expect(scoreAnswer({ ...base, correct: true, msTaken: 20_500 })).toBe(BASE_POINTS)
  })

  it('caps the streak bonus', () => {
    const long = scoreAnswer({ ...base, correct: true, msTaken: 20_000, streakBefore: 50 })
    expect(long).toBe(BASE_POINTS + MAX_STREAK_BONUS)
  })
})

describe('isWithinWindow', () => {
  it('accepts answers up to the grace window after the deadline', () => {
    expect(isWithinWindow(1000 + ANSWER_GRACE_MS, 1000)).toBe(true)
    expect(isWithinWindow(1001 + ANSWER_GRACE_MS, 1000)).toBe(false)
  })
})

describe('tallyChoices', () => {
  it('counts valid choices and ignores junk', () => {
    expect(tallyChoices([0, 0, 3, 7, -1, 1.5, 2])).toEqual([2, 0, 1, 1])
  })
})

describe('join codes', () => {
  it('are 6 characters without look-alikes', () => {
    for (let i = 0; i < 200; i++) {
      const code = makeJoinCode()
      expect(code).toMatch(/^[A-HJ-KM-NP-Z2-9]{6}$/)
    }
  })

  it('normalize user input', () => {
    expect(normalizeJoinCode(' k7q-2pm ')).toBe('K7Q2PM')
  })
})

describe('validateQuestions', () => {
  const good = (prompt: string, answerIndex = 1) => ({
    prompt,
    options: ['alpha', 'beta', 'gamma', 'delta'],
    answerIndex,
    explanation: 'because',
  })

  it('keeps well-formed questions', () => {
    const out = validateQuestions({ questions: [good('Q1'), good('Q2'), good('Q3')] }, 3)
    expect(out).toHaveLength(3)
    expect(out[0].answerIndex).toBe(1)
  })

  it('drops malformed ones: wrong option count, bad index, duplicate options, duplicate prompts', () => {
    const out = validateQuestions(
      [
        good('Q1'),
        { ...good('Q2'), options: ['a', 'b', 'c'] },
        { ...good('Q3'), answerIndex: 4 },
        { ...good('Q4'), options: ['a', 'A', 'b', 'c'] },
        good('q1'),
        good('Q5'),
        good('Q6'),
      ],
      10,
    )
    expect(out.map((q) => q.prompt)).toEqual(['Q1', 'Q5', 'Q6'])
  })

  it('refuses when too few usable questions remain', () => {
    expect(() => validateQuestions([good('only one')], 5)).toThrow()
  })

  it('keeps a source link only if the search actually returned it', () => {
    const fetched = ['https://science.nasa.gov/webb']
    const out = validateQuestions(
      [
        { ...good('Q1'), sourceUrl: 'https://science.nasa.gov/webb' },
        { ...good('Q2'), sourceUrl: 'https://made-up.example.com/page' },
        { ...good('Q3'), sourceUrl: 'javascript:alert(1)' },
      ],
      3,
      fetched,
    )
    expect(out[0].sourceUrl).toBe('https://science.nasa.gov/webb')
    expect(out[1].sourceUrl).toBeUndefined()
    expect(out[2].sourceUrl).toBeUndefined()
  })

  it('drops every link in notes mode (no search, nothing to cite)', () => {
    const [q] = validateQuestions([{ ...good('Q1'), sourceUrl: 'https://x.example' }, good('Q2'), good('Q3')], 3)
    expect(q.sourceUrl).toBeUndefined()
  })
})

describe('validateQuestion (host edits use the same rules)', () => {
  const base = { prompt: 'Q', options: ['a', 'b', 'c', 'd'], answerIndex: 0, explanation: '' }

  it('accepts a valid edit', () => {
    expect(validateQuestion(base).ok).toBe(true)
  })

  it('rejects an answer index outside the options', () => {
    expect(validateQuestion({ ...base, answerIndex: 7 }).ok).toBe(false)
    expect(validateQuestion({ ...base, answerIndex: -1 }).ok).toBe(false)
    expect(validateQuestion({ ...base, answerIndex: 1.5 }).ok).toBe(false)
  })

  it('rejects the wrong number of options, blanks and duplicates', () => {
    expect(validateQuestion({ ...base, options: ['a', 'b', 'c'] }).ok).toBe(false)
    expect(validateQuestion({ ...base, options: ['a', 'b', 'c', 'd', 'e'] }).ok).toBe(false)
    expect(validateQuestion({ ...base, options: ['a', 'b', 'c', '  '] }).ok).toBe(false)
    expect(validateQuestion({ ...base, options: ['a', 'B', 'b', 'c'] }).ok).toBe(false)
  })

  it('rejects an empty prompt and over-long text', () => {
    expect(validateQuestion({ ...base, prompt: '   ' }).ok).toBe(false)
    expect(validateQuestion({ ...base, prompt: 'x'.repeat(301) }).ok).toBe(false)
    expect(validateQuestion({ ...base, explanation: 'x'.repeat(401) }).ok).toBe(false)
  })
})

describe('extractJson', () => {
  it('reads JSON wrapped in a code fence and prose', () => {
    expect(extractJson('Sure!\n```json\n{"questions":[]}\n```\nEnjoy')).toEqual({ questions: [] })
  })
})

describe('rankPlayers', () => {
  it('orders by score, then correct count, then who joined first', () => {
    const ranked = rankPlayers([
      { id: 'late', score: 900, correctCount: 2, joinedAt: 2 },
      { id: 'early', score: 900, correctCount: 2, joinedAt: 1 },
      { id: 'top', score: 1200, correctCount: 2, joinedAt: 3 },
      { id: 'accurate', score: 900, correctCount: 3, joinedAt: 4 },
    ])
    expect(ranked.map((p) => p.id)).toEqual(['top', 'accurate', 'early', 'late'])
  })
})
