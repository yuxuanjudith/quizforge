/**
 * QuizForge server actions — the only code allowed to change game state.
 *
 * Trust model (see src/server/action-routes.ts): an action runs as the
 * verified caller (`userId` comes from the JWT, never from params), but its
 * `tools` bypass per-record RBAC. So every action here loads the rows it
 * touches and checks ownership / phase / time itself before writing.
 *
 * Game state machine (one `games` row):
 *
 *   lobby ──startQuestion──▶ question ──reveal──▶ reveal ──startQuestion──▶ question …
 *                                                   └──────nextOrFinish────▶ finished
 *
 * The server owns the clock: `questionEndsAt` is set here, answers are
 * timed here, and late answers are refused here. Browsers only render.
 */

import type { ActionHandler, ActionResult, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import {
  DAILY_LIMITS,
  DAY_MS,
  DEFAULT_DURATION_SEC,
  MAX_QUESTIONS,
  MIN_QUESTIONS,
  OPTION_COUNT,
  isWithinWindow,
  makeJoinCode,
  normalizeJoinCode,
  scoreAnswer,
  tallyChoices,
  validateQuestion,
  type UsageKind,
} from '../lib/quiz-logic'
import { SAMPLE_QUESTIONS, SAMPLE_TITLE } from '../lib/sample-quiz'
import { generateQuestions, generateRecap } from '../server/quiz/ai'
import { searchSources, type SourceDoc } from '../server/quiz/search'
import { speak } from '../server/quiz/speech'

type Row<T> = { recordId: string; data: T; createdBy: string }

interface Quiz {
  title: string
  mode: 'notes' | 'topic'
  questionCount: number
}
interface Question {
  quizId: string
  order: number
  prompt: string
  options: string[]
  answerIndex: number
  explanation?: string
}
interface Game {
  quizId: string
  hostId: string
  title: string
  code: string
  phase: 'lobby' | 'question' | 'reveal' | 'finished'
  questionIndex: number
  questionCount: number
  durationSec: number
  questionEndsAt?: number
}
interface Player {
  gameId: string
  userId: string
  name: string
  score: number
  correctCount: number
  streak: number
  lastPoints?: number
}
interface Response {
  userId: string
  choice: number
  correct: boolean | number
}

const fail = (error: string, code?: string): ActionResult => ({ success: false, error, code })
const ok = <T>(data: T): ActionResult => ({ success: true, data })

// ─── small record helpers ────────────────────────────────────────────────

async function getRow<T>(tools: ActionTools, collection: string, id: unknown): Promise<Row<T> | null> {
  if (typeof id !== 'string' || !id) return null
  const res = await tools.get<T & Record<string, unknown>>(collection, id)
  return res.success ? (res.data.record as unknown as Row<T>) : null
}

async function queryRows<T>(
  tools: ActionTools,
  collection: string,
  where: Record<string, unknown>,
  limit = 500,
  order?: { orderBy: string; orderDir: 'asc' | 'desc' },
): Promise<Row<T>[]> {
  const res = await tools.query<T & Record<string, unknown>>(collection, { where, limit, ...order })
  return res.success ? (res.data.records as unknown as Row<T>[]) : []
}

async function displayName(tools: ActionTools, userId: string): Promise<string> {
  const user = await getRow<{ name?: string; email?: string }>(tools, 'users', userId)
  const name = user?.data.name?.trim() || user?.data.email?.split('@')[0] || 'Player'
  return name.slice(0, 40)
}

/** Load a game and require that the caller hosts it. */
async function hostGame(
  tools: ActionTools,
  userId: string,
  gameId: unknown,
): Promise<{ game: Row<Game>; error?: undefined } | { game?: undefined; error: ActionResult }> {
  const game = await getRow<Game>(tools, 'games', gameId)
  if (!game) return { error: fail('Game not found.', 'not_found') }
  if (game.data.hostId !== userId) return { error: fail('Only the host can do that.', 'forbidden') }
  return { game }
}

async function questionAt(tools: ActionTools, quizId: string, order: number) {
  const rows = await queryRows<Question>(tools, 'questions', { quizId, order }, 1)
  return rows[0] ?? null
}

/**
 * Per-user daily cap on owner-billed integrations. Counts this user's
 * attempts in the last 24 h and records the new one BEFORE the paid call.
 * Not atomic: a burst of parallel requests can overshoot (README, Known limits).
 * Failed calls still count: the owner may have paid for them anyway.
 */
async function takeQuota(tools: ActionTools, userId: string, kind: UsageKind): Promise<ActionResult | null> {
  const since = Date.now() - DAY_MS
  // Newest first, and only as many rows as the cap: if the newest `limit`
  // attempts all fall inside the window, the user is at the cap. Without the
  // ordering, a long history could push recent rows out of the page and the
  // cap would silently stop working.
  const rows = await queryRows<{ at: number }>(tools, 'usage_events', { userId, kind }, DAILY_LIMITS[kind], {
    orderBy: 'at',
    orderDir: 'desc',
  })
  const used = rows.filter((r) => r.data.at > since).length
  if (used >= DAILY_LIMITS[kind]) {
    const what = kind === 'generate' ? 'quiz generations' : 'read-alouds'
    return fail(`Daily limit reached: ${DAILY_LIMITS[kind]} ${what} per 24 hours. Try again tomorrow.`, 'rate_limited')
  }
  const res = await tools.create('usage_events', { userId, kind, at: Date.now() })
  return res.success ? null : fail(res.error)
}

// ─── reveal (shared by the host button, the timer and the last answer) ───

/**
 * Close the current question: tally answers, reset streaks for players who
 * did not answer, and publish the correct answer. Idempotent — a second call
 * for the same question finds the phase already moved and does nothing.
 */
async function revealCurrent(tools: ActionTools, game: Row<Game>): Promise<void> {
  if (game.data.phase !== 'question') return
  const idx = game.data.questionIndex
  const question = await questionAt(tools, game.data.quizId, idx)
  if (!question) return

  const responses = await queryRows<Response>(tools, 'responses', { gameId: game.recordId, questionIndex: idx })
  const answered = new Set(responses.map((r) => r.data.userId))

  const players = await queryRows<Player>(tools, 'players', { gameId: game.recordId })
  for (const p of players) {
    if (!answered.has(p.data.userId) && (p.data.streak || p.data.lastPoints !== 0)) {
      await tools.update('players', p.recordId, { streak: 0, lastPoints: 0 })
    }
  }

  // Re-read just before writing: if the host already moved on (a late timer
  // reveal racing "Next question"), writing now would drag the room back to
  // the previous answer. Actions are not transactions, so this narrows the
  // window rather than closing it; see README "Known limits".
  const latest = await getRow<Game>(tools, 'games', game.recordId)
  if (!latest || latest.data.phase !== 'question' || latest.data.questionIndex !== idx) return

  await tools.update('games', game.recordId, {
    phase: 'reveal',
    revealedAnswer: question.data.answerIndex,
    revealedExplanation: question.data.explanation ?? '',
    answerCounts: tallyChoices(responses.map((r) => r.data.choice)),
    answeredCount: responses.length,
  })
}

// ─── actions ─────────────────────────────────────────────────────────────

/** Notes or topic → AI-generated quiz owned by the caller. */
const generateQuiz: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const notes = typeof params.notes === 'string' ? params.notes.trim().slice(0, 20_000) : ''
  const topic = typeof params.topic === 'string' ? params.topic.trim().slice(0, 200) : ''
  const count = Math.min(MAX_QUESTIONS, Math.max(MIN_QUESTIONS, Number(params.count) || 8))
  if (!notes && !topic) return fail('Paste some notes or enter a topic.', 'invalid_input')
  if (notes && notes.length < 200) return fail('Notes are too short to quiz on — add at least a paragraph.', 'invalid_input')

  const limited = await takeQuota(tools, userId, 'generate')
  if (limited) return limited

  let sources: SourceDoc[] = []
  if (!notes) {
    try {
      sources = await searchSources(tools, topic)
    } catch (error) {
      return fail(error instanceof Error ? error.message : 'Web search failed.', 'search_failed')
    }
    if (sources.length === 0) return fail('No web sources found for that topic. Try wording it differently.', 'no_sources')
  }

  let questions
  try {
    questions = await generateQuestions(tools, { notes: notes || undefined, topic: topic || undefined, sources, count })
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Generation failed.', 'generation_failed')
  }

  const title =
    (typeof params.title === 'string' && params.title.trim()) || topic || notes.split('\n')[0].slice(0, 60) || 'Untitled quiz'
  const quiz = await tools.create('quizzes', {
    title: title.slice(0, 120),
    mode: notes ? 'notes' : 'topic',
    sourcePreview: (notes || sources.map((s) => s.title).join(' · ')).slice(0, 400),
    sources: sources.map(({ title: t, url }) => ({ title: t, url })),
    questionCount: questions.length,
  })
  if (!quiz.success) return fail(quiz.error)

  for (const [order, q] of questions.entries()) {
    const res = await tools.create('questions', { quizId: quiz.data.recordId, order, ...q })
    if (!res.success) return fail(`Saving question ${order + 1} failed: ${res.error}`)
  }
  console.info(`[quiz] generated quiz=${quiz.data.recordId} owner=${userId} n=${questions.length}`)
  return ok({ quizId: quiz.data.recordId })
}

