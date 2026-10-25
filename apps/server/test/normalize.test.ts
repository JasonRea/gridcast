import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EspnSummarySchema,
  GameEventSchema,
  type PlayEvent,
  type StoppageEvent,
} from '@gridcast/types';
import { loadConfig } from '../src/config.ts';
import {
  GameNormalizer,
  metaFromSummary,
  normalizeSummary,
  playsFromSummary,
} from '../src/pipeline/normalize.ts';

const summary = EspnSummarySchema.parse(
  JSON.parse(readFileSync(join(loadConfig().fixturesDir, 'espn/summary_401873002.json'), 'utf8')),
);
const { events } = normalizeSummary(summary)!;
const plays = events.filter((e): e is PlayEvent => e.kind === 'play');
const stops = events.filter((e): e is StoppageEvent => e.kind === 'stoppage');
/** "0:40" and "00:40" are the same clock (ESPN does not zero-pad minutes). */
const clockSeconds = (c: string) => {
  const [m, sec] = c.split(':').map(Number);
  return (m ?? 0) * 60 + (sec ?? 0);
};

describe('normalizer on the demo game', () => {
  it('emits only schema-valid events', () => {
    for (const e of events) expect(GameEventSchema.safeParse(e).success).toBe(true);
  });

  it('ends with the final score PIT 26, TB 19', () => {
    const last = plays[plays.length - 1]!;
    expect(last.state.away).toBe(26);
    expect(last.state.home).toBe(19);
  });

  it('turns every timeout and period end into a stoppage card', () => {
    const timeouts = stops.filter((s) => s.reason === 'timeout');
    expect(timeouts.length).toBe(12);
    expect(timeouts.every((t) => /Timeouts left/.test(t.detail))).toBe(true);
    expect(stops.some((s) => s.reason === 'halftime')).toBe(true);
    expect(stops.filter((s) => s.reason === 'quarter_end').length).toBeGreaterThanOrEqual(3);
    // Q2, Q4 and overtime each have a two-minute warning.
    expect(stops.filter((s) => s.reason === 'two_minute').length).toBe(3);
  });

  it('never charges a TV break ("Official Timeout") to a team', () => {
    const timeouts = stops.filter((s) => s.reason === 'timeout');
    expect(timeouts.some((t) => /official/i.test(`${t.title} ${t.detail}`))).toBe(false);
    // PIT's first timeout of the game came at 3:46 in Q1, not at the 10:51 TV break.
    const pitFirst = timeouts.find((t) => t.team === 'PIT');
    expect(pitFirst?.state.quarter).toBe(1);
    expect(clockSeconds(pitFirst!.state.clock)).toBe(3 * 60 + 46);
    expect(pitFirst?.detail).toMatch(/timeout #1\b/);
  });

  it('tracks timeouts left per half', () => {
    const tbThird = stops.find(
      (s) =>
        s.reason === 'timeout' &&
        /TB|Buccaneers/.test(s.title ?? '') &&
        s.state.quarter === 4 &&
        clockSeconds(s.state.clock) === 40,
    );
    expect(tbThird?.state.timeouts.home).toBe(0);
  });

  it('explains accepted penalties in plain English', () => {
    const pens = stops.filter((s) => s.reason === 'penalty');
    expect(pens.length).toBeGreaterThan(3);
    const dpi = pens.find((p) => /Pass Interference/i.test(p.title ?? ''));
    expect(dpi?.detail).toMatch(/illegally/);
  });

  it('carries pre-snap and post-play state and win probability', () => {
    const p = plays.find((x) => x.raw.text.includes('R.Dowdle up the middle to TB 49'))!;
    expect(p.pre).toMatchObject({ down: 1, distance: 10, yardLine: 38, possession: 'PIT' });
    expect(p.state.yardLine).toBe(51);
    expect(p.wpAfter).toBeTypeOf('number');
    expect(p.wpBefore).toBeTypeOf('number');
  });

  it('flags big plays (scores, turnovers, 3rd/4th down)', () => {
    const big = plays.filter((p) => p.big);
    expect(big.some((p) => p.parsed.result === 'td')).toBe(true);
    expect(big.some((p) => p.parsed.result === 'interception')).toBe(true);
  });

  it('is incremental: re-ingesting the same plays emits nothing', () => {
    const n = new GameNormalizer(metaFromSummary(summary)!);
    const all = playsFromSummary(summary);
    const first = all.flatMap(({ play }) => n.ingest(play));
    const again = all.flatMap(({ play }) => n.ingest(play));
    expect(first.length).toBe(events.length);
    expect(again).toEqual([]);
  });

  it('skips a malformed play instead of failing the game', () => {
    const broken = structuredClone(summary);
    (broken.drives!.previous![0]!.plays as unknown[]).splice(1, 0, { nope: true });
    expect(normalizeSummary(broken)!.events.length).toBe(events.length);
  });
});
