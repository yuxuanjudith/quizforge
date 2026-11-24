/**
 * /create — notes or a topic in, a reviewed quiz out.
 *
 * Notes mode: paste text or load a .txt/.md file (read in the browser; the
 * file itself is not uploaded — see the README for why storage was left out).
 * Topic mode: the server searches the web first and grounds every question
 * in a cited source.
 */

import { useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Globe, NotebookPen, Sparkles } from 'lucide-react'
import { Button, Input, Label, Textarea, cn, useToast } from '@/components/ui'
import { callAction } from '../../../lib/actions-client'
import { MAX_QUESTIONS, MIN_QUESTIONS } from '../../../lib/quiz-logic'
import { Eyebrow, Stage } from '../../../components/game/GameUI'

type Mode = 'notes' | 'topic'
const MIN_NOTES = 200

export default function CreateQuizPage() {
  const [mode, setMode] = useState<Mode>('notes')
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [topic, setTopic] = useState('')
  const [count, setCount] = useState(8)
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const toast = useToast()

  const ready = mode === 'notes' ? notes.trim().length >= MIN_NOTES : topic.trim().length >= 3

  async function loadFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!/\.(txt|md|markdown)$/i.test(file.name)) {
      toast.warning('Text files only for now', 'Use .txt or .md, or paste the text. PDF support is on the roadmap.')
      return
    }
    if (file.size > 200_000) {
      toast.warning('That file is large', 'Only the first 20,000 characters will be used.')
    }
    setNotes((await file.text()).slice(0, 20_000))
    if (!title) setTitle(file.name.replace(/\.[^.]+$/, ''))
  }

  async function generate() {
    setBusy(true)
    try {
      const { quizId } = await callAction<{ quizId: string }>('generateQuiz', {
        title: title.trim() || undefined,
        notes: mode === 'notes' ? notes : undefined,
        topic: mode === 'topic' ? topic : undefined,
        count,
      })
      toast.success('Quiz ready', 'Review the questions before you go live.')
      navigate(`/quiz/${quizId}`)
    } catch (err) {
      toast.error('Generation failed', err instanceof Error ? err.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Stage className="space-y-8">
      <div>
        <Eyebrow>New quiz</Eyebrow>
        <h1 className="mt-2 font-display text-3xl">What should the room be tested on?</h1>
      </div>

      <div role="tablist" aria-label="Source" className="grid grid-cols-2 gap-2 rounded-xl bg-muted p-1">
        {(
          [
            { id: 'notes', label: 'My notes', Icon: NotebookPen },
            { id: 'topic', label: 'A topic, from the web', Icon: Globe },
          ] as const
        ).map(({ id, label, Icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={mode === id}
            onClick={() => setMode(id)}
            className={cn(
              'flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
              mode === id ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {mode === 'notes' ? (
        <div className="space-y-2">
          <div className="flex items-end justify-between">
            <Label htmlFor="notes">Lecture notes, a reading, a chapter</Label>
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
              <FileText className="h-4 w-4" /> Load .txt / .md
              <input type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" onChange={loadFile} className="sr-only" />
            </label>
          </div>
          <Textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, 20_000))}
            placeholder="Paste at least a paragraph. Questions are written only from what is here."
            className="min-h-64 font-[inherit] text-[15px] leading-relaxed"
          />
          <p className="text-xs text-muted-foreground">
            {notes.trim().length < MIN_NOTES
              ? `${MIN_NOTES - notes.trim().length} more characters needed`
              : `${notes.length.toLocaleString()} / 20,000 characters`}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="topic">Topic</Label>
          <Input
            id="topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value.slice(0, 200))}
            placeholder="How mRNA vaccines train the immune system"
            className="h-12 text-base"
          />
          <p className="text-xs text-muted-foreground">
            QuizForge searches the web first, then writes questions from those pages and links each one to its source.
          </p>
        </div>
      )}

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="title">Title (optional)</Label>
          <Input id="title" value={title} onChange={(e) => setTitle(e.target.value.slice(0, 120))} placeholder="Week 4 — Cell signaling" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="count">
            Questions: <span className="tabular-nums">{count}</span>
          </Label>
          <input
            id="count"
            type="range"
            min={MIN_QUESTIONS}
            max={MAX_QUESTIONS}
            step={1}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            className="h-10 w-full accent-[var(--color-ember)]"
          />
        </div>
      </div>

      <div className="flex items-center justify-end gap-3">
        {busy && <span className="text-sm text-muted-foreground">Writing questions… this takes 10–30 seconds.</span>}
        <Button size="lg" onClick={generate} loading={busy} disabled={!ready}>
          <Sparkles /> Generate quiz
        </Button>
      </div>
    </Stage>
  )
}
