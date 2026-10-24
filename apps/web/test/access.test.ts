import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EspnSummarySchema, type PlayEvent } from '@gridcast/types';
import { normalizeSummary } from '../../server/src/pipeline/normalize';
import { absX, FIELD_W } from '../src/field/geometry';
import {
  describePlay,
  fiveYardTicks,
  HAPTICS,
  outcomeOf,
  panFor,
  pitchFor,
  yardsToGoal,
} from '../src/lib/access';

const summary = EspnSummarySchema.parse(
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, '../../../data/fixtures/espn/summary_401873002.json'),
      'utf8',
    ),
  ),
);
const plays = normalizeSummary(summary)!.events.filter((e): e is PlayEvent => e.kind === 'play');
const teams = {
  home: { abbr: 'TB', shortName: 'Buccaneers' },
  away: { abbr: 'PIT', shortName: 'Steelers' },
};

describe('Access mode sound mapping', () => {
  it('pans with the ball from the left end line to the right', () => {
    expect(panFor(0)).toBe(-1);
    expect(panFor(FIELD_W / 2)).toBe(0);
    expect(panFor(FIELD_W)).toBe(1);
  });

  it('pitch rises as the offense nears the goal it attacks, both directions', () => {
    const o = { homeAbbr: 'TB' };
    // TB (home) drives right, PIT drives left. Own 20 vs opponent 20.
    for (const team of ['TB', 'PIT']) {
      const own20 = yardsToGoal(absX(team, 20, o), team, 'TB');
      const opp20 = yardsToGoal(absX(team, 80, o), team, 'TB');
      expect(own20).toBeCloseTo(80, 5);
      expect(opp20).toBeCloseTo(20, 5);
      expect(pitchFor(opp20)).toBeGreaterThan(pitchFor(own20));
    }
    expect(pitchFor(100)).toBe(220);
    expect(pitchFor(0)).toBe(880);
  });

  it('ticks once per 5 yards gained, never for lost yards', () => {
    expect(fiveYardTicks(0, 4)).toBe(0);
    expect(fiveYardTicks(4, 6)).toBe(1);
    expect(fiveYardTicks(6, 16)).toBe(2);
    expect(fiveYardTicks(10, 3)).toBe(0);
  });

  it('gives the walk-off touchdown, turnovers and first downs their own sound and buzz', () => {
    const ot = plays.find((p) => p.pre.quarter === 5 && p.parsed.result === 'td')!;
    expect(outcomeOf(ot)).toBe('td');
    expect(HAPTICS.td).toBeDefined();
    const pick = plays.find((p) => p.parsed.result === 'interception')!;
    expect(outcomeOf(pick)).toBe('turnover');
    const fd = plays.find((p) => p.parsed.firstDown && p.parsed.type === 'run')!;
    expect(outcomeOf(fd)).toBe('first_down');
    const inc = plays.find((p) => p.parsed.result === 'incomplete' && p.parsed.type === 'pass')!;
    expect(outcomeOf(inc)).toBe('incomplete');
  });

  it('describes a finished play for screen readers with the score and next situation', () => {
    const ot = plays.find((p) => p.pre.quarter === 5 && p.parsed.result === 'td')!;
    const text = describePlay(ot, 'Rodgers to Bernard. Touchdown.', teams);
    expect(text).toMatch(/^Rodgers to Bernard\. Touchdown\. Steelers 26, Buccaneers 19\./);
    const first = plays[1]!;
    expect(describePlay(first, undefined, teams)).toMatch(/(First|Second|Third|Fourth) and/);
  });
});
