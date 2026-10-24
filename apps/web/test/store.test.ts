import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoggedEvent, PlayEvent } from '@gridcast/types';
import { useGame } from '../src/store/game';

const state = {
  quarter: 1,
  clock: '10:00',
  yardLine: 30,
  possession: 'PIT',
  home: 0,
  away: 0,
  timeouts: { home: 3, away: 3 },
};
const play = (id: string, seq: number): LoggedEvent => ({
  seq,
  event: {
    kind: 'play',
    id,
    ts: seq,
    raw: { id, text: id },
    parsed: {
      type: 'run',
      result: 'normal',
      yards: 3,
      startYd: 30,
      endYd: 33,
      players: [],
      confidence: 0.9,
    },
    state: { ...state, yardLine: 33 },
    pre: state,
    wpAfter: 0.4,
  } satisfies PlayEvent,
});
const line = (playId: string, seq: number): LoggedEvent => ({
  seq,
  event: { kind: 'commentary', playId, ts: seq, voice: 'pbp', text: `line ${playId}` },
});

beforeEach(() => useGame.getState().reset('g'));

describe('presentation queue', () => {
  it('animates one play at a time, then shows its commentary', () => {
    const g = useGame.getState();
    g.receive(play('a', 0));
    g.receive(line('a', 1));
    g.receive(play('b', 2));
    let s = useGame.getState();
    expect(s.current?.id).toBe('a');
    expect(s.presented).toBe(0);
    expect(s.queue).toHaveLength(2);
    s.finishPlay('a');
    s = useGame.getState();
    expect(s.presented).toBe(1);
    expect(s.commentary.a?.pbp).toBe('line a');
    expect(s.current?.id).toBe('b');
    expect(s.wp).toBe(0.4);
  });

  it('applies a catch-up backlog instantly', () => {
    useGame.getState().applyInstant([play('a', 0), line('a', 1), play('b', 2)]);
    const s = useGame.getState();
    expect(s.presented).toBe(2);
    expect(s.instant).toBe(true);
    expect(s.lastSeq).toBe(2);
    useGame.getState().receive(play('b', 2));
    expect(useGame.getState().queue).toHaveLength(0);
  });

  it('holds on a stoppage card before the next play', () => {
    vi.useFakeTimers();
    const g = useGame.getState();
    g.receive({
      seq: 0,
      event: { kind: 'stoppage', id: 's', ts: 0, reason: 'timeout', detail: 'Timeout', state },
    });
    g.receive(play('a', 1));
    expect(useGame.getState().card?.id).toBe('s');
    expect(useGame.getState().current).toBeUndefined();
    vi.advanceTimersByTime(3000);
    expect(useGame.getState().current?.id).toBe('a');
    vi.useRealTimers();
  });
});
