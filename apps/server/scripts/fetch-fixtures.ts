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
