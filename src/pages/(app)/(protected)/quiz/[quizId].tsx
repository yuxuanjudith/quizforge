/**
 * /quiz/:quizId — the host reviews and edits AI-written questions, then
 * opens a live game.
 *
 * Edits go through the `updateQuestion` server action, which checks the
 * caller owns the question and validates the content with the same rules
 * as AI output. The check in this component is only for instant feedback;
 * the server is the one that enforces it.
 */

import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from 'deepspace'
import { ExternalLink, Pencil, Play, Trash2 } from 'lucide-react'
import { Button, ConfirmModal, Input, Textarea, buttonVariants, cn, useToast } from '@/components/ui'
import { callAction } from '../../../../lib/actions-client'
import type { QuestionRow, QuizRow } from '../../../../lib/game-types'
import { Eyebrow, OPTION_STYLES, Stage } from '../../../../components/game/GameUI'

type Q = { recordId: string; data: QuestionRow }

export default function QuizPage() {
  const { quizId = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  // `read: 'own'` already limits this to the caller's quizzes; pick ours out.
  const quizzes = useQuery<QuizRow>('quizzes')
  const { records: questions, status } = useQuery<QuestionRow>('questions', { where: { quizId }, orderBy: 'order', orderDir: 'asc' })
  const [duration, setDuration] = useState(20)
  const [starting, setStarting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const quiz = quizzes.records.find((r) => r.recordId === quizId)

  async function goLive() {
    setStarting(true)
    try {
      const { gameId } = await callAction<{ gameId: string }>('createGame', { quizId, durationSec: duration })
      navigate(`/host/${gameId}`)
    } catch (err) {
      toast.error('Could not start', err instanceof Error ? err.message : undefined)
      setStarting(false)
    }
  }

  async function remove() {
    try {
      await callAction('deleteQuiz', { quizId })
      navigate('/home')
    } catch (err) {
      toast.error('Delete failed', err instanceof Error ? err.message : undefined)
    }
  }

  if (quizzes.status === 'ready' && !quiz) {
    return (
      <Stage className="text-center">
        <p className="font-medium">Quiz not found</p>
        <p className="mt-1 text-sm text-muted-foreground">It was deleted, or it belongs to someone else.</p>
        <Link to="/home" className={cn(buttonVariants({ variant: 'outline' }), 'mt-6')}>Back home</Link>
      </Stage>
    )
  }

  return (
    <Stage className="space-y-8">
      <header className="space-y-4">
        <Eyebrow>{quiz?.data.mode === 'topic' ? 'Written from web sources' : 'Written from your notes'}</Eyebrow>
        <h1 className="font-display text-3xl">{quiz?.data.title ?? '…'}</h1>
        {quiz?.data.sources && quiz.data.sources.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {quiz.data.sources.map((s) => (
              <li key={s.url}>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex max-w-64 items-center gap-1 truncate rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <ExternalLink className="h-3 w-3 shrink-0" /> <span className="truncate">{s.title}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
          <label className="flex items-center gap-2 text-sm">
            Seconds per question
            <select
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="rounded-md border border-input bg-background px-2 py-1"
            >
              {[10, 15, 20, 30, 45, 60].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <div className="flex-1" />
          <Button variant="ghost" onClick={() => setConfirmDelete(true)} aria-label="Delete quiz">
            <Trash2 />
          </Button>
          <Button size="lg" onClick={goLive} loading={starting} disabled={questions.length === 0}>
            <Play /> Host live game
          </Button>
        </div>
      </header>

      <p className="text-sm text-muted-foreground">
        Check every answer before going live — the AI is usually right, not always. Only you can see this page.
      </p>

      {status === 'loading' ? (
        <div className="h-40 animate-pulse rounded-xl bg-muted" />
      ) : (
        <ol className="space-y-4">
          {questions.map((q, i) => (
            <QuestionCard key={q.recordId} q={q as Q} n={i + 1} />
          ))}
        </ol>
      )}

      <ConfirmModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this quiz?"
        description="The questions are deleted too. Past games keep their scores."
        confirmText="Delete"
        variant="destructive"
        onConfirm={remove}
      />
    </Stage>
  )
}

function QuestionCard({ q, n }: { q: Q; n: number }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(q.data)
  const [saving, setSaving] = useState(false)
  const toast = useToast()

  useEffect(() => {
    if (!editing) setDraft(q.data)
  }, [q.data, editing])

  // Instant feedback only — `updateQuestion` re-checks everything server-side.
  const valid =
    draft.prompt.trim().length > 0 &&
    draft.options.every((o) => o.trim().length > 0) &&
    new Set(draft.options.map((o) => o.trim().toLowerCase())).size === draft.options.length

  async function save() {
    setSaving(true)
    try {
      await callAction('updateQuestion', {
        questionId: q.recordId,
        prompt: draft.prompt,
        options: draft.options,
        answerIndex: draft.answerIndex,
        explanation: draft.explanation ?? '',
      })
      setEditing(false)
    } catch (err) {
      toast.error('Not saved', err instanceof Error ? err.message : undefined)
    } finally {
      setSaving(false)
    }
  }

  return (
    <li className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <span className="font-display text-xl text-muted-foreground tabular-nums">{n}</span>
        <div className="min-w-0 flex-1 space-y-3">
          {editing ? (
            <Textarea value={draft.prompt} onChange={(e) => setDraft({ ...draft, prompt: e.target.value.slice(0, 300) })} />
          ) : (
            <p className="text-base font-medium">{q.data.prompt}</p>
          )}
          <ul className="grid gap-2 sm:grid-cols-2">
            {draft.options.map((opt, i) => {
              const { letter, Icon } = OPTION_STYLES[i]
              const isAnswer = (editing ? draft.answerIndex : q.data.answerIndex) === i
              return (
                <li
                  key={i}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm',
                    isAnswer ? 'border-emerald-600 bg-emerald-50 text-emerald-900' : 'border-border',
                  )}
                >
                  {editing ? (
                    <>
                      <input
                        type="radio"
                        name={`answer-${q.recordId}`}
                        checked={draft.answerIndex === i}
                        onChange={() => setDraft({ ...draft, answerIndex: i })}
                        aria-label={`Mark ${letter} correct`}
                      />
                      <Input
                        value={opt}
                        onChange={(e) => {
                          const options = [...draft.options]
                          options[i] = e.target.value.slice(0, 120)
                          setDraft({ ...draft, options })
                        }}
                        className="h-8"
                      />
                    </>
                  ) : (
                    <>
                      <Icon className="h-3.5 w-3.5 shrink-0" /> <span className="font-medium">{letter}</span> {opt}
                    </>
                  )}
                </li>
              )
            })}
          </ul>
          {editing ? (
            <Textarea
              value={draft.explanation ?? ''}
              onChange={(e) => setDraft({ ...draft, explanation: e.target.value.slice(0, 400) })}
              placeholder="Why the answer is right (shown after the reveal)"
            />
          ) : (
            q.data.explanation && <p className="text-sm text-muted-foreground">{q.data.explanation}</p>
          )}
          {q.data.sourceUrl && !editing && (
            <a href={q.data.sourceUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:underline">
              <ExternalLink className="h-3 w-3" /> Source
            </a>
          )}
        </div>
        <div className="flex shrink-0 gap-1">
          {editing ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
              <Button size="sm" onClick={save} disabled={!valid} loading={saving}>Save</Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)} aria-label={`Edit question ${n}`}>
              <Pencil />
            </Button>
          )}
        </div>
      </div>
    </li>
  )
}
