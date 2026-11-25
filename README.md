# QuizForge

Turn lecture notes, or a topic researched on the web, into a live multiplayer quiz that a whole room plays from their phones. When the game ends, the host gets a short recap of the ideas the room got wrong.

Built on the [DeepSpace](https://docs.deep.space) SDK and deployed to `*.app.space`.

## The core flow

1. **Create.** The host pastes notes (or loads a `.txt`/`.md` file), or types a topic. In topic mode the server searches the web first and writes every question from those pages, with a source link on each.
2. **Review.** The host checks the AI-written questions and can edit the wording, the options and the correct answer. Only the host can read this page.
3. **Play.** The host opens a lobby and puts the 6-character code on the projector. Players join, the server runs the timer, scores each answer by correctness, speed and streak, and reveals the answer on every screen at once.
4. **Debrief.** At the end, an AI recap names the 2–3 weakest ideas and how to re-teach them.

No AI credits to spare? **Try a sample quiz first** on the home page runs a built-in quiz with no AI call.

## How it is built

| Concern | DeepSpace primitive | Where |
|---|---|---|
| Accounts | Auth (`AuthGate`, verified JWT in every action) | `src/pages/(app)/(protected)/` |
| Data + live updates | Records with real-time sync (`useQuery` pushes every change) | `src/schemas/quiz-schemas.ts`, `src/components/game/useGame.ts` |
| Anti-cheat and secrecy | Per-collection RBAC: `read: 'own'`, `create/update: false` | `src/schemas/quiz-schemas.ts` |
| Game logic | Server actions (`/api/actions/:name`) | `src/actions/index.ts` |
| Who is still connected | Presence room `game:<id>` | host and play pages |
| Question writing and recap | **Anthropic** integration (`anthropic/chat-completion`) | `src/server/quiz/ai.ts` |
| Topic research with citations | **Exa** integration (`exa/search`) | `src/server/quiz/search.ts` |
| Read-aloud on the projector | **ElevenLabs** integration (`elevenlabs/generate-speech`) | `src/server/quiz/speech.ts` |

### Security model

- **Browsers never write game state.** `games`, `players` and `responses` are `create/update: false` for every non-admin role, so even a client that skips the UI and writes over the WebSocket is refused by the record room. All changes go through server actions, which check who is calling, the game phase and the clock themselves (actions run with RBAC off, so these checks are required).
- **The answer key is invisible to players.** `questions` is `read: 'own'`, so only the host who created it can read it. Players get the prompt and options from the `games` row. The correct answer is copied there only when the server moves the game to `reveal`. This also covers a player's own AI agent: DeepSpace agent tools run under the same RBAC.
- **Host edits are validated on the server too.** RBAC can limit *which* fields a role writes, but not *what values*. So `questions` is not writable from clients at all. Edits go through the `updateQuestion` action, which checks ownership and runs the same `validateQuestion` as AI output (4 distinct options, answer index 0–3, length limits). The form's own checks are only for instant feedback. A question can't be edited while a game is on it or past it (it would change the answer after scores were computed). Games idle for 2 hours count as abandoned, so a closed host tab doesn't lock the quiz.
- **Source links are real.** In topic mode a question keeps a `sourceUrl` only if that exact URL came back from the Exa search. A link the model made up is dropped, and in notes mode every link is dropped.
- **Daily caps on paid calls.** Each user gets 10 quiz generations and 60 read-alouds per 24 h (`DAILY_LIMITS` in `src/lib/quiz-logic.ts`). Attempts are recorded in `usage_events` *before* the paid call and counted newest-first, so a long history can't push recent attempts out of the query.
- **One answer per question is a database rule,** enforced by `uniqueOn: ['gameId','questionIndex','userId']`, not just by a disabled button.
- **The server owns time.** `questionEndsAt` is set by the server. Late answers are refused (with a 750 ms grace window), and points use server-measured time. Clients correct their countdown for clock skew using the `clock` action.
- **No provider keys, and no open AI proxy.** Model, search and speech calls go through the DeepSpace integrations proxy and are billed to the app owner. Those three integrations are marked `serverOnly` (a small addition in `src/integrations.ts` and `src/server/http-routes.ts`), so signed-in users can't send their own prompts through `/api/integrations/*` at the owner's expense.

### Game state machine

```
lobby ──nextQuestion──▶ question ──revealAnswer / last answer / timer──▶ reveal ──nextQuestion──▶ question …
                                                                            └──── (after the last question) ──▶ finished (+ AI recap)
```

`revealCurrent` can be safely called more than once: the host button, the host's timer, a player's backstop timer and "everyone has answered" can all trigger it, and only the first call has any effect.

## Run it

```bash
npm install
npx deepspace auth login
npx deepspace dev start          # http://localhost:8780
npm run test:unit                # scoring, validation, join codes
npx deepspace test run           # smoke + two-browser game test (needs 2 test accounts)
npx deepspace deploy
```

## Known limits / next steps

- **PDF upload.** Only `.txt`/`.md` files are read, in the browser. PDFs need server-side text extraction. The next step is DeepSpace file storage plus extraction in a background job.
- **Audio is not cached** between hosts. It is generated on demand per question and kept only in the host tab.
- **Late joiners** can join mid-game, but they don't get the questions they missed.
- **Cron cleanup** of abandoned lobbies isn't done. At this scale, the rows cost nothing.
- **The daily caps are counted, not reserved atomically.** A burst of parallel requests from one user can each read the count before any of them records, so the burst can overshoot the cap. A per-user counter in its own Durable Object would make the caps exact.
- **Actions are not transactions.** A reveal that races "Next question" re-checks the game row before writing, which narrows the window but doesn't close it. A per-game Durable Object (one room per game, with serialized writes) would close it. That is the next architectural step if games get large.
