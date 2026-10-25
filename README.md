# Gridcast

Every NFL play, animated and explained from nothing but the live data feed. Gridcast turns ESPN
play-by-play into an animated 2D field with 22 players, AI announcers, stoppage cards, the
prediction market's win probability next to the model, and an Access mode that lets blind and
low-vision fans hear and feel the field. Live games and recorded replays run through one pipeline;
only the playback clock differs.

- `PRD.md`: what to build. `AGENTS.md`: how. `PLAN.md`: build plan. `DECISIONS.md`: every judgment call.
- `packages/parser/REPORT.md`: parser accuracy against nflverse labels (99.8% type, 99.3% yards, 99.99% direction).

## Status

| Tier | Feature | State |
| --- | --- | --- |
| P0 | Parser, server pipeline, replay engine, SSE, field with 10 templates, commentary + stoppage cards, Kalshi odds + WP bar + LIVE pill, live mode + kill switch, deploy config | Done |
| P1 | Preview page, timeline scrubber + big-play jumps, EPA, odds vs model chart + swing callouts, two-voice TTS, 4th-down bot, Ask the game, X clips | Done, each behind a flag |
| P1 | Sound design (crowd noise) | Removed by owner decision |
| P1 | Tracking-play retrieval (Big Data Bowl) | Not built: needs Kaggle data (see `DECISIONS.md`) |
| P2 | Self-recorded clips, The Odds API lines, postgame recap | Not started |
| Review | Access mode (spatial sound, haptics, screen reader, radio mode) | Done |
| Review | Talk to the booth (voice questions, Gemini or Claude, spoken answer, play replay) | Done (needs `GEMINI_API_KEY` or `ANTHROPIC_API_KEY`) |
| Review | Commentary in FR/ES/DE/PT (Gemini translation, ElevenLabs voices) | Done (needs a key) |
| Review | Historical twins for every 4th down (nflverse 2016-2025, Tiger Data path) | Done |
| Review | Phones in the room (QR code, radio mode in step with the projector) | Done |

Review checkpoints from `AGENTS.md`: step 0 is commit `data: step 0 fixtures...`, P0-3 is `test(web): browser smoke test...`.

## Setup

Requires Node 22.12+ and pnpm 10 (`corepack enable`).

```bash
pnpm install
cp .env.example .env   # optional: everything works without keys
pnpm dev               # server on :8787, web on :5173 (proxies /api)
```

Open http://localhost:5173. The demo replay (PIT @ TB, 2026 week 6) is pinned on the home page.

No network access to ESPN or Kalshi? Run fully offline from saved fixtures:

```bash
GRIDCAST_OFFLINE=1 pnpm dev
```

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Web and server together (hot reload) |
| `pnpm build` | Builds the web app into `apps/web/dist` (the server serves it) |
| `pnpm start` | Production server on `$PORT` (serves the API, SSE and the built web app) |
| `pnpm test` | All unit and integration tests (fixtures only, no network) |
| `pnpm typecheck` | TypeScript strict across every package |
| `pnpm lint` | ESLint |
| `pnpm format` / `pnpm format:check` | Prettier |
| `pnpm check` | typecheck + lint + format check + test (run before every push) |
| `pnpm replay <gameId> [--speed 4] [--from 0]` | Streams a game's event log to the console through the replay clock |
| `pnpm parser:eval` | Scores the parser on 3 seasons of nflverse plays and rewrites `packages/parser/REPORT.md` |
| `pnpm pregen <gameId>` | Pre-generates a finished game: Claude commentary (with `ANTHROPIC_API_KEY`) and announcer audio with the higher-quality model (with `ELEVENLABS_API_KEY`) |
| `pnpm smoke [baseUrl] [outDir] [seconds]` | Chromium smoke test: home page and demo replay, screenshots, fails on console errors |
| `pnpm clips:backfill <gameId> [--write]` | Official X highlight clips for a finished game's big plays (verified league, broadcaster and team accounts only); `--write` saves `data/assets/clips/<gameId>.json` so they outlive X's 7-day search. Uses X credits |
| `pnpm fixtures:fetch` | Replaces the saved fixtures with real ESPN and Kalshi responses (needs network) |
| `python scripts/fetch_nflverse.py && python scripts/build_fixtures.py` | Rebuilds fixtures from nflverse (needs pandas) |
| `python scripts/fetch_nflverse.py --twins && python scripts/build_twins.py` | Rebuilds `data/assets/twins.json`, the 4th-down historical twins, from 10 seasons of nflverse |
| `TIGER_DATABASE_URL=... python scripts/build_twins.py --tiger-load` then `--tiger` | Same twins computed in Tiger Data (TimescaleDB): loads every play 2016-2025 into a hypertable with a weekly continuous aggregate, then builds the table in SQL (uses the `psql` CLI) |
| `npx qrcode@1.5.4 -t svg -e M -q 2 -o apps/web/public/qr-room.svg https://<host>/r` | Regenerates the phones QR code after a domain change (also update `QR_ORIGIN` in `PhonesPanel.tsx`) |

