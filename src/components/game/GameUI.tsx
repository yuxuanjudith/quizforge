/**
 * Presentational pieces shared by the host and player screens. Answers are
 * told apart by letter AND shape AND color, so the game still works for
 * colorblind players and on a washed-out classroom projector.
 */

import { Check, Circle, Diamond, Square, Triangle, X } from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import { cn } from '@/components/ui'
import { rankPlayers } from '../../lib/quiz-logic'
import type { PlayerRow } from '../../lib/game-types'

export const OPTION_STYLES: Array<{ letter: string; Icon: ComponentType<{ className?: string }>; tile: string; bar: string }> = [
  { letter: 'A', Icon: Triangle, tile: 'bg-opt-a text-white', bar: 'bg-opt-a' },
  { letter: 'B', Icon: Diamond, tile: 'bg-opt-b text-white', bar: 'bg-opt-b' },
  { letter: 'C', Icon: Circle, tile: 'bg-opt-c text-ink', bar: 'bg-opt-c' },
  { letter: 'D', Icon: Square, tile: 'bg-opt-d text-white', bar: 'bg-opt-d' },
]

export function OptionTile({
  index,
  text,
  onClick,
  disabled,
  state = 'idle',
  size = 'lg',
}: {
  index: number
  text: string
  onClick?: () => void
  disabled?: boolean
  /** idle → normal; picked → my locked answer; correct/wrong → after reveal; dim → not mine / not correct */
  state?: 'idle' | 'picked' | 'correct' | 'wrong' | 'dim'
  size?: 'lg' | 'md'
}) {
  const { letter, Icon, tile } = OPTION_STYLES[index]
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={`${letter}: ${text}`}
      aria-pressed={state === 'picked' || undefined}
      className={cn(
        'group relative flex w-full items-center gap-3 rounded-xl px-4 text-left font-medium transition-all',
        size === 'lg' ? 'min-h-20 py-4 text-lg' : 'min-h-14 py-3 text-base',
        tile,
        onClick && !disabled && 'hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0',
        disabled && 'cursor-default',
        state === 'picked' && 'ring-4 ring-ink ring-offset-2 ring-offset-background',
        state === 'correct' && 'ring-4 ring-emerald-600 ring-offset-2 ring-offset-background',
        state === 'dim' && 'opacity-35',
        state === 'wrong' && 'opacity-60',
      )}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-black/15">
        <Icon className="h-5 w-5 fill-current" />
      </span>
      <span className="min-w-0 flex-1 break-words">{text}</span>
      {state === 'correct' && <Check className="h-6 w-6 shrink-0" aria-label="correct" />}
      {state === 'wrong' && <X className="h-6 w-6 shrink-0" aria-label="your answer, wrong" />}
    </button>
  )
}

/** Shrinking bar plus big seconds counter. */
export function Countdown({ remainingMs, totalMs }: { remainingMs: number; totalMs: number }) {
  const fraction = totalMs > 0 ? remainingMs / totalMs : 0
  const seconds = Math.ceil(remainingMs / 1000)
  return (
    <div className="flex items-center gap-4" role="timer" aria-live="off">
      <div className="h-3 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full transition-[width] duration-100 ease-linear', seconds <= 5 ? 'bg-ember' : 'bg-ink')}
          style={{ width: `${Math.max(0, Math.min(1, fraction)) * 100}%` }}
        />
      </div>
      <span className={cn('w-12 text-right font-display text-3xl tabular-nums', seconds <= 5 && 'text-ember')}>{seconds}</span>
    </div>
  )
}

/** How the room answered, shown on reveal. */
export function AnswerBars({ counts, correct, options }: { counts: number[]; correct: number; options: string[] }) {
  const max = Math.max(1, ...counts)
  return (
    <div className="flex h-44 items-end gap-3" aria-label="How the room answered">
      {options.map((opt, i) => {
        const { letter, Icon, bar } = OPTION_STYLES[i]
        const n = counts[i] ?? 0
        return (
          <div key={i} className="flex flex-1 flex-col items-center gap-2">
            <span className="font-display text-xl tabular-nums">{n}</span>
            <div
              className={cn('w-full rounded-t-lg transition-[height] duration-500', bar, i !== correct && 'opacity-35')}
              style={{ height: `${Math.max(4, (n / max) * 110)}px` }}
              title={opt}
            />
            <span className="flex items-center gap-1 text-sm text-muted-foreground">
              <Icon className="h-3.5 w-3.5" /> {letter}
              {i === correct && <Check className="h-4 w-4 text-emerald-600" aria-label="correct" />}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export function Leaderboard({
  players,
  highlightUserId,
  limit = 10,
  showDelta = false,
}: {
  players: PlayerRow[]
  highlightUserId?: string
  limit?: number
  showDelta?: boolean
}) {
  const ranked = rankPlayers(players)
  if (ranked.length === 0) return <p className="text-sm text-muted-foreground">No players yet.</p>
  return (
    <ol className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
      {ranked.slice(0, limit).map((p, i) => (
        <li
          key={p.userId}
          className={cn('flex items-center gap-3 px-4 py-2.5', p.userId === highlightUserId && 'bg-ember/10')}
        >
          <span className="w-6 font-display text-lg tabular-nums text-muted-foreground">{i + 1}</span>
          <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
          {p.streak >= 2 && <span className="rounded-full bg-ember/15 px-2 py-0.5 text-xs text-ember">{p.streak} streak</span>}
          {showDelta && (p.lastPoints ?? 0) > 0 && (
            <span className="text-sm tabular-nums text-emerald-700">+{p.lastPoints}</span>
          )}
          <span className="w-16 text-right font-display text-lg tabular-nums">{p.score}</span>
        </li>
      ))}
    </ol>
  )
}

export function Stage({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto w-full max-w-3xl px-4 py-6 sm:py-10', className)}>{children}</div>
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">{children}</p>
}
