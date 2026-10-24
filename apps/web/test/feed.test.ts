import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EspnSummarySchema, type PlayEvent } from '@gridcast/types';
import { normalizeSummary } from '../../server/src/pipeline/normalize';
import { filterPlays } from '../src/components/game/PlayFeed';

const summary = EspnSummarySchema.parse(
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, '../../../data/fixtures/espn/summary_401873002.json'),
      'utf8',
    ),
  ),
);
const plays = normalizeSummary(summary)!.events.filter((e): e is PlayEvent => e.kind === 'play');

describe('play feed filters', () => {
  it('scoring plays: every score in PIT 26, TB 19 and nothing else', () => {
    const scoring = filterPlays(plays, 'scoring').map(({ p }) => p);
    const points = scoring.reduce((a, p) => a + (p.parsed.points ?? 0), 0);
    expect(points).toBe(26 + 19);
    expect(scoring.every((p) => (p.parsed.points ?? 0) > 0)).toBe(true);
  });

  it('keeps each play’s index into the full list so clicks replay the right play', () => {
    for (const { p, i } of filterPlays(plays, 'turnovers')) expect(plays[i]).toBe(p);
  });

  it('filters by team', () => {
    const pit = filterPlays(plays, 'scoring', 'PIT').reduce(
      (a, { p }) => a + (p.parsed.points ?? 0),
      0,
    );
    expect(pit).toBe(26);
  });
});
