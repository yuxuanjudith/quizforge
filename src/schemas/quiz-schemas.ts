/**
 * QuizForge collections and their RBAC.
 *
 * The security model in one paragraph: browsers never write game state.
 * Every write that affects scoring (starting a question, answering,
 * revealing) goes through a server action in src/actions, which checks the
 * caller, the phase and the clock itself. The schemas below make that
 * enforceable rather than a convention: game, player and response rows are
 * `create: false / update: false` for every non-admin role, so a client that
 * skips the UI and writes over the WebSocket is refused by the record room.
 *
 * The correct answer lives only in `questions`, which is readable by its
 * owner (the host) alone. Players learn the answer from the `games` row,
 * and only after the server has moved that game to `reveal`.
 */

import type { CollectionSchema } from 'deepspace/schema'

const ACTIONS_ONLY = { create: false, update: false, delete: false } as const

/** A quiz the host generated and can edit. */
export const quizzesSchema: CollectionSchema = {
  name: 'quizzes',
  columns: [
    { name: 'title', storage: 'text', interpretation: 'plain', required: true, maxLength: 120 },
    { name: 'mode', storage: 'text', interpretation: { kind: 'select', options: ['notes', 'topic'] } },
    { name: 'sourcePreview', storage: 'text', interpretation: 'plain', maxLength: 400 },
    { name: 'sources', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'questionCount', storage: 'number', interpretation: 'plain' },
  ],
  permissions: {
    viewer: { read: 'own', create: false, update: false, delete: false },
    member: { read: 'own', create: false, update: 'own', delete: 'own', writableFields: ['title'] },
    admin: { read: true, create: true, update: true, delete: true },
  },
}

/**
 * Questions, including the answer key. Owner-only reads: a player (or a
 * player's AI agent calling records.query) gets zero rows back.
 *
 * Owners cannot write here directly either. RBAC can limit WHICH fields a
 * role may write, but not WHAT values: a direct put could store
 * answerIndex 7 or three options and break the game. Edits go through the
 * `updateQuestion` action, which runs the same validator as AI output.
 */
export const questionsSchema: CollectionSchema = {
  name: 'questions',
  columns: [
    { name: 'quizId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'order', storage: 'number', interpretation: 'plain', required: true },
    { name: 'prompt', storage: 'text', interpretation: 'plain', required: true, maxLength: 300 },
    { name: 'options', storage: 'text', interpretation: { kind: 'json' }, required: true },
    { name: 'answerIndex', storage: 'number', interpretation: 'plain', required: true },
    { name: 'explanation', storage: 'text', interpretation: 'plain', maxLength: 400 },
    { name: 'sourceUrl', storage: 'text', interpretation: { kind: 'url' } },
  ],
  permissions: {
    viewer: { read: false, ...ACTIONS_ONLY },
    member: { read: 'own', ...ACTIONS_ONLY },
    admin: { read: true, create: true, update: true, delete: true },
  },
}

/**
 * One live session of a quiz. Readable by every signed-in user so a join
 * code can be looked up and the live state streams to every screen.
 * Holds no secret until `phase === 'reveal'`.
 */
export const gamesSchema: CollectionSchema = {
  name: 'games',
  columns: [
    { name: 'quizId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'hostId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'hostName', storage: 'text', interpretation: 'plain' },
    { name: 'title', storage: 'text', interpretation: 'plain' },
    { name: 'code', storage: 'text', interpretation: 'plain', required: true },
    { name: 'phase', storage: 'text', interpretation: { kind: 'select', options: ['lobby', 'question', 'reveal', 'finished'] } },
    { name: 'questionIndex', storage: 'number', interpretation: 'plain' },
    { name: 'questionCount', storage: 'number', interpretation: 'plain' },
    { name: 'durationSec', storage: 'number', interpretation: 'plain' },
    { name: 'currentPrompt', storage: 'text', interpretation: 'plain' },
    { name: 'currentOptions', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'questionEndsAt', storage: 'number', interpretation: 'plain' },
    { name: 'answeredCount', storage: 'number', interpretation: 'plain' },
    { name: 'revealedAnswer', storage: 'number', interpretation: 'plain' },
    { name: 'revealedExplanation', storage: 'text', interpretation: 'plain' },
    { name: 'answerCounts', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'recap', storage: 'text', interpretation: 'plain' },
  ],
  uniqueOn: ['code'],
  permissions: {
    viewer: { read: true, ...ACTIONS_ONLY },
    member: { read: true, ...ACTIONS_ONLY },
    admin: { read: true, create: true, update: true, delete: true },
  },
}

/** A player in a game, with the running score. Public within the app. */
export const playersSchema: CollectionSchema = {
  name: 'players',
  columns: [
    { name: 'gameId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'userId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'name', storage: 'text', interpretation: 'plain', maxLength: 40 },
    { name: 'score', storage: 'number', interpretation: 'plain' },
    { name: 'correctCount', storage: 'number', interpretation: 'plain' },
    { name: 'streak', storage: 'number', interpretation: 'plain' },
    { name: 'lastPoints', storage: 'number', interpretation: 'plain' },
    { name: 'joinedAt', storage: 'number', interpretation: 'plain' },
  ],
  uniqueOn: ['gameId', 'userId'],
  permissions: {
    viewer: { read: true, ...ACTIONS_ONLY },
    member: { read: true, ...ACTIONS_ONLY },
    admin: { read: true, create: true, update: true, delete: true },
  },
}

/**
 * One answer. `uniqueOn` makes "one answer per player per question" a
 * database guarantee, not just a disabled button. Players can read their
 * own rows only, so nobody sees what others picked before the reveal.
 */
export const responsesSchema: CollectionSchema = {
  name: 'responses',
  columns: [
    { name: 'gameId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'questionIndex', storage: 'number', interpretation: 'plain', required: true },
    { name: 'userId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'choice', storage: 'number', interpretation: 'plain' },
    { name: 'correct', storage: 'number', interpretation: { kind: 'boolean' } },
    { name: 'points', storage: 'number', interpretation: 'plain' },
    { name: 'msTaken', storage: 'number', interpretation: 'plain' },
  ],
  uniqueOn: ['gameId', 'questionIndex', 'userId'],
  permissions: {
    viewer: { read: false, ...ACTIONS_ONLY },
    member: { read: 'own', ...ACTIONS_ONLY },
    admin: { read: true, create: true, update: true, delete: true },
  },
}

/**
 * One row per owner-billed call attempt (AI generation, read-aloud). Actions
 * count a user's rows in the last 24 h before calling a paid integration, so
 * one account cannot drain the owner's credits. Written by actions only;
 * users can read their own rows (to show "3 of 10 left" later).
 */
export const usageSchema: CollectionSchema = {
  name: 'usage_events',
  columns: [
    { name: 'userId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'kind', storage: 'text', interpretation: { kind: 'select', options: ['generate', 'speak'] } },
    { name: 'at', storage: 'number', interpretation: 'plain', required: true },
  ],
  permissions: {
    viewer: { read: false, ...ACTIONS_ONLY },
    member: { read: 'own', ...ACTIONS_ONLY },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
