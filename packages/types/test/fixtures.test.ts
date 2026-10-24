import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EspnDepthChartSchema,
  EspnEventSchema,
  EspnPlaySchema,
  EspnRosterSchema,
  EspnScoreboardSchema,
  EspnSummarySchema,
  EspnTeamResponseSchema,
  KalshiEventSchema,
  KalshiEventsResponseSchema,
} from '../src/index.ts';

const FIX = join(import.meta.dirname, '../../../data/fixtures');
const read = (rel: string): unknown => JSON.parse(readFileSync(join(FIX, rel), 'utf8'));
const espnFiles = readdirSync(join(FIX, 'espn'));

describe('saved fixtures match the zod schemas', () => {
  it('ESPN summary, including every play', () => {
    const s = EspnSummarySchema.parse(read('espn/summary_401873002.json'));
    const plays = (s.drives?.previous ?? []).flatMap((d) => d.plays);
    expect(plays.length).toBeGreaterThan(150);
    for (const p of plays) expect(EspnPlaySchema.safeParse(p).success).toBe(true);
  });

  it('ESPN scoreboards', () => {
    for (const f of espnFiles.filter((f) => f.startsWith('scoreboard_'))) {
      const sb = EspnScoreboardSchema.parse(read(`espn/${f}`));
      for (const e of sb.events) expect(EspnEventSchema.safeParse(e).success).toBe(true);
    }
  });

  it('ESPN teams, rosters and depth charts', () => {
    for (const f of espnFiles) {
      const data = read(`espn/${f}`);
      if (f.startsWith('team_')) EspnTeamResponseSchema.parse(data);
      if (f.startsWith('roster_')) EspnRosterSchema.parse(data);
      if (f.startsWith('depthchart_')) EspnDepthChartSchema.parse(data);
    }
  });

  it('Kalshi events snapshot', () => {
    const r = KalshiEventsResponseSchema.parse(read('kalshi/events_KXNFLGAME.json'));
    expect(r.events.length).toBeGreaterThan(0);
    for (const e of r.events) expect(KalshiEventSchema.safeParse(e).success).toBe(true);
  });
});
