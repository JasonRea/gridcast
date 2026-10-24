import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EspnSummarySchema,
  type DepthChart,
  type PlayEvent,
  type RosterPlayer,
} from '@gridcast/types';
// The server normalizer is pure; reuse it so this test runs on real fixture plays.
import { normalizeSummary } from '../../server/src/pipeline/normalize';
import { templateFor } from '../src/field/animate';
import { absX, FIELD_H, rel } from '../src/field/geometry';
import { buildLineup, frameOf, matchRoster } from '../src/field/lineup';

const o = { homeAbbr: 'TB' };
const roster: RosterPlayer[] = [
  {
    id: '1',
    name: 'Aaron Rodgers',
    shortName: 'A.Rodgers',
    lastName: 'Rodgers',
    jersey: 8,
    position: 'QB',
  },
  {
    id: '2',
    name: 'DK Metcalf',
    shortName: 'D.Metcalf',
    lastName: 'Metcalf',
    jersey: 4,
    position: 'WR',
  },
  {
    id: '3',
    name: 'Jaylen Warren',
    shortName: 'J.Warren',
    lastName: 'Warren',
    jersey: 30,
    position: 'RB',
  },
  {
    id: '4',
    name: 'Pat Freiermuth',
    shortName: 'P.Freiermuth',
    lastName: 'Freiermuth',
    jersey: 88,
    position: 'TE',
  },
];
const depth: DepthChart = {
  QB: [roster[0]!],
  WR: [roster[1]!],
  RB: [roster[2]!],
  TE: [roster[3]!],
};

const state = {
  quarter: 1,
  clock: '10:00',
  down: 1,
  distance: 10,
  yardLine: 30,
  possession: 'PIT',
  home: 0,
  away: 0,
  timeouts: { home: 3, away: 3 },
};
function play(parsed: Partial<PlayEvent['parsed']>, text = 'x'): PlayEvent {
  return {
    kind: 'play',
    id: '1',
    ts: 0,
    raw: { id: '1', text },
    parsed: {
      type: 'pass',
      result: 'complete',
      yards: 12,
      startYd: 30,
      endYd: 42,
      players: [],
      confidence: 0.95,
      formation: 'shotgun',
      ...parsed,
    },
    state: { ...state, yardLine: 42 },
    pre: state,
  };
}

describe('geometry', () => {
  it('home drives right, away drives left', () => {
    expect(absX('TB', 0, o)).toBe(100);
    expect(absX('PIT', 0, o)).toBe(1100);
    expect(absX('PIT', 30, o)).toBe(800);
    // Away offense: its right hand points up the screen.
    expect(rel('PIT', 30, 0, 5, o).y).toBeLessThan(FIELD_H / 2);
  });
});

describe('lineup', () => {
  it('puts 11 players per side and the named players in their slots', () => {
    const p = play({
      direction: 'left',
      players: [
        { role: 'passer', name: 'A.Rodgers', team: 'PIT', jersey: 8 },
        { role: 'receiver', name: 'D.Metcalf', team: 'PIT' },
        { role: 'tackler', name: 'Z.McCollum', team: 'TB', jersey: 24 },
      ],
    });
    const { players } = buildLineup({
      play: p,
      teams: { home: 'TB', away: 'PIT' },
      depth: { PIT: depth },
      rosters: { PIT: roster },
    });
    expect(players.filter((x) => x.side === 'off')).toHaveLength(11);
    expect(players.filter((x) => x.side === 'def')).toHaveLength(11);
    expect(players.find((x) => x.key === 'off:QB')).toMatchObject({
      name: 'Rodgers',
      jersey: 8,
      involved: true,
    });
    expect(players.find((x) => x.key === 'off:WR1')).toMatchObject({
      name: 'Metcalf',
      jersey: 4,
      involved: true,
    });
    expect(players.find((x) => x.role === 'tackler')).toMatchObject({
      name: 'McCollum',
      jersey: 24,
      team: 'TB',
    });
    expect(players.find((x) => x.key === 'off:RB')).toMatchObject({
      name: 'Warren',
      involved: false,
    });
    expect(new Set(players.map((x) => x.key)).size).toBe(22);
  });

  it('lines the kicking team up as offense on kickoffs listed under the receiver', () => {
    const p = play({
      type: 'kickoff',
      result: 'touchback',
      startYd: 65,
      endYd: 35,
      formation: 'kickoff',
    });
    const f = frameOf({ ...p, pre: { ...state, possession: 'TB' } }, { home: 'TB', away: 'PIT' });
    expect(f).toMatchObject({ offense: 'PIT', defense: 'TB', losYd: 35, endYd: 65 });
  });

  it('matches play-text names to the roster', () => {
    expect(matchRoster({ name: 'A.Rodgers' }, roster)?.id).toBe('1');
    expect(matchRoster({ name: 'X.Warren', jersey: 30 }, roster)?.id).toBe('3');
    expect(matchRoster({ name: 'Nobody' }, roster)).toBeUndefined();
  });
});

describe('templates', () => {
  it('maps every play type to one of the 10 templates', () => {
    expect(templateFor(play({ type: 'run', result: 'normal' }))).toBe('run');
    expect(templateFor(play({ type: 'pass', result: 'complete' }))).toBe('pass_complete');
    expect(templateFor(play({ type: 'pass', result: 'incomplete' }))).toBe('pass_incomplete');
    expect(templateFor(play({ type: 'pass', result: 'interception' }))).toBe('turnover');
    expect(templateFor(play({ type: 'run', result: 'fumble' }))).toBe('turnover');
    expect(templateFor(play({ type: 'sack', result: 'normal' }))).toBe('sack');
    expect(templateFor(play({ type: 'punt', result: 'normal' }))).toBe('kick');
    expect(templateFor(play({ type: 'kickoff', result: 'touchback' }))).toBe('kick');
    expect(templateFor(play({ type: 'fg', result: 'good' }))).toBe('field_goal');
    expect(templateFor(play({ type: 'penalty', result: 'normal' }))).toBe('penalty');
    expect(templateFor(play({ type: 'run', result: 'td' }))).toBe('touchdown');
    expect(templateFor(play({ type: 'kneel', result: 'normal' }))).toBe('kneel_spike');
    expect(templateFor(play({ type: 'run', confidence: 0.4 }))).toBe('generic');
  });

  it('builds a valid lineup and timeline template for every play in the fixture game', () => {
    const summary = EspnSummarySchema.parse(
      JSON.parse(
        readFileSync(
          join(import.meta.dirname, '../../../data/fixtures/espn/summary_401873002.json'),
          'utf8',
        ),
      ),
    );
    const events = normalizeSummary(summary)!.events.flatMap((e) => (e.kind === 'play' ? [e] : []));
    expect(events.length).toBeGreaterThan(150);
    for (const p of events) {
      const { players } = buildLineup({
        play: p,
        teams: { home: 'TB', away: 'PIT' },
        depth: {},
        rosters: {},
      });
      expect(players).toHaveLength(22);
      for (const pl of players)
        expect(Number.isFinite(pl.pos.x) && Number.isFinite(pl.pos.y)).toBe(true);
      expect(templateFor(p)).toBeTypeOf('string');
    }
  });
});
