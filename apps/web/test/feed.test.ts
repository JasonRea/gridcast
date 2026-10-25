import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EspnSummarySchema, type PlayEvent } from '@gridcast/types';
import { normalizeSummary } from '../../server/src/pipeline/normalize';
import { filterPlays } from '../src/components/game/PlayFeed';
import { firstPlayOfQuarter, startSeq } from '../src/lib/plays';

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

  it('credits a defensive score to the team whose score went up', () => {
    const td = plays.find((p) => p.parsed.points === 7)!;
    const pickSix: PlayEvent = {
      ...td,
      pre: { ...td.pre, possession: 'TB', away: 0, home: 0 },
      state: { ...td.state, away: 7, home: 0 },
    };
    const teams = { home: 'TB', away: 'PIT' };
    expect(filterPlays([pickSix], 'scoring', 'PIT', teams)).toHaveLength(1);
    expect(filterPlays([pickSix], 'scoring', 'TB', teams)).toHaveLength(0);
  });
});

describe('replay start point (?from=)', () => {
  const log = normalizeSummary(summary)!.events.map((event, seq) => ({ seq, event }));

  it('starts at a play index, a quarter or overtime', () => {
    const playSeqs = log.filter((e) => e.event.kind === 'play').map((e) => e.seq);
    expect(startSeq(log, '0')).toBe(playSeqs[0]);
    expect(startSeq(log, '120')).toBe(playSeqs[120]);
    const q4 = log.find((e) => e.seq === startSeq(log, 'q4'))!.event as PlayEvent;
    expect(q4.pre.quarter).toBe(4);
    const ot = log.find((e) => e.seq === startSeq(log, 'ot'))!.event as PlayEvent;
    expect(ot.pre.quarter).toBe(5);
    expect(firstPlayOfQuarter(log, 4)).toBe(startSeq(log, 'Q4'));
  });

  it('ignores junk and clamps past the end', () => {
    expect(startSeq(log, null)).toBeUndefined();
    expect(startSeq(log, 'banana')).toBeUndefined();
    const last = log.filter((e) => e.event.kind === 'play').at(-1)!.seq;
    expect(startSeq(log, '99999')).toBe(last);
  });
});
