/**
 * /play/:gameId — a player's phone.
 *
 * What a player can see is decided by RBAC, not by this component:
 *  - the `games` row (prompt + options; the answer only after reveal),
 *  - every player's public score,
 *  - their OWN `responses` rows only (read: 'own').
 * So "my answer for this question" comes from the server, and survives a
 * refresh, without exposing anyone else's pick.
 */

import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useUser, usePresenceRoom } from 'deepspace'
import { Check, Hourglass, X } from 'lucide-react'
import { buttonVariants, cn, useToast } from '@/components/ui'
import { callAction } from '../../../../lib/actions-client'
import { rankPlayers } from '../../../../lib/quiz-logic'
import type { ResponseRow } from '../../../../lib/game-types'
import { Countdown, Eyebrow, Leaderboard, OptionTile, Stage } from '../../../../components/game/GameUI'
import { useGame } from '../../../../components/game/useGame'
import { useRemainingMs, useServerOffset } from '../../../../components/game/useServerClock'

export default function PlayPage() {
  const { gameId = '' } = useParams()
  const navigate = useNavigate()
  const { user } = useUser()
  const toast = useToast()
  const { game, players, notFound } = useGame(gameId)
  usePresenceRoom(`game:${gameId}`)
  const offset = useServerOffset()
  const remaining = useRemainingMs(game?.phase === 'question' ? game.questionEndsAt : undefined, offset)

  const myResponses = useQuery<ResponseRow>('responses', { where: { gameId } })
  const serverAnswer = myResponses.records.find((r) => r.data.questionIndex === game?.questionIndex)?.data.choice
  // Optimistic pick so the tile locks the instant it is tapped; the server row replaces it.
  const [pending, setPending] = useState<{ q: number; choice: number } | null>(null)
  const myChoice = serverAnswer ?? (pending && pending.q === game?.questionIndex ? pending.choice : undefined)

  const me = players.find((p) => p.userId === user?.id)

  // The host owns the game but cannot play it.
  useEffect(() => {
    if (game && user && game.hostId === user.id) navigate(`/host/${gameId}`, { replace: true })
  }, [game, user, gameId, navigate])

  // Backstop for a sleeping host tab: once time is up, any player may ask the
  // server to reveal (the server checks the deadline itself).
  const revealSent = useRef<number | null>(null)
  useEffect(() => {
    if (game?.phase !== 'question' || remaining > 0 || revealSent.current === game.questionIndex) return
    const q = game.questionIndex
    const t = setTimeout(() => {
      revealSent.current = q
      void callAction('revealAnswer', { gameId }).catch(() => {})
    }, 2500)
    return () => clearTimeout(t)
  }, [game?.phase, game?.questionIndex, remaining, gameId])

  async function answer(choice: number) {
    if (!game || myChoice !== undefined) return
    setPending({ q: game.questionIndex, choice })
    try {
      await callAction('submitAnswer', { gameId, questionIndex: game.questionIndex, choice })
    } catch (err) {
      setPending(null)
      toast.error('Answer not counted', err instanceof Error ? err.message : undefined)
    }
  }

  if (notFound) {
    return (
      <Stage className="text-center">
        <p className="font-medium">Game not found</p>
        <Link to="/home" className={cn(buttonVariants({ variant: 'outline' }), 'mt-6')}>Back home</Link>
      </Stage>
    )
  }
  if (!game) return <Stage><div className="h-64 animate-pulse rounded-2xl bg-muted" /></Stage>

  if (!me && game.phase !== 'finished') {
    return (
      <Stage className="text-center">
        <p className="font-medium">You're not in this game yet.</p>
        <Link to="/home" className={cn(buttonVariants(), 'mt-6')}>Enter the code</Link>
      </Stage>
    )
  }

  const rank = me ? rankPlayers(players).findIndex((p) => p.userId === me.userId) + 1 : 0

  return (
    <Stage className="max-w-xl space-y-6">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Eyebrow>
            {game.phase === 'lobby' ? 'Waiting room' : game.phase === 'finished' ? 'Game over' : `Question ${game.questionIndex + 1} / ${game.questionCount}`}
          </Eyebrow>
          <p className="truncate font-medium">{game.title}</p>
        </div>
        {me && (
          <div className="text-right">
            <p className="font-display text-2xl tabular-nums">{me.score}</p>
            <p className="text-xs text-muted-foreground">{rank > 0 ? `#${rank} of ${players.length}` : ''}</p>
          </div>
        )}
      </header>

      {game.phase === 'lobby' && (
        <div className="rounded-2xl border border-border bg-card p-8 text-center">
          <Hourglass className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 font-display text-2xl">You're in, {me?.name}.</p>
          <p className="mt-1 text-muted-foreground">Watch the main screen — the host will start soon.</p>
        </div>
      )}

      {game.phase === 'question' && (
        <section className="space-y-5">
          <p className="font-display text-2xl leading-snug">{game.currentPrompt}</p>
          <Countdown remainingMs={remaining} totalMs={game.durationSec * 1000} />
          <div className="grid gap-3">
            {(game.currentOptions ?? []).map((opt, i) => (
              <OptionTile
                key={i}
                index={i}
                text={opt}
                onClick={() => answer(i)}
                disabled={myChoice !== undefined || remaining <= 0}
                state={myChoice === undefined ? 'idle' : myChoice === i ? 'picked' : 'dim'}
              />
            ))}
          </div>
          <p className="text-center text-sm text-muted-foreground" aria-live="polite">
            {myChoice !== undefined ? 'Locked in. Waiting for the reveal…' : remaining <= 0 ? "Time's up." : 'Tap your answer.'}
          </p>
        </section>
      )}

      {game.phase === 'reveal' && (
        <section className="space-y-5">
          <RevealBanner correct={myChoice !== undefined && myChoice === game.revealedAnswer} answered={myChoice !== undefined} points={me?.lastPoints ?? 0} streak={me?.streak ?? 0} />
          <p className="font-medium">{game.currentPrompt}</p>
          <div className="grid gap-2">
            {(game.currentOptions ?? []).map((opt, i) => (
              <OptionTile
                key={i}
                index={i}
                text={opt}
                size="md"
                disabled
                state={i === game.revealedAnswer ? 'correct' : i === myChoice ? 'wrong' : 'dim'}
              />
            ))}
          </div>
          {game.revealedExplanation && <p className="rounded-xl bg-card p-4 text-sm">{game.revealedExplanation}</p>}
        </section>
      )}

      {game.phase === 'finished' && (
        <section className="space-y-5">
          {me && (
            <div className="rounded-2xl bg-ink p-8 text-center text-background">
              <p className="text-sm uppercase tracking-[0.2em] opacity-70">You finished</p>
              <p className="mt-2 font-display text-5xl">#{rank}</p>
              <p className="mt-2 opacity-80">
                {me.score} points · {me.correctCount} / {game.questionCount} correct
              </p>
            </div>
          )}
          <Leaderboard players={players} highlightUserId={user?.id} />
          <Link to="/home" className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}>Done</Link>
        </section>
      )}
    </Stage>
  )
}

function RevealBanner({ correct, answered, points, streak }: { correct: boolean; answered: boolean; points: number; streak: number }) {
  return (
    <div
      className={cn(
        'flex items-center gap-4 rounded-2xl p-5',
        correct ? 'bg-emerald-600 text-white' : 'bg-ink text-background',
      )}
      role="status"
    >
      {correct ? <Check className="h-8 w-8" /> : <X className="h-8 w-8" />}
      <div>
        <p className="font-display text-2xl">{correct ? 'Correct' : answered ? 'Not this time' : 'No answer'}</p>
        <p className="text-sm opacity-85">
          {correct ? `+${points} points${streak >= 2 ? ` · ${streak} in a row` : ''}` : 'Streak reset. Next one.'}
        </p>
      </div>
    </div>
  )
}
