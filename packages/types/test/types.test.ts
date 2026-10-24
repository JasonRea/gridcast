import { describe, expect, it } from 'vitest';
import {
  GameEventSchema,
  kalshiYesProb,
  luminance,
  matchupColors,
  normalizeAbbr,
  SAINTS,
  STEELERS,
  teamColors,
  TEAM_ABBRS,
  NEAR_BLACK,
} from '../src/index.ts';

const state = {
  quarter: 1,
  clock: '15:00',
  yardLine: 25,
  possession: 'PIT',
  home: 0,
  away: 0,
  timeouts: { home: 3, away: 3 },
};

describe('team colors', () => {
  it('hardcodes PIT and NO from the PRD', () => {
    expect(teamColors('PIT')).toBe(STEELERS);
    expect(teamColors('NO')).toBe(SAINTS);
    expect(STEELERS.display).toBe('#FFB612');
    expect(SAINTS.display).toBe('#D3BC8D');
    expect(STEELERS.number).toBe('#101820');
    expect(SAINTS.number).toBe('#101820');
  });

  it('never picks a near-black display color', () => {
    for (const abbr of TEAM_ABBRS) {
      expect(luminance(teamColors(abbr).display)).toBeGreaterThanOrEqual(NEAR_BLACK);
    }
  });

  it('falls back from a near-black ESPN primary', () => {
    const c = teamColors('XXX', { color: '0b162a', alternateColor: 'c83803' });
    expect(c.display).toBe('#C83803');
  });

  it('keeps PIT gold and NO old gold distinct', () => {
    const m = matchupColors(SAINTS, STEELERS);
    expect(m.away.display).toBe('#FFB612');
  });

  it('normalizes nflverse abbreviations', () => {
    expect(normalizeAbbr('LA')).toBe('LAR');
    expect(normalizeAbbr('was')).toBe('WSH');
  });
});

describe('GameEvent schema', () => {
  it('accepts each event kind', () => {
    const events = [
      {
        kind: 'play',
        id: '1',
        ts: 1,
        raw: { id: '1', text: 'x' },
        parsed: {
          type: 'run',
          result: 'normal',
          yards: 3,
          startYd: 25,
          endYd: 28,
          players: [],
          confidence: 0.9,
        },
        state,
        pre: state,
      },
      { kind: 'stoppage', id: 's1', ts: 2, reason: 'timeout', detail: 'Timeout', state },
      { kind: 'odds', ts: 3, source: 'kalshi', market: 'moneyline', homeProb: 0.42 },
      { kind: 'commentary', playId: '1', ts: 4, voice: 'pbp', text: 'Run for 3.' },
      { kind: 'clip', playId: '1', ts: 5, url: 'https://x.com/NFL/status/1', source: 'x' },
    ];
    for (const e of events) expect(GameEventSchema.safeParse(e).success).toBe(true);
  });

  it('rejects an unknown kind', () => {
    expect(GameEventSchema.safeParse({ kind: 'nope', ts: 1 }).success).toBe(false);
  });
});

describe('kalshiYesProb', () => {
  it('uses the bid/ask midpoint', () => {
    expect(kalshiYesProb({ ticker: 't', yes_bid: 40, yes_ask: 44 })).toBeCloseTo(0.42);
  });
  it('reads dollar-string fields', () => {
    expect(
      kalshiYesProb({ ticker: 't', yes_bid_dollars: '0.6100', yes_ask_dollars: '0.6300' }),
    ).toBeCloseTo(0.62);
  });
  it('falls back to last price and handles empty books', () => {
    expect(kalshiYesProb({ ticker: 't', last_price: 55 })).toBeCloseTo(0.55);
    expect(kalshiYesProb({ ticker: 't' })).toBeUndefined();
  });
});
