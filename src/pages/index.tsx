/**
 * Landing page — a STATIC, prerendered page (no auth, no socket). The live
 * app is under /home.
 */

import { Link } from 'react-router-dom'
import { Seo } from '../components/Seo'
import { APP_NAME } from '../constants'
import { seo } from '../seo'

const STEPS = [
  { n: '1', title: 'Bring the material', body: 'Paste lecture notes, load a .txt or .md file, or just name a topic and let it search the web.' },
  { n: '2', title: 'Review the questions', body: 'Four options each, an explanation, and a source link when it came from the web. Fix anything before going live.' },
  { n: '3', title: 'Play it live', body: 'Students join with a six-letter code. The server keeps time and scores, then tells you which ideas the room missed.' },
]

export default function Landing() {
  return (
    <>
      <Seo {...seo} path="/" />
      <div data-testid="static-landing" className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-10">
        <header className="flex items-center justify-between">
          <span className="font-display text-xl">{APP_NAME}</span>
          <Link to="/home" className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            Join a game
          </Link>
        </header>

        <main className="flex flex-1 flex-col justify-center py-16">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-ember">Live quizzes from your own notes</p>
          <h1 className="mt-4 max-w-3xl font-display text-5xl leading-[1.05] text-foreground sm:text-6xl">
            Ten minutes before class, turn the reading into a game.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-muted-foreground">
            QuizForge writes the questions from what you actually taught, runs the game on everyone&apos;s phone, and ends with a short
            recap of the misconceptions worth re-teaching.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <Link to="/create" className="inline-flex items-center rounded-lg bg-ink px-6 py-3 text-sm font-medium text-background hover:opacity-90">
              Make a quiz
            </Link>
            <Link to="/home" className="inline-flex items-center rounded-lg border border-border px-6 py-3 text-sm font-medium hover:bg-card">
              I have a code
            </Link>
          </div>

          <ol className="mt-20 grid gap-6 sm:grid-cols-3">
            {STEPS.map((s) => (
              <li key={s.n} className="border-t border-border pt-4">
                <span className="font-display text-3xl text-ember">{s.n}</span>
                <p className="mt-2 font-medium">{s.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
              </li>
            ))}
          </ol>
        </main>
      </div>
    </>
  )
}
