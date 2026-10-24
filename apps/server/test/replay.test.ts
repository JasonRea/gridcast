import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameEventSchema, type LoggedEvent } from '@gridcast/types';
import { EventLog } from '../src/log/eventLog.ts';
import {
  liveClock,
  PLAY_GAP_MAX,
  PLAY_GAP_MIN,
  replayClock,
  replaySchedule,
} from '../src/replay/clock.ts';
import { DEMO, testServer } from './helpers.ts';

afterEach(() => vi.useRealTimers());

async function collect(log: EventLog, speed: number) {
  vi.useFakeTimers();
  const start = Date.now();
  const got: LoggedEvent[] = [];
  const ctrl = new AbortController();
  const run = (async () => {
    for await (const m of replayClock(log, { from: 0, speed, signal: ctrl.signal })) {
      if (m.type === 'event') got.push(m.entry);
    }
  })();
  await vi.runAllTimersAsync();
  await run;
  return { got, elapsed: Date.now() - start };
}

describe('replay engine on the fixture game', () => {
  it.each([1, 8])('emits every logged event, schema-valid and in order, at %ix', async (speed) => {
    const { registry } = testServer();
    const s = (await registry.get(DEMO))!;
    const { got, elapsed } = await collect(s.log, speed);
    expect(got.length).toBe(s.log.length);
    expect(got.map((e) => e.seq)).toEqual([...Array(got.length).keys()]);
    for (const e of got) expect(GameEventSchema.safeParse(e.event).success).toBe(true);
    const total = replaySchedule(s.log.all()).at(-1)!;
    expect(elapsed).toBeGreaterThanOrEqual(total / speed - 5);
    expect(elapsed).toBeLessThanOrEqual(total / speed + 50);
  });

  it('paces plays 5-9 s apart at 1x and keeps commentary close behind', () => {
    const mk = (kind: 'play' | 'commentary', ts: number, seq: number): LoggedEvent =>
      kind === 'play'
        ? ({ seq, event: { kind: 'play', ts } } as unknown as LoggedEvent)
        : { seq, event: { kind: 'commentary', playId: 'x', ts, voice: 'pbp', text: 't' } };
    const sched = replaySchedule([
      mk('play', 0, 0),
      mk('commentary', 800, 1),
      mk('play', 60_000, 2),
      mk('play', 61_000, 3),
    ]);
    expect(sched).toEqual([0, 800, PLAY_GAP_MAX, PLAY_GAP_MAX + PLAY_GAP_MIN]);
  });
});

describe('live clock', () => {
  it('sends the backlog then follows appends', async () => {
    const log = new EventLog('t', '/tmp', false);
    log.append({ kind: 'odds', ts: 1, source: 'kalshi', market: 'moneyline', homeProb: 0.5 });
    const ctrl = new AbortController();
    const seen: number[] = [];
    const run = (async () => {
      for await (const m of liveClock(log, { from: 0, signal: ctrl.signal })) {
        if (m.type === 'event') seen.push(m.entry.seq);
        if (seen.length === 3) ctrl.abort();
      }
    })();
    await new Promise((r) => setTimeout(r, 5));
    log.append({ kind: 'odds', ts: 2, source: 'kalshi', market: 'moneyline', homeProb: 0.6 });
    log.append({ kind: 'odds', ts: 3, source: 'kalshi', market: 'moneyline', homeProb: 0.7 });
    await run;
    expect(seen).toEqual([0, 1, 2]);
  });
});
