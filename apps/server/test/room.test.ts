import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { RoomResponseSchema } from '@gridcast/types';
import { replaySchedule } from '../src/replay/clock.ts';
import { roomRoutes } from '../src/routes/room.ts';
import { DEMO, FEATURED, testServer } from './helpers.ts';

function setup() {
  const { registry, config } = testServer();
  let t = 1_000_000;
  const app = new Hono();
  roomRoutes(app, { config, registry, now: () => t });
  return { app, registry, advance: (ms: number) => (t += ms) };
}

const post = (app: Hono, id: string, body: unknown) =>
  app.request(`/api/games/${id}/room`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('phones in the room', () => {
  it('a phone joins on the play the projector is showing, at its speed', async () => {
    const { app, registry, advance } = setup();
    const s = (await registry.get(DEMO))!;
    const entries = s.log.all();
    const firstQ4 = entries.find((e) => e.event.kind === 'play' && e.event.pre.quarter === 4)!;
    expect((await post(app, DEMO, { from: firstQ4.seq, speed: 2 })).status).toBe(200);

    const at = async () =>
      RoomResponseSchema.parse(await (await app.request(`/api/games/${DEMO}/room`)).json());
    expect((await at()).seq).toBe(firstQ4.seq);

    // 30 s of wall clock at 2x = 60 s of replay schedule.
    advance(30_000);
    const now = await at();
    expect(now.speed).toBe(2);
    const from = s.log.from(firstQ4.seq);
    const sch = replaySchedule(from);
    const i = from.findIndex((e) => e.seq === now.seq);
    expect(from[i]!.event.kind).toBe('play');
    expect(sch[i]).toBeLessThanOrEqual(60_000);
    const nextPlay = from.findIndex((e, k) => k > i && e.event.kind === 'play');
    expect(sch[nextPlay]).toBeGreaterThan(60_000);
  });

  it('live games and games without a host just report the source', async () => {
    const { app } = setup();
    const live = RoomResponseSchema.parse(
      await (await app.request(`/api/games/${FEATURED}/room`)).json(),
    );
    expect(live.seq).toBeUndefined();
    const idle = RoomResponseSchema.parse(
      await (await app.request(`/api/games/${DEMO}/room`)).json(),
    );
    expect(idle.source).toBe('replay');
    expect(idle.seq).toBeUndefined();
  });

  it('/r opens the hosted game in radio mode, else the featured game', async () => {
    const { app } = setup();
    expect((await app.request('/r')).headers.get('location')).toBe(
      `/game/${FEATURED}?mode=radio&room=1`,
    );
    await post(app, DEMO, { from: 0, speed: 4 });
    expect((await app.request('/r')).headers.get('location')).toBe(
      `/game/${DEMO}?mode=radio&room=1`,
    );
  });

  it('rejects bad input', async () => {
    const { app } = setup();
    expect((await post(app, DEMO, { from: -1, speed: 2 })).status).toBe(400);
    expect((await post(app, DEMO, { from: 0, speed: 99 })).status).toBe(400);
  });
});
