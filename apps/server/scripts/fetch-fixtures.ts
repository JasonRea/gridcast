/**
 * Replaces the synthesized fixtures in data/fixtures with real ESPN and Kalshi responses.
 * Run on a machine with network access: `pnpm fixtures:fetch`.
 * Tests keep passing either way because the zod schemas accept both.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = join(ROOT, 'data/fixtures');
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const KALSHI = 'https://external-api.kalshi.com/trade-api/v2';

const DEMO_EVENT = process.env.DEMO_GAME_ID ?? '401873002';
/** Kalshi event for the demo game (PIT @ TB, Oct 18 2026); its price history is saved below. */
const DEMO_KALSHI_EVENT = process.env.DEMO_KALSHI_EVENT ?? 'KXNFLGAME-26OCT18PITTB';
const TEAMS: Record<string, string> = { PIT: '23', NO: '18', TB: '27' };

async function save(rel: string, url: string): Promise<void> {
  const res = await fetch(url, { headers: { 'user-agent': 'gridcast-fixtures' } });
  if (!res.ok) {
    console.error(`FAIL ${res.status} ${url}`);
    return;
  }
  const body: unknown = await res.json();
  const path = join(OUT, rel);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(body, null, 1) + '\n');
  console.log(`saved ${rel}`);
}

await save(`espn/summary_${DEMO_EVENT}.json`, `${ESPN}/summary?event=${DEMO_EVENT}`);
await save('espn/scoreboard_2026_wk6.json', `${ESPN}/scoreboard?seasontype=2&week=6&dates=2026`);
await save('espn/scoreboard_2026_wk7.json', `${ESPN}/scoreboard?seasontype=2&week=7&dates=2026`);
for (const [abbr, id] of Object.entries(TEAMS)) {
  await save(`espn/team_${abbr}.json`, `${ESPN}/teams/${id}`);
  await save(`espn/roster_${abbr}.json`, `${ESPN}/teams/${id}/roster`);
  await save(`espn/depthchart_${abbr}.json`, `${ESPN}/teams/${id}/depthcharts`);
}
await save(
  'kalshi/events_KXNFLGAME.json',
  `${KALSHI}/events?series_ticker=KXNFLGAME&status=open&with_nested_markets=true&limit=100`,
);

// Demo game market price history: one candlestick per minute from an hour before kickoff to the
// market close, for each team's market. The replay weaves these in as odds events.
{
  const res = await fetch(`${KALSHI}/events/${DEMO_KALSHI_EVENT}?with_nested_markets=true`, {
    headers: { 'user-agent': 'gridcast-fixtures' },
  });
  if (!res.ok) {
    console.error(`FAIL ${res.status} Kalshi event ${DEMO_KALSHI_EVENT}`);
  } else {
    const body = (await res.json()) as {
      event?: { markets?: { ticker: string; occurrence_datetime?: string; close_time?: string }[] };
    };
    for (const m of body.event?.markets ?? []) {
      // occurrence_datetime is the expected game end (kickoff + 3 h): start an hour before kickoff.
      const start = Math.floor(Date.parse(m.occurrence_datetime ?? '') / 1000 - 4 * 3600);
      const close = Date.parse(m.close_time ?? '') / 1000;
      if (!Number.isFinite(start) || !Number.isFinite(close)) continue;
      await save(
        `kalshi/candles_${m.ticker}.json`,
        `${KALSHI}/series/KXNFLGAME/markets/${m.ticker}/candlesticks?start_ts=${start}&end_ts=${Math.ceil(close)}&period_interval=1`,
      );
    }
  }
}