## Environment variables

Missing keys disable features, never the app.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | Server port |
| `FEATURED_GAME_ID` | `401873011` | ESPN event id pinned to the top of the home page and polled live (PIT vs NO, Paris) |
| `DEMO_GAME_ID` | `401873002` | Finished game used for the polished replay (PIT @ TB, OT comeback) |
| `ADMIN_TOKEN` | none | Protects `/api/admin/source` (kill switch). Unset means the kill switch refuses every request |
| `ANTHROPIC_API_KEY` | none | Claude commentary. Unset means deterministic template commentary |
| `GEMINI_API_KEY` | none | Gemini answers Ask the game / Talk to the booth and translates commentary. Without it, Claude does both when its key is set |
| `CHAT_PROVIDER` | Gemini when its key is set | `gemini` or `claude`, when both keys are set |
| `GEMINI_MODEL` / `GEMINI_TRANSLATE_MODEL` | `gemini-3.6-flash` / `gemini-3.5-flash-lite` | Booth model and translation model |
| `GEMINI_FALLBACK_MODELS` | `gemini-3.5-flash-lite,gemini-3.6-flash` | Tried in order when a model is overloaded (429/5xx) or slow (15 s per attempt in the booth) |
| `GEMINI_BASE` | Google endpoint | Override for a local mock |
| `COMMENTARY_MODEL` | `claude-haiku-5-5` | Fast model for per-play lines |
| `CHAT_MODEL` | `claude-opus-5-5` | Stronger model for Ask the game (P1) |
| `ELEVENLABS_API_KEY` | none | Announcer voices (P1). Unset means browser speech synthesis |
| `ELEVENLABS_PBP_VOICE` / `ELEVENLABS_COLOR_VOICE` | ElevenLabs premade voices | Voice IDs for the play-by-play and color voices. Use a voice you own or are licensed to use; Gridcast never clones voices |
| `ELEVENLABS_LIVE_MODEL` | `eleven_flash_v2_5` | Fast model for live lines |
| `ELEVENLABS_PREGEN_MODEL` | `eleven_multilingual_v2` | Higher-quality model used by `pnpm pregen`; served first when present |
| `ELEVENLABS_STABILITY` / `_SIMILARITY` / `_STYLE` / `_SPEED` | `0.6` / `0.8` / `0.15` / `0.95` | Voice settings: steady, slightly unhurried network delivery |
| `X_BEARER_TOKEN` | none | X clips (P1). Unset means no clips |
| `ODDS_API_KEY` | none | Sportsbook lines (P2) |
| `GRIDCAST_OFFLINE` | off | Never call ESPN or Kalshi; serve fixtures and recorded logs |
| `DATA_DIR` | `./data` | Where event logs, the commentary cache and recordings are written |
| `ESPN_POLL_MS` / `KALSHI_POLL_MS` | `10000` / `5000` | Poll intervals |
| `KALSHI_BASE` | `https://external-api.kalshi.com/trade-api/v2` | Kalshi REST base URL |
| `SEASON` | `2026` | Season for the scoreboard |
| `VITE_API_BASE` | same origin | Web build only: server URL when the web app is hosted separately |

### Feature flags

Server-side flags, returned to the web app in `GET /api/games/:id` (`features`). Set to `0` to turn a feature off.

| Flag | Default | Feature |
| --- | --- | --- |
| `FLAG_TIMELINE` | on | Timeline scrubber and jump to big plays |
| `FLAG_EPA` | on | EPA chips per play and team EPA |
| `FLAG_PREVIEW` | on | Full preview page for upcoming games |
| `FLAG_ODDS_CHART` | on | Odds vs model chart and swing callouts |
| `FLAG_TTS` | on | Two-voice announcers (muted by default) |
| `FLAG_FOURTH_DOWN` | on | 4th-down decision bot |
| `FLAG_CHAT` | on (needs `GEMINI_API_KEY` or `ANTHROPIC_API_KEY`) | Ask the game and Talk to the booth |
| `FLAG_TRANSLATE` | on (needs `GEMINI_API_KEY` or `ANTHROPIC_API_KEY`) | Commentary language picker (FR, ES, DE, PT) |
| `FLAG_CLIPS` | on (needs `X_BEARER_TOKEN`) | X clips: live games every minute; finished games get one backfill search (big plays only, cached). Only posts from allowlisted accounts that X verifies as organizations |

