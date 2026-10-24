# Fixtures

Saved upstream responses used by tests and by the offline/replay demo. Tests never touch the network.

**Provenance.** The ESPN and Kalshi files are real responses saved with `pnpm fixtures:fetch` on
Oct 24, 2026 (the evening before PIT vs NO). Earlier builds used ESPN-shaped files generated from
nflverse (`scripts/build_fixtures.py`, marked `"_synthetic": true`); those hid two ESPN-only formats
(a touchdown and its extra point in one play, and "Official Timeout" TV breaks), so tests now run on
the real data. The nflverse files are still used for the parser accuracy harness.

| File | Contents |
| --- | --- |
| `espn/summary_401873002.json` | Demo game PIT 26 @ TB 19 (OT), 2026 week 6: drives, plays, win probability, pickcenter |
| `espn/scoreboard_2026_wk6.json` | Week 6 scoreboard (all final, includes the demo game) |
| `espn/scoreboard_2026_wk7.json` | Week 7 scoreboard, includes PIT vs NO in Paris (`401873011`) |
| `espn/team_{PIT,NO,TB}.json` | Team info |
| `espn/roster_{PIT,NO,TB}.json` | Rosters |
| `espn/depthchart_{PIT,NO,TB}.json` | Depth charts by formation group (`site.api.espn.com/.../teams/{id}/depthcharts`) |
| `kalshi/events_KXNFLGAME.json` | Kalshi `/events` snapshot of open NFL game markets (includes `KXNFLGAME-26OCT25PITNO`) |
| `nflverse/pbp_2026_06_PIT_TB.csv` | Demo game play-by-play, all nflverse columns |
| `nflverse/parser_eval_{2024,2025,2026}.csv.gz` | Labeled plays from 3 seasons for the parser accuracy harness |

Refresh ESPN/Kalshi: `pnpm fixtures:fetch`. Rebuild the nflverse files: `python scripts/fetch_nflverse.py` (needs pandas).