/** A ready-made quiz (no AI call) so a new host can try the game in seconds. */
const createSampleQuiz: ActionHandler<Env> = async ({ tools }) => {
  const quiz = await tools.create('quizzes', {
    title: SAMPLE_TITLE,
    mode: 'notes',
    sourcePreview: 'Built-in sample',
    sources: [],
    questionCount: SAMPLE_QUESTIONS.length,
  })
  if (!quiz.success) return fail(quiz.error)
  for (const [order, q] of SAMPLE_QUESTIONS.entries()) {
    const res = await tools.create('questions', { quizId: quiz.data.recordId, order, ...q })
    if (!res.success) return fail(res.error)
  }
  return ok({ quizId: quiz.data.recordId })
}

/** Open a lobby for a quiz the caller owns. */
const createGame: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const quiz = await getRow<Quiz>(tools, 'quizzes', params.quizId)
  if (!quiz || quiz.createdBy !== userId) return fail('Quiz not found.', 'not_found')
  const questions = await queryRows<Question>(tools, 'questions', { quizId: quiz.recordId })
  if (questions.length === 0) return fail('This quiz has no questions.', 'empty_quiz')

  const durationSec = Math.min(60, Math.max(10, Number(params.durationSec) || DEFAULT_DURATION_SEC))
  const hostName = await displayName(tools, userId)

  // uniqueOn ['code'] rejects a collision; retry a few times with a new code.
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await tools.create('games', {
      quizId: quiz.recordId,
      hostId: userId,
      hostName,
      title: quiz.data.title,
      code: makeJoinCode(),
      phase: 'lobby',
      questionIndex: -1,
      questionCount: questions.length,
      durationSec,
      answeredCount: 0,
      revealedAnswer: -1,
    })
    if (res.success) return ok({ gameId: res.data.recordId })
  }
  return fail('Could not allocate a join code. Try again.')
}

