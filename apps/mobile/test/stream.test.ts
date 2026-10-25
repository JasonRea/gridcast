import { afterEach, describe, expect, it } from 'vitest';
import type { LoggedEvent } from '@gridcast/types';
import { DEMO, testServer } from '../../server/test/helpers';
import { parseEvents } from '../src/api/client';
import type { FetchLike } from '../src/api/sse';
import { GameStream, nextBackoff, type ConnectionState } from '../src/api/stream';
import { useGame } from '../src/store/game';

const until = async (ok: () => boolean, ms = 8_000) => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};

function wire() {
  const server = testServer();
  const seen: { url: string; headers: Record<string, string> }[] = [];
  let fail = 0;
  const fetch: FetchLike = async (url, init) => {
    seen.push({ url, headers: init.headers ?? {} });
    if (fail > 0) {
      fail--;
      throw new TypeError('Network request failed');
    }
    const res = await server.app.request(url, {
      method: init.method ?? 'GET',
      headers: init.headers ?? {},
      ...(init.signal ? { signal: init.signal } : {}),
    });
    return { ok: res.ok, status: res.status, body: res.body };
  };
  const events = async (id: string): Promise<LoggedEvent[]> =>
    parseEvents(await (await server.app.request(`/api/games/${id}/events`)).json()).events;
  const streamUrl = (id: string, o: { from: number; speed?: number }) =>
    `/api/games/${id}/stream?from=${o.from}${o.speed ? `&speed=${o.speed}` : ''}`;
  return {
    server,
    seen,
    failNext: (n: number) => (fail = n),
    deps: { fetch, events, streamUrl },
  };
}

let open: GameStream | undefined;
afterEach(() => open?.close());

describe('GameStream against the fixture server', () => {
  it('catches up instantly, then follows the stream', async () => {
    const w = wire();
    const log = await w.deps.events(DEMO);
    const from = log.length - 4;
    const s = new GameStream(DEMO, 'replay', w.deps);
    open = s;
    const states: ConnectionState[] = [];
    s.onConnection = (c) => states.push(c);
    await s.start({ from, speed: 16 });
    const st = useGame.getState();
    expect(st.gameId).toBe(DEMO);
    expect(st.lastSeq).toBe(from - 1);
    expect(st.instant).toBe(true);
    const presentedAtStart = st.presented;
    expect(presentedAtStart).toBe(log.slice(0, from).filter((e) => e.event.kind === 'play').length);
    // Follow: the remaining events arrive over SSE, in order, once each.
    await until(() => useGame.getState().lastSeq === log.length - 1);
    expect(useGame.getState().connected).toBe(true);
    expect(states).toContain('open');
    expect(w.seen[0]!.url).toContain(`from=${from}`);
  });

  it('resumes after background with Last-Event-ID and no duplicates', async () => {
    const w = wire();
    const log = await w.deps.events(DEMO);
    const s = new GameStream(DEMO, 'replay', w.deps);
    open = s;
    await s.start({ from: log.length - 6, speed: 16 });
    await until(() => useGame.getState().lastSeq >= log.length - 5);
    s.sleep();
    const before = useGame.getState().lastSeq;
    expect(useGame.getState().connected).toBe(false);
    s.wake();
    await until(() => useGame.getState().lastSeq === log.length - 1);
    const reopened = w.seen[w.seen.length - 1]!;
    expect(reopened.url).toContain(`from=${before + 1}`);
    const received = useGame.getState().queue.map((q) => q.seq);
    expect(new Set(received).size).toBe(received.length);
  });

  it('retries with backoff after network errors, sending Last-Event-ID', async () => {
    const w = wire();
    const log = await w.deps.events(DEMO);
    const s = new GameStream(DEMO, 'replay', w.deps);
    open = s;
    await s.start({ from: log.length - 3, speed: 16 });
    await until(() => useGame.getState().connected);
    // Kill the connection and the next attempt; the one after that succeeds.
    w.failNext(1);
    s.sleep();
    s.wake();
    await until(() => w.seen.length >= 3, 5_000);
    // Wake asks with ?from=; the retry after the failure resumes with Last-Event-ID.
    expect(w.seen[1]!.headers['last-event-id']).toBeUndefined();
    expect(w.seen[2]!.headers['last-event-id']).toBeDefined();
    await until(() => useGame.getState().connected, 5_000);
    const retry = w.seen[w.seen.length - 1]!;
    expect(Number(retry.headers['last-event-id'])).toBeGreaterThanOrEqual(log.length - 4);
  });

  it('restarts on a kill-switch reset without a reload', async () => {
    const w = wire();
    const log = await w.deps.events(DEMO);
    const s = new GameStream(DEMO, 'replay', w.deps);
    open = s;
    await s.start({ from: log.length - 2, speed: 16 });
    await until(() => useGame.getState().connected);
    // Operator restarts the demo replay at seq 100 from the admin page.
    const res = await w.server.app.request('/api/admin/source', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
      body: JSON.stringify({ gameId: DEMO, source: 'replay', from: 100 }),
    });
    expect(res.ok).toBe(true);
    await until(
      () => useGame.getState().lastSeq >= 99 && useGame.getState().lastSeq < log.length - 3,
    );
    expect(useGame.getState().source).toBe('replay');
  });

  it('backs off 1 s doubling to 10 s', () => {
    const seq: number[] = [];
    let b: number | undefined;
    for (let i = 0; i < 6; i++) seq.push((b = nextBackoff(b)));
    expect(seq).toEqual([1000, 2000, 4000, 8000, 10000, 10000]);
  });
});
