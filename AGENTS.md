# Agent instructions: Gridcast

You are building Gridcast, a hackathon web app that reconstructs live NFL games from play-by-play data. `PRD.md` is the source of truth for what to build. This file tells you how to build it.

**Hard deadline.** Feature freeze is Sunday Oct 25, 2026 at 7:00 AM ET. The live demo runs during the Steelers vs Saints game (kickoff 9:30 AM ET), and judging is 10:30 AM to 1:00 PM ET. A working P0 beats a half-built P1 every time.

## 1. Planning (you are in plan mode)

Read `PRD.md` fully before planning. Your plan must include:

1. **Step 0 in detail:** the exact files for `packages/types` (all types from the PRD data model, plus `teamColors.ts`), the fixtures you'll save and where, and the monorepo skeleton.
2. **P0 milestones in order** (section 3), each with the files it touches and how you'll verify it.
3. **Which work can run in parallel** (subagents or worktrees), following the PRD's workstream table. Nothing runs in parallel before step 0 is committed.
4. **Your assumptions and open questions.** Flag anything in the PRD that is ambiguous or that you think is wrong. Don't silently change scope.

Keep the plan concrete: file paths, commands, acceptance checks. No time estimates beyond rough ordering.

## 2. Stop points (wait for human review)

- After the plan is written.
- After step 0 is committed (types, fixtures, skeleton). The types are the contract every workstream builds on, so they get reviewed before anything else is built.
- After milestone P0-3 (first end-to-end replay works).
- Before any change to `packages/types` once workstreams have started.
- Before adding any dependency not listed in the PRD stack.

## 3. Build order

**Step 0: contract and fixtures**

- pnpm workspace: `apps/web`, `apps/server`, `packages/types`, `packages/parser`, `data/`, `scripts/`.
- `packages/types`: `GameEvent`, `ParsedPlay`, `GameState`, odds, commentary, clip types, zod schemas for each, and `teamColors.ts` (PIT and NO hardcoded from the PRD).
- Save fixtures to `data/fixtures/`:
  - one finished game's ESPN `summary` JSON
  - this week's ESPN scoreboard
  - ESPN team + roster JSON for PIT and NO
  - a Kalshi markets snapshot for an NFL game
  - the nflverse play-by-play for the chosen demo game
- While saving fixtures, confirm the Kalshi NFL series ticker and an ESPN depth-chart endpoint. Record what you find in `DECISIONS.md`.
- Commit. Stop for review.

**P0 milestones**

| # | Milestone | Verify |
| --- | --- | --- |
| P0-1 | Parser: `packages/parser` turns play text + ESPN fields into `ParsedPlay` | Test harness scores it against nflverse labels; report accuracy for play type, yards, direction. Target 95%+ |
| P0-2 | Server: ESPN ingestion, normalizer, JSONL event log, replay engine, SSE stream, `/api/games`, `/api/games/:id`, `/api/games/:id/events`, `/api/games/:id/stream` | Replaying the fixture game emits valid `GameEvent`s at 1x and 8x (schema-validated in tests) |
| P0-3 | Web shell + field: restyled shadcn theme, `/` scoreboard, `/game/:id` live/final layout, SVG field with 22 team-colored players, formations, all 10 animation templates (GSAP) | Fixture game plays start to finish in the browser with no console errors. Stop for review |
| P0-4 | Commentary + stoppage cards: Claude streaming, grounding post-check, cache by play ID | Every play in the fixture gets a line; stoppages produce cards; replay never re-calls Claude |
| P0-5 | Kalshi odds + WP bar + LIVE freshness pill | Odds tick in the UI from the fixture snapshot and from the live poller |
| P0-6 | Live mode + kill switch: live ESPN polling for `FEATURED_GAME_ID`, recorder on, `/api/admin/source` flips live to replay | Point at any in-progress or recent game and watch events arrive; flip the switch mid-stream without a page reload |
| P0-7 | Deploy: server on Railway or Fly, web on any static host | Production URL replays the fixture game from a phone hotspot |

**P1, in this order, each behind a feature flag:** preview page, timeline scrubber + jump to big plays, EPA, odds vs model chart + swing callouts, two-voice TTS, 4th-down bot, Ask-the-game chat, X clips, tracking-play retrieval, sound.

**P2 only if all P1 is stable before 7:00 AM:** self-recorded clips, The Odds API lines, postgame recap.

## 4. Rules

- **The parser is deterministic code.** The LLM writes commentary and chat answers only. It never decides what happened on the field.
- **The web app calls only our server API.** Never ESPN, Kalshi, X, ElevenLabs or Claude directly. API keys never reach the browser.
- **Validate every external response with zod and fail soft.** ESPN and Kalshi are undocumented and can change shape. A bad response is logged and skipped. It never crashes a poller or the stream.
- **Tests use saved fixtures only.** No live network calls in tests.
- **Keep live and replay on one codepath.** The playback clock is the only difference. Don't fork the pipeline.
- **The kill switch must always work.** `/api/admin/source` protected by `ADMIN_TOKEN`.
- **Missing keys disable features, not the app.** No `ANTHROPIC_API_KEY` means template commentary. No `X_BEARER_TOKEN` means no clips. No `ELEVENLABS_API_KEY` means browser speech.
- **Commentary grounding:** only facts present in the context. Reject lines that name players not in the play or roster. No speculation about injury severity.
- **Odds are information only.** Show the footer "Odds shown for information only. Not betting advice." No bet placement, picks or affiliate links.
- **Out of scope, do not build:** beginner / "new to football" mode, 3D views, user accounts, other sports.
- **Design:** follow the PRD tokens exactly. Pure black background, white text, team colors as the only strong hues, no shadows, Geist + Barlow Condensed, tabular numerals.
- **Ambiguity:** choose the simplest option that meets the PRD and log it in `DECISIONS.md` (date, decision, reason).

## 5. Conventions

- TypeScript strict mode everywhere. No `any` in `packages/types` or the parser.
- Shared types are imported from `packages/types`, never redefined in apps.
- Small, focused commits after each working step, with clear messages.
- `README.md` lists setup, env vars and every run command.
- Scripts in the root `package.json`:
  - `pnpm dev`: web + server together
  - `pnpm test`
  - `pnpm typecheck`
  - `pnpm lint`
  - `pnpm replay <gameId> [--speed 4]`: stream a recorded log to the console
- Python data-prep scripts live in `scripts/` and write to `data/assets/`. The server only reads those outputs and never runs Python at request time.

## 6. Definition of done (every milestone)

- `pnpm dev` starts web and server together.
- `pnpm typecheck`, `pnpm lint` and `pnpm test` pass.
- The fixture game replays start to finish with no console errors.
- New feature flags are documented in `README.md`.
- `DECISIONS.md` is updated for any judgment call.

## 7. Demo-day checklist (build toward this)

- Featured game ID set to PIT vs NO and verified against the live ESPN scoreboard.
- Recorder writing the live log from kickoff.
- Kill switch tested: live to replay and back.
- Demo game commentary fully pre-generated and cached.
- Every P1 flag that isn't rock solid turned off.
- Production URL tested on a phone hotspot.