/** Join by code. The display name comes from the verified user row, not the client. */
const joinGame: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const code = normalizeJoinCode(String(params.code ?? ''))
  if (code.length !== 6) return fail('Codes are 6 characters.', 'invalid_code')
  const [game] = await queryRows<Game>(tools, 'games', { code }, 1)
  if (!game) return fail('No game with that code.', 'not_found')
  if (game.data.hostId === userId) return ok({ gameId: game.recordId, role: 'host' })
  if (game.data.phase === 'finished') return fail('That game has ended.', 'finished')

  const existing = await queryRows<Player>(tools, 'players', { gameId: game.recordId, userId }, 1)
  if (existing.length === 0) {
    const res = await tools.create('players', {
      gameId: game.recordId,
      userId,
      name: await displayName(tools, userId),
      score: 0,
      correctCount: 0,
      streak: 0,
      lastPoints: 0,
      joinedAt: Date.now(),
    })
    // A double-click races two creates; uniqueOn turns the second into a no-op.
    if (!res.success && !res.error.startsWith('Duplicate')) return fail(res.error)
  }
  return ok({ gameId: game.recordId, role: 'player' })
}

/** Host: show the next question (from the lobby or from a reveal), or finish. */
const nextQuestion: ActionHandler<Env> = async (ctx) => {
  const { userId, params, tools } = ctx
  const { game, error } = await hostGame(tools, userId, params.gameId)
  if (error) return error
  const { phase, questionIndex, questionCount } = game.data
  if (phase === 'question') return fail('Reveal the current answer first.', 'wrong_phase')
  if (phase === 'finished') return fail('The game is over.', 'wrong_phase')

  const next = questionIndex + 1
  if (next >= questionCount) return finishGame(ctx)

  const question = await questionAt(tools, game.data.quizId, next)
  if (!question) return fail(`Question ${next + 1} is missing.`)

  const res = await tools.update('games', game.recordId, {
    phase: 'question',
    questionIndex: next,
    currentPrompt: question.data.prompt,
    currentOptions: question.data.options,
    questionEndsAt: Date.now() + game.data.durationSec * 1000,
    answeredCount: 0,
    revealedAnswer: -1,
    revealedExplanation: '',
    answerCounts: [],
  })
  return res.success ? ok({ questionIndex: next, serverNow: Date.now() }) : fail(res.error)
}

