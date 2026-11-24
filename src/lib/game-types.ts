/** Row shapes as the browser reads them through useQuery. */

import type { GamePhase } from './quiz-logic'

export interface QuizRow {
  title: string
  mode: 'notes' | 'topic'
  sourcePreview?: string
  sources?: Array<{ title: string; url: string }>
  questionCount: number
}

export interface QuestionRow {
  quizId: string
  order: number
  prompt: string
  options: string[]
  answerIndex: number
  explanation?: string
  sourceUrl?: string
}

export interface GameRow {
  quizId: string
  hostId: string
  hostName?: string
  title: string
  code: string
  phase: GamePhase
  questionIndex: number
  questionCount: number
  durationSec: number
  currentPrompt?: string
  currentOptions?: string[]
  questionEndsAt?: number
  answeredCount?: number
  revealedAnswer?: number
  revealedExplanation?: string
  answerCounts?: number[]
  recap?: string
}

export interface PlayerRow {
  gameId: string
  userId: string
  name: string
  score: number
  correctCount: number
  streak: number
  lastPoints?: number
  joinedAt: number
}

export interface ResponseRow {
  gameId: string
  questionIndex: number
  userId: string
  choice: number
}
