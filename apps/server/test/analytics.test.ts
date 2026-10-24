import { describe, expect, it } from 'vitest';
import type { PlayEvent } from '@gridcast/types';
import { Analytics, loadTables } from '../src/analytics/model.ts';
import { loadConfig } from '../src/config.ts';
import { DEMO, testServer } from './helpers.ts';

const a = new Analytics(loadTables(loadConfig().assetsDir)!);
const st = (down: number, distance: number, yardLine: number) => ({
  quarter: 2,
  clock: '8:00',
  down,
  distance,
  yardLine,
  possession: 'PIT',
  home: 0,
  away: 0,
  timeouts: { home: 3, away: 3 },
});

describe('expected points table', () => {
  it('rises toward the end zone and falls with down', () => {
    expect(a.ep(1, 10, 25)).toBeLessThan(a.ep(1, 10, 50));
    expect(a.ep(1, 10, 50)).toBeLessThan(a.ep(1, 10, 90));
    expect(a.ep(3, 10, 50)).toBeLessThan(a.ep(1, 10, 50));
    expect(a.ep(1, 10, 98)).toBeGreaterThan(5);
  });
});

describe('4th-down bot', () => {
  it('goes for it on 4th & 1 near midfield', () => {
    expect(a.fourthDown(st(4, 1, 55))?.recommend).toBe('go');
  });
  it('punts on 4th & 10 deep in its own end', () => {
    expect(a.fourthDown(st(4, 10, 20))?.recommend).toBe('punt');
  });
  it('kicks on 4th & 8 at the opponent 15', () => {
    const c = a.fourthDown(st(4, 8, 85))!;
    expect(c.recommend).toBe('fg');
    expect(c.fgProb).toBeGreaterThan(0.8);
    expect(c.options.punt).toBeUndefined();
  });
});

describe('enrichment on the fixture game', () => {
  it('adds EPA to scrimmage plays and grades every 4th-down call', async () => {
    const { registry } = testServer();
    const s = (await registry.get(DEMO))!;
    const plays = s.log
      .all()
      .flatMap((e) => (e.event.kind === 'play' ? [e.event as PlayEvent] : []));
    const scrimmage = plays.filter(
      (p) => ['run', 'pass', 'sack'].includes(p.parsed.type) && p.pre.down,
    );
    expect(scrimmage.every((p) => typeof p.epa === 'number')).toBe(true);
    const tds = scrimmage.filter((p) => p.parsed.result === 'td');
    expect(tds.every((p) => (p.epa ?? 0) > 0)).toBe(true);
    const fourths = plays.filter((p) => p.pre.down === 4);
    expect(fourths.length).toBeGreaterThan(5);
    expect(fourths.every((p) => p.fourthDown?.recommend)).toBe(true);
    expect(fourths.filter((p) => p.fourthDown?.call).length).toBeGreaterThan(5);
    expect(plays.some((p) => p.nextFourthDown)).toBe(true);
  });
});