/** Player: lock in an answer. Correctness, timing and points are all decided here. */
const submitAnswer: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const now = Date.now()
  const game = await getRow<Game>(tools, 'games', params.gameId)
  if (!game) return fail('Game not found.', 'not_found')
  const choice = Number(params.choice)
  if (!Number.isInteger(choice) || choice < 0 || choice >= OPTION_COUNT) return fail('Invalid choice.', 'invalid_input')
  // The client says which question it is answering, so an answer for Q3 that
  // arrives after Q4 started is rejected instead of being scored against Q4.
  if (game.data.phase !== 'question' || Number(params.questionIndex) !== game.data.questionIndex) {
    return fail('This question is closed.', 'closed')
  }
  if (!isWithinWindow(now, game.data.questionEndsAt ?? 0)) return fail("Time's up.", 'too_late')

  const [player] = await queryRows<Player>(tools, 'players', { gameId: game.recordId, userId }, 1)
  if (!player) return fail('Join the game first.', 'not_joined')

  const question = await questionAt(tools, game.data.quizId, game.data.questionIndex)
  if (!question) return fail('Question missing.')

  const durationMs = game.data.durationSec * 1000
  const msTaken = Math.max(0, now - ((game.data.questionEndsAt ?? now) - durationMs))
  const correct = choice === question.data.answerIndex
  const points = scoreAnswer({ correct, msTaken, durationMs, streakBefore: player.data.streak })

  const saved = await tools.create('responses', {
    gameId: game.recordId,
    questionIndex: game.data.questionIndex,
    userId,
    choice,
    correct,
    points,
    msTaken,
  })
  if (!saved.success) {
    return saved.error.startsWith('Duplicate') ? fail('You already answered.', 'duplicate') : fail(saved.error)
  }

  await tools.update('players', player.recordId, {
    score: player.data.score + points,
    correctCount: player.data.correctCount + (correct ? 1 : 0),
    streak: correct ? player.data.streak + 1 : 0,
    lastPoints: points,
  })

  // Everyone answered → reveal now instead of making the room wait out the timer.
  const [responses, players] = await Promise.all([
    queryRows<Response>(tools, 'responses', { gameId: game.recordId, questionIndex: game.data.questionIndex }),
    queryRows<Player>(tools, 'players', { gameId: game.recordId }),
  ])
  if (responses.length >= players.length) {
    const fresh = await getRow<Game>(tools, 'games', game.recordId)
    if (fresh) await revealCurrent(tools, fresh)
  } else {
    await tools.update('games', game.recordId, { answeredCount: responses.length })
  }

  // The player is told only that the answer was received — correctness is
  // revealed to everyone at the same moment via the games row.
  return ok({ received: true })
}

/**
 * Close the question. The host may do it any time; anyone in the game may do
 * it once the deadline has passed, so a host tab that went to sleep cannot
 * freeze the room.
 */
const revealAnswer: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const game = await getRow<Game>(tools, 'games', params.gameId)
  if (!game) return fail('Game not found.', 'not_found')
  const isHost = game.data.hostId === userId
  const expired = Date.now() > (game.data.questionEndsAt ?? 0) + 1000
  if (!isHost && !expired) return fail('Only the host can reveal early.', 'forbidden')
  if (!isHost) {
    const member = await queryRows<Player>(tools, 'players', { gameId: game.recordId, userId }, 1)
    if (member.length === 0) return fail('Join the game first.', 'not_joined')
  }
  await revealCurrent(tools, game)
  return ok({ revealed: true })
}

/** End the game and write an AI recap of what the room struggled with. */
async function finishGame({ userId, params, tools }: Parameters<ActionHandler<Env>>[0]): Promise<ActionResult> {
  const { game, error } = await hostGame(tools, userId, params.gameId)
  if (error) return error
  if (game.data.phase === 'question') await revealCurrent(tools, game)
  await tools.update('games', game.recordId, { phase: 'finished' })

  // The recap is a bonus: if the model call fails the game still ends cleanly.
  try {
    const [questions, responses] = await Promise.all([
      queryRows<Question>(tools, 'questions', { quizId: game.data.quizId }),
      queryRows<Response & { questionIndex: number }>(tools, 'responses', { gameId: game.recordId }),
    ])
    const played = questions
      .filter((q) => q.data.order <= game.data.questionIndex)
      .sort((a, b) => a.data.order - b.data.order)
    if (played.length > 0 && responses.length > 0) {
      const rows = played.map((q) => {
        const forQ = responses.filter((r) => r.data.questionIndex === q.data.order)
        const right = forQ.filter((r) => r.data.correct === true || r.data.correct === 1).length
        return {
          prompt: q.data.prompt,
          correctOption: q.data.options[q.data.answerIndex],
          correctRate: forQ.length ? right / forQ.length : 0,
          explanation: q.data.explanation ?? '',
        }
      })
      const recap = await generateRecap(tools, rows)
      await tools.update('games', game.recordId, { recap })
    }
  } catch (err) {
    console.warn(`[quiz] recap failed game=${game.recordId}: ${err instanceof Error ? err.message : err}`)
  }
  return ok({ finished: true })
}

