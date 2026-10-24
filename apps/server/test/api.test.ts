import { describe, expect, it } from 'vitest';
import {
  EventsResponseSchema,
  GameDetailSchema,
  LoggedEventSchema,
  ScoreboardResponseSchema,
  StreamControlSchema,
} from '@gridcast/types';
import { DEMO, FEATURED, testServer } from './helpers.ts';

/** Reads SSE frames from a streaming Response until `stop` returns true. */
export async function readSse(
  res: Response,
  stop: (frames: { event: string; data: string }[]) => boolean,
) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const frames: { event: string; data: string }[] = [];
  while (!stop(frames)) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const raw = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const event = /^event: (.*)$/m.exec(raw)?.[1] ?? 'message';
      const data = raw
        .split('\n')
        .filter((l) => l.startsWith('data: '))
        .map((l) => l.slice(6))
        .join('\n');
      frames.push({ event, data });
    }
  }
  await reader.cancel();
  return frames;
}

describe('server API (fixtures only)', () => {
  it('GET /api/games returns this week with the featured game pinned first', async () => {
    const { app } = testServer();
    const res = await app.request('/api/games?season=2026&week=7');
    const body = ScoreboardResponseSchema.parse(await res.json());
    expect(body.games[0]?.id).toBe(FEATURED);
    expect(body.games[0]).toMatchObject({ featured: true, tv: 'NFL Network', status: 'pre' });
    expect(body.games[0]?.away.color).toBe('#FFB612');
    expect(body.games[0]?.home.color).toBe('#D3BC8D');
    expect(body.games.some((g) => g.id === DEMO && g.demo)).toBe(true);
    expect(body.dataSource).toBe('fixture');
  });

  it('GET /api/games/:id returns teams, rosters and depth chart', async () => {
    const { app } = testServer();
    const body = GameDetailSchema.parse(await (await app.request(`/api/games/${DEMO}`)).json());
    expect(body).toMatchObject({ status: 'final', source: 'replay', demo: true });
    expect(body.away.abbr).toBe('PIT');
    expect(body.rosters?.PIT?.some((p) => p.shortName === 'A.Rodgers' && p.jersey === 8)).toBe(
      true,
    );
    expect(body.depth?.PIT?.QB?.[0]?.lastName).toBe('Rodgers');
    expect(body.eventCount).toBeGreaterThan(200);
  });

  it('GET /api/games/:id 404s for unknown games', async () => {
    const { app } = testServer();
    expect((await app.request('/api/games/123456789')).status).toBe(404);
    expect((await app.request('/api/games/not-a-game')).status).toBe(404);
  });

  it('GET /api/games/:id/events supports catch-up from an offset', async () => {
    const { app } = testServer();
    const all = EventsResponseSchema.parse(
      await (await app.request(`/api/games/${DEMO}/events`)).json(),
    );
    const tail = EventsResponseSchema.parse(
      await (await app.request(`/api/games/${DEMO}/events?from=200`)).json(),
    );
    expect(tail.events[0]?.seq).toBe(200);
    expect(tail.next).toBe(all.next);
  });

  it('GET /api/games/:id/stream replays logged events over SSE', async () => {
    const { app } = testServer();
    const res = await app.request(`/api/games/${DEMO}/stream?speed=16&from=210`);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const frames = await readSse(res, (f) => f.filter((x) => x.event === 'game').length >= 3);
    const control = StreamControlSchema.parse(JSON.parse(frames[0]!.data));
    expect(control).toMatchObject({ type: 'status', source: 'replay' });
    const games = frames
      .filter((f) => f.event === 'game')
      .map((f) => LoggedEventSchema.parse(JSON.parse(f.data)));
    expect(games.map((g) => g.seq)).toEqual([210, 211, 212]);
  });
});
