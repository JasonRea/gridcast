# Gridcast build plan

Source of truth: `PRD.md` (what) and `AGENTS.md` (how). This plan is the concrete execution order.

## Step 0: contract, fixtures, skeleton

**Skeleton.** pnpm workspace with `apps/web`, `apps/server`, `packages/types`, `packages/parser`, `data/`, `scripts/`. Shared `tsconfig.base.json` (strict), ESLint flat config (no `any` in types/parser), Prettier, Vitest projects, GitHub Actions CI (typecheck, lint, format, test, build).

**`packages/types/src`**

| File            | Contents                                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `play.ts`       | `ParsedPlay`, `PlayType`, `PlayResult`, `Direction`, `Depth`, `Gap`, `PlayerRole`, `Formation`, `PenaltyInfo` + zod schemas           |
| `state.ts`      | `GameState` + zod                                                                                                                     |
| `espn.ts`       | zod schemas for the ESPN responses we read (`EspnPlay`, summary, scoreboard, team, roster), all lenient / passthrough                 |
| `kalshi.ts`     | zod schemas for Kalshi `/events` and `/markets` responses                                                                             |
| `odds.ts`       | `OddsTick` (the `odds` GameEvent)                                                                                                     |
| `commentary.ts` | `Commentary` (the `commentary` GameEvent), `Voice`                                                                                    |
| `clip.ts`       | `Clip` (the `clip` GameEvent)                                                                                                         |
| `events.ts`     | `GameEvent` discriminated union, `PlayEvent`, `StoppageEvent`, `StoppageReason`, stream envelope + zod                                |
| `api.ts`        | Server API response shapes: `GameCard`, `GameDetail`, `TeamInfo`, `AdminSourceRequest`, stream control messages                       |
| `teamColors.ts` | PIT and NO hardcoded from the PRD; table for the other 30 teams; `displayColor()` near-black rule for ESPN `color` / `alternateColor` |
| `index.ts`      | re-exports                                                                                                                            |

**Fixtures (`data/fixtures/`).** ESPN and Kalshi hosts are blocked from the build sandbox, so fixtures are built from real nflverse data and reshaped into the ESPN schema (marked `"_synthetic": true`). `pnpm fixtures:fetch` replaces them with real responses on any machine with network access. See `data/fixtures/README.md`.

- `espn/summary_401873002.json`: demo game PIT @ TB (2026 wk 6, OT comeback)
- `espn/scoreboard_2026_wk7.json`: this week, including PIT @ NO (`401873011`)
- `espn/team_{PIT,NO,TB}.json`, `espn/roster_{PIT,NO,TB}.json`, `espn/depthchart_{PIT,NO,TB}.json`
- `kalshi/events_KXNFLGAME.json`: markets snapshot shaped per Kalshi docs
- `nflverse/pbp_2026_06_PIT_TB.csv`: demo game play-by-play
- `nflverse/parser_eval_{2024,2025,2026}.csv.gz`: labeled plays (3 seasons) for the parser harness

## P0 milestones

| #    | Files                                                                              | Verify                                                                   |
| ---- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| P0-1 | `packages/parser/src/*`, `packages/parser/test/*`, `packages/parser/REPORT.md`     | `pnpm parser:eval` ≥ 95% on type, yards, direction across 3 seasons      |
| P0-2 | `apps/server/src/{espn,kalshi,pipeline,log,replay,routes}/*`, `apps/server/test/*` | Replaying the fixture game at 1x and 8x emits schema-valid `GameEvent`s  |
| P0-3 | `apps/web/src/{routes,components,field,store,lib}/*`                               | Fixture game plays start to finish in Chromium with no console errors    |
| P0-4 | `apps/server/src/commentary/*`                                                     | Every fixture play gets a line; stoppages get cards; cache hit on replay |
| P0-5 | `apps/server/src/kalshi/*`, web `WpBar`, `LivePill`, odds footer                   | Odds tick from fixture snapshot and live poller (tested with fixture)    |
| P0-6 | `apps/server/src/live/*`, `routes/admin.ts`                                        | Kill switch flips live → replay mid-stream without reload (test)         |
| P0-7 | `Dockerfile`, `fly.toml`, `railway.json`, `.github/workflows/deploy.yml`           | Container builds in CI; server serves the built web app                  |

## Parallel work

Nothing in parallel before step 0 is committed. After that, the PRD workstreams map onto this repo as: parser (1), server ingestion/replay (2), field engine (3), commentary (5), odds (6), UI shell (8). In this build they run sequentially in one branch with one commit series per workstream, because a single agent is doing the integration.

## Assumptions and open questions

See `DECISIONS.md` for every judgment call. Main open items:

- Real ESPN / Kalshi fixtures must be fetched from a networked machine (`pnpm fixtures:fetch`) before demo day.
- Kalshi PIT vs NO event ticker is expected to be `KXNFLGAME-26OCT25PITNO`; verify on the morning of the game.
- Deploy target needs an account token (Fly or Railway) in repo secrets.