/** Host: read the current question aloud on the projected screen. */
const speakQuestion: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const { game, error } = await hostGame(tools, userId, params.gameId)
  if (error) return error
  if (game.data.phase !== 'question') return fail('No question is showing.', 'wrong_phase')
  const g = game.data as Game & { currentPrompt?: string; currentOptions?: string[] }
  const limited = await takeQuota(tools, userId, 'speak')
  if (limited) return limited
  const letters = ['A', 'B', 'C', 'D']
  const text = `${g.currentPrompt ?? ''} ${(g.currentOptions ?? []).map((o, i) => `${letters[i]}: ${o}.`).join(' ')}`
  try {
    return ok({ audio: await speak(tools, text) })
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Speech failed.', 'speech_failed')
  }
}

/**
 * Host: edit one question. Ownership is checked here (tools bypass RBAC) and
 * the new content runs through the same `validateQuestion` as AI output, so
 * the server never stores a question the game cannot play. An edit can't
 * add a source link: only links the search returned are allowed, and the
 * existing one is kept.
 */
const updateQuestion: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const question = await getRow<Question & { sourceUrl?: string }>(tools, 'questions', params.questionId)
  if (!question || question.createdBy !== userId) return fail('Question not found.', 'not_found')

  // An edit must not change a question players are answering, or one already
  // scored: scores were computed against the old answer, and the reveal and
  // recap would show the new one. Games idle for 2 h count as abandoned, so a
  // closed host tab can't lock the quiz forever.
  const games = await queryRows<Game>(tools, 'games', { quizId: question.data.quizId })
  const staleBefore = Date.now() - 2 * 60 * 60 * 1000
  const locked = games.some(
    (g) =>
      (g.data.phase === 'question' || g.data.phase === 'reveal') &&
      (g.data.questionEndsAt ?? 0) > staleBefore &&
      question.data.order <= g.data.questionIndex,
  )
  if (locked) return fail('This question is in a live game. Edit it after the game ends.', 'in_game')

  const existingSource = question.data.sourceUrl ? [question.data.sourceUrl] : []
  const result = validateQuestion(
    {
      prompt: params.prompt,
      options: params.options,
      answerIndex: params.answerIndex,
      explanation: params.explanation ?? '',
      sourceUrl: question.data.sourceUrl,
    },
    existingSource,
  )
  if (!result.ok) return fail(result.reason, 'invalid_input')

  const { prompt, options, answerIndex, explanation } = result.question
  const res = await tools.update('questions', question.recordId, { prompt, options, answerIndex, explanation })
  return res.success ? ok({ updated: true }) : fail(res.error)
}

/** Host: delete a quiz and its questions (RBAC-off tools, so ownership is checked here). */
const deleteQuiz: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const quiz = await getRow<Quiz>(tools, 'quizzes', params.quizId)
  if (!quiz || quiz.createdBy !== userId) return fail('Quiz not found.', 'not_found')
  let deleted = 0
  do {
    const res = await tools.deleteWhere('questions', { quizId: quiz.recordId }, 100)
    deleted = res.success ? res.data.deleted : 0
  } while (deleted === 100)
  await tools.remove('quizzes', quiz.recordId)
  return ok({ deleted: true })
}

/** Server time, so browsers can correct their countdown for clock skew. */
const clock: ActionHandler<Env> = async () => ok({ now: Date.now() })

export const actions: Record<string, ActionHandler<Env>> = {
  clock,
  generateQuiz,
  createSampleQuiz,
  createGame,
  joinGame,
  nextQuestion,
  submitAnswer,
  revealAnswer,
  finishGame: (ctx) => finishGame(ctx),
  speakQuestion,
  updateQuestion,
  deleteQuiz,
}
