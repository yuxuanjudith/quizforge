/**
 * /host/:gameId — the projected screen.
 *
 * Reads the live game through useGame (records + realtime). Every button
 * calls a server action; the screen re-renders when the action's write
 * arrives over the socket, so the host sees exactly what players see.
 *
 * Presence: `usePresenceRoom('game:<id>')` shows which joined players still
 * have the game open, so the host can wait for a dropped phone to rejoin.
 */

import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useUser, usePresenceRoom } from 'deepspace'
import { ArrowRight, Eye, Flag, Users, Volume2 } from 'lucide-react'
import { Button, buttonVariants, cn, useToast } from '@/components/ui'
import { callAction } from '../../../../lib/actions-client'
import { AnswerBars, Countdown, Eyebrow, Leaderboard, OptionTile, Stage } from '../../../../components/game/GameUI'
import { useGame } from '../../../../components/game/useGame'
import { useRemainingMs, useServerOffset } from '../../../../components/game/useServerClock'

export default function HostPage() {
  const { gameId = '' } = useParams()
  const { user } = useUser()
  const { game, players, notFound } = useGame(gameId)
  const { peers } = usePresenceRoom(`game:${gameId}`)
  const offset = useServerOffset()
  const remaining = useRemainingMs(game?.phase === 'question' ? game.questionEndsAt : undefined, offset)
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)

  async function run(action: string) {
    setBusy(action)
    try {
      await callAction(action, { gameId })
    } catch (err) {
      toast.error('Something went wrong', err instanceof Error ? err.message : undefined)
    } finally {
      setBusy(null)
    }
  }

  // When the clock runs out, the host screen asks the server to reveal. The
  // server re-checks the time, and players' screens can do the same if the
  // host tab is asleep — whichever arrives first wins, the rest are no-ops.
  const revealSent = useRef<number | null>(null)
  useEffect(() => {
    if (game?.phase !== 'question' || remaining > 0) return
    if (revealSent.current === game.questionIndex) return
    revealSent.current = game.questionIndex
    void callAction('revealAnswer', { gameId }).catch(() => {})
  }, [game?.phase, game?.questionIndex, remaining, gameId])

  if (notFound) {
    return (
      <Stage className="text-center">
        <p className="font-medium">Game not found</p>
        <Link to="/home" className={cn(buttonVariants({ variant: 'outline' }), 'mt-6')}>Back home</Link>
      </Stage>
    )
  }
  if (!game) return <Stage><div className="h-64 animate-pulse rounded-2xl bg-muted" /></Stage>
  if (user && game.hostId !== user.id) {
    return (
      <Stage className="text-center">
        <p className="font-medium">This is the host screen.</p>
        <Link to={`/play/${gameId}`} className={cn(buttonVariants(), 'mt-6')}>Go to the player view</Link>
      </Stage>
    )
  }

  const online = new Set(peers.map((p) => p.userId))
  const isLast = game.questionIndex + 1 >= game.questionCount

  return (
    <Stage className="max-w-5xl space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Eyebrow>{game.phase === 'lobby' ? 'Waiting room' : game.phase === 'finished' ? 'Final results' : `Question ${game.questionIndex + 1} of ${game.questionCount}`}</Eyebrow>
          <h1 className="font-display text-2xl">{game.title}</h1>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Users className="h-4 w-4" /> {players.length} joined
        </div>
      </header>

      {game.phase === 'lobby' && (
        <section className="grid gap-8 lg:grid-cols-[1.2fr_1fr]">
          <div className="rounded-2xl bg-ink p-8 text-center text-background">
            <p className="text-sm uppercase tracking-[0.2em] opacity-70">Go to {window.location.host} and enter</p>
            <p className="mt-4 font-mono text-6xl tracking-[0.3em] sm:text-7xl" aria-label={`Join code ${game.code.split('').join(' ')}`}>
              {game.code}
            </p>
          </div>
          <div className="space-y-4">
            <ul className="flex flex-wrap gap-2" aria-live="polite">
              {players.length === 0 && <li className="text-sm text-muted-foreground">Players appear here as they join.</li>}
              {players.map((p) => (
                <li key={p.userId} className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-sm">
                  <span className={cn('h-2 w-2 rounded-full', online.has(p.userId) ? 'bg-emerald-500' : 'bg-muted-foreground/40')} />
                  {p.name}
                </li>
              ))}
            </ul>
            <Button size="lg" className="w-full" onClick={() => run('nextQuestion')} loading={busy === 'nextQuestion'} disabled={players.length === 0}>
              Start <ArrowRight />
            </Button>
          </div>
        </section>
      )}

      {(game.phase === 'question' || game.phase === 'reveal') && (
        <section className="space-y-6">
          <p className="font-display text-3xl leading-tight sm:text-4xl">{game.currentPrompt}</p>
          {game.phase === 'question' && <Countdown remainingMs={remaining} totalMs={game.durationSec * 1000} />}
          <div className="grid gap-3 sm:grid-cols-2">
            {(game.currentOptions ?? []).map((opt, i) => (
              <OptionTile
                key={i}
                index={i}
                text={opt}
                disabled
                state={game.phase === 'reveal' ? (i === game.revealedAnswer ? 'correct' : 'dim') : 'idle'}
              />
            ))}
          </div>

          {game.phase === 'question' ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-muted-foreground" aria-live="polite">
                {game.answeredCount ?? 0} / {players.length} answered
              </span>
              <div className="flex-1" />
              <ReadAloud gameId={gameId} questionIndex={game.questionIndex} />
              <Button variant="outline" onClick={() => run('revealAnswer')} loading={busy === 'revealAnswer'}>
                <Eye /> Reveal now
              </Button>
            </div>
          ) : (
            <div className="grid gap-8 lg:grid-cols-2">
              <div className="space-y-4">
                <AnswerBars counts={game.answerCounts ?? []} correct={game.revealedAnswer ?? -1} options={game.currentOptions ?? []} />
                {game.revealedExplanation && <p className="rounded-xl bg-card p-4 text-base">{game.revealedExplanation}</p>}
              </div>
              <div className="space-y-4">
                <Leaderboard players={players} limit={5} showDelta />
                <Button size="lg" className="w-full" onClick={() => run('nextQuestion')} loading={busy === 'nextQuestion'}>
                  {isLast ? (<><Flag /> Final results</>) : (<>Next question <ArrowRight /></>)}
                </Button>
              </div>
            </div>
          )}
        </section>
      )}

      {game.phase === 'finished' && (
        <section className="grid gap-8 lg:grid-cols-2">
          <Leaderboard players={players} limit={20} />
          <div className="rounded-2xl border border-border bg-card p-6">
            <Eyebrow>What the room struggled with</Eyebrow>
            {game.recap ? (
              <p className="mt-3 whitespace-pre-line leading-relaxed">{game.recap}</p>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">Writing the recap…</p>
            )}
          </div>
        </section>
      )}
    </Stage>
  )
}

/** Fetch speech for the current question and play it on the projector. */
function ReadAloud({ gameId, questionIndex }: { gameId: string; questionIndex: number }) {
  const [loading, setLoading] = useState(false)
  const toast = useToast()
  const cache = useRef(new Map<number, string>())

  async function play() {
    setLoading(true)
    try {
      let src = cache.current.get(questionIndex)
      if (!src) {
        src = (await callAction<{ audio: string }>('speakQuestion', { gameId })).audio
        cache.current.set(questionIndex, src)
      }
      await new Audio(src).play()
    } catch (err) {
      toast.error('Could not read aloud', err instanceof Error ? err.message : undefined)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button variant="ghost" onClick={play} loading={loading} aria-label="Read the question aloud">
      <Volume2 /> Read aloud
    </Button>
  )
}
