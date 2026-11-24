/**
 * /home — join a game by code, or manage your own quizzes.
 *
 * `useQuery('quizzes')` needs no `where: { createdBy: me }`: the schema's
 * `read: 'own'` means the record room only ever sends this user their own.
 */

import { useState, type FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { AuthOverlay, useAuthProfileReady, useQuery } from 'deepspace'
import { ArrowRight, Globe, NotebookPen, Plus } from 'lucide-react'
import { Button, Input, buttonVariants, useToast } from '@/components/ui'
import { callAction } from '../../lib/actions-client'
import { normalizeJoinCode } from '../../lib/quiz-logic'
import type { QuizRow } from '../../lib/game-types'
import { Eyebrow, Stage } from '../../components/game/GameUI'

export default function HomePage() {
  const { isSignedIn } = useAuthProfileReady({ requireUser: true })
  const [showAuth, setShowAuth] = useState(false)

  return (
    <Stage className="space-y-12">
      <JoinCard isSignedIn={isSignedIn} onNeedAuth={() => setShowAuth(true)} />
      {isSignedIn ? (
        <MyQuizzes />
      ) : (
        <p className="text-center text-sm text-muted-foreground">
          <button className="underline underline-offset-4" onClick={() => setShowAuth(true)}>
            Sign in
          </button>{' '}
          to join a game or turn your notes into one.
        </p>
      )}
      {showAuth && <AuthOverlay onClose={() => setShowAuth(false)} />}
    </Stage>
  )
}

function JoinCard({ isSignedIn, onNeedAuth }: { isSignedIn: boolean; onNeedAuth: () => void }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const toast = useToast()

  async function join(e: FormEvent) {
    e.preventDefault()
    if (!isSignedIn) return onNeedAuth()
    setBusy(true)
    try {
      const { gameId, role } = await callAction<{ gameId: string; role: 'host' | 'player' }>('joinGame', { code })
      navigate(role === 'host' ? `/host/${gameId}` : `/play/${gameId}`)
    } catch (err) {
      toast.error('Could not join', err instanceof Error ? err.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-6 sm:p-10">
      <Eyebrow>Join a live game</Eyebrow>
      <h1 className="mt-2 font-display text-3xl sm:text-4xl">Enter the code on the screen</h1>
      <form onSubmit={join} className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Input
          value={code}
          onChange={(e) => setCode(normalizeJoinCode(e.target.value))}
          placeholder="K7Q2PM"
          aria-label="Game code"
          autoCapitalize="characters"
          autoComplete="off"
          className="h-14 flex-1 text-center font-mono text-2xl tracking-[0.35em] sm:text-left"
        />
        <Button type="submit" size="lg" className="h-14" loading={busy} disabled={code.length !== 6}>
          Join <ArrowRight />
        </Button>
      </form>
    </section>
  )
}

function SampleButton() {
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const toast = useToast()
  async function make() {
    setBusy(true)
    try {
      const { quizId } = await callAction<{ quizId: string }>('createSampleQuiz')
      navigate(`/quiz/${quizId}`)
    } catch (err) {
      toast.error('Could not create the sample', err instanceof Error ? err.message : undefined)
      setBusy(false)
    }
  }
  return (
    <Button variant="outline" className="mt-5" onClick={make} loading={busy}>
      Try a sample quiz first
    </Button>
  )
}

function MyQuizzes() {
  const { records, status } = useQuery<QuizRow>('quizzes', { orderBy: 'createdAt', orderDir: 'desc' })

  return (
    <section>
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <Eyebrow>Host</Eyebrow>
          <h2 className="mt-1 font-display text-2xl">Your quizzes</h2>
        </div>
        <Link to="/create" className={buttonVariants({ variant: 'default' })}>
          <Plus /> New quiz
        </Link>
      </div>

      {status === 'loading' ? (
        <div className="h-24 animate-pulse rounded-xl bg-muted" />
      ) : records.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <p className="font-medium">Turn a lecture into a game</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Paste your notes or name a topic. QuizForge writes the questions; you review them and go live.
          </p>
          <SampleButton />
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {records.map((q) => (
            <li key={q.recordId}>
              <Link
                to={`/quiz/${q.recordId}`}
                className="block h-full rounded-xl border border-border bg-card p-4 transition-shadow hover:shadow-[var(--shadow-card-hover)]"
              >
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {q.data.mode === 'topic' ? <Globe className="h-3.5 w-3.5" /> : <NotebookPen className="h-3.5 w-3.5" />}
                  {q.data.mode === 'topic' ? 'From the web' : 'From notes'} · {q.data.questionCount} questions
                </div>
                <p className="mt-2 line-clamp-2 font-medium">{q.data.title}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