## Architecture

```
ESPN (10 s) ─┐                                                   ┌─ live clock ───┐
Kalshi (5 s) ─┼─> normalizer ─> enrichment ─> JSONL event log ───┤                ├─> SSE ─> web
              │   (parser,      (commentary,   data/logs/<id>    └─ replay clock ─┘
              │    state, WP)    odds)                              (1x-8x)
recorder ─────┘ data/recordings/<id>/*.json
```

- `packages/types`: the shared contract (`GameEvent`, `ParsedPlay`, `GameState`, zod schemas, team colors).
- `packages/parser`: deterministic play parser. The LLM never decides what happened on the field.
- `apps/server`: Hono API, pollers, normalizer, event log, playback clocks, commentary, odds, kill switch.
- `apps/web`: React + Vite, TanStack Router, Tailwind v4 + restyled shadcn/ui, SVG field animated with GSAP.

### Server API

| Method | Route | Returns |
| --- | --- | --- |
| GET | `/api/games?season=&week=` | Scoreboard cards |
| GET | `/api/games/:id` | Game header, status, teams, rosters, depth charts, feature flags |
| GET | `/api/games/:id/events?from=` | Event log so far (catch-up) |
| GET | `/api/games/:id/stream?from=&speed=` | SSE: `game` events (logged), `control` messages (status, reset, commentary deltas) |
| GET/POST | `/api/admin/source` | Kill switch status / flip (`Authorization: Bearer $ADMIN_TOKEN`) |

## Demo day

Kill switch from a laptop or phone: open `/admin`, paste the token, press **Switch to replay** (or **Go live**).
From a terminal:

```bash
curl -X POST https://gridcast-028f.fly.dev/api/admin/source \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"source":"replay","speed":4,"from":0}'
```

Keyboard on the game page: space pause/play, left/right previous/next play, B next big play,
M announcers, A Access mode, R radio mode.

Access mode (**Access** button or A): the ball's position becomes sound. Stereo pan follows the
ball, pitch rises toward the goal the offense attacks, a quiet tone marks the first-down line and a
tick every 5 yards gained; each outcome has its own sound and, on Android, its own vibration
(iPhone Safari has no vibration API, so sound covers it). Touchdowns get a crowd roar (ElevenLabs
sound effect when `ELEVENLABS_API_KEY` is set, synthesized otherwise). Screen readers hear every
play's call, the score and the next down. Radio mode (R, or `?mode=radio`) is a large
high-contrast text view.

Phones in the room: **Phones** shows a QR code for `/r`. Each phone opens the game in radio mode,
joins on the play the projector is showing and follows it, with its own language
(`?lang=fr`) and announcers.

Open a replay mid-game with `?from=`: a play index (`/game/401873002?from=150`) or a period
(`?from=q4`, `?from=ot`). The **Q4** button next to **Big play** jumps to the 4th quarter.

Checklist (from `AGENTS.md`):

1. `FEATURED_GAME_ID` verified against the live ESPN scoreboard on game morning.
2. Server deployed and polling from kickoff (recorder writes `data/recordings/<id>/`).
3. Kill switch tested live -> replay -> live.
4. `pnpm pregen 401873002` run with the Claude key, cache committed to `data/assets/commentary/`.
5. P1 flags that are not rock solid turned off.
6. Production URL tested on a phone hotspot.

## Deploy

Fly.io (recommended; config in `fly.toml`):

```bash
fly launch --no-deploy --copy-config
fly volumes create gridcast_data --size 1
fly secrets set ADMIN_TOKEN=... ANTHROPIC_API_KEY=...
fly deploy
```

CI deploys `main` automatically when the `FLY_API_TOKEN` repository secret is set
(`.github/workflows/deploy.yml`). Railway works too (`railway.json`, Dockerfile builder, mount a volume at `/data`).

## Data and fixtures

`data/fixtures/` holds the saved upstream responses tests use. The ESPN and Kalshi files are real
responses saved with `pnpm fixtures:fetch` on Oct 24 (behind an HTTPS proxy, run it as
`NODE_USE_ENV_PROXY=1 pnpm fixtures:fetch`); see `data/fixtures/README.md`.

Odds shown for information only. Not betting advice.
