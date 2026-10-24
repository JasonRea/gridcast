import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EspnSummarySchema,
  LoggedEventSchema,
  StreamControlSchema,
  type EspnSummary,
} from '@gridcast/types';
import { createApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createServices } from '../src/services.ts';
import { readSse } from './api.test.ts';
import { DEMO, testConfig } from './helpers.ts';

const full = EspnSummarySchema.parse(
  JSON.parse(readFileSync(join(loadConfig().fixturesDir, 'espn/summary_401873002.json'), 'utf8')),
);

/** The demo game as ESPN would have served it live, after `n` plays. */
function live(n: number): EspnSummary {
  const s = structuredClone(full);
  const comp = s.header.competitions[0]!;
  comp.status!.type = {
    ...comp.status!.type,
    state: 'in',
    completed: false,
    shortDetail: 'In progress',
  };
  let left = n;
  s.drives!.previous = s.drives!.previous!.flatMap((d) => {
    if (left <= 0) return [];
    const plays = d.plays.slice(0, left);
    left -= plays.length;
    return [{ ...d, plays }];
  });
  return s;
}

function liveServer() {
  let plays = 10;
  let espnUp = true;
  const fetcher = async (url: string) => {
    if (url.includes('/summary?event=') && espnUp) return Response.json(live(plays));
    return new Response('nope', { status: url.includes('/summary') ? 503 : 404 });
  };
  const config = { ...testConfig(), offline: false };
  const services = createServices(config, { fetcher, writer: null });
  const app = createApp(services);
  return {
    ...services,
    app,
    setPlays: (n: number) => (plays = n),
    setEspn: (up: boolean) => (espnUp = up),
  };
}

const auth = { authorization: 'Bearer secret', 'content-type': 'application/json' };

describe('live mode', () => {
  it('polls ESPN, appends only new plays and records every response', async () => {
    const srv = liveServer();
    const s = (await srv.registry.get(DEMO))!;
    expect(s.status).toBe('live');
    expect(s.source).toBe('live');
    const before = s.log.length;
    srv.setPlays(20);
    await srv.live.tick();
    expect(s.log.length).toBeGreaterThan(before);
    const ids = s.log.all().flatMap((e) => (e.event.kind === 'play' ? [e.event.id] : []));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps running when ESPN fails', async () => {
    const srv = liveServer();
    const s = (await srv.registry.get(DEMO))!;
    const plays = () => s.log.all().filter((e) => e.event.kind === 'play').length;
    const n = plays();
    srv.setEspn(false);
    await expect(srv.live.tick()).resolves.toBeUndefined();
    expect(plays()).toBe(n);
    srv.setEspn(true);
    srv.setPlays(15);
    await srv.live.tick();
    expect(plays()).toBeGreaterThan(n);
  });
});

describe('kill switch', () => {
  it('refuses without the admin token', async () => {
    const srv = liveServer();
    const body = JSON.stringify({ gameId: DEMO, source: 'replay' });
    expect((await srv.app.request('/api/admin/source', { method: 'POST', body })).status).toBe(401);
    expect(
      (
        await srv.app.request('/api/admin/source', {
          method: 'POST',
          body,
          headers: { authorization: 'Bearer nope' },
        })
      ).status,
    ).toBe(401);
    const off = createApp(
      createServices({ ...testConfig(), adminToken: undefined }, { writer: null }),
    );
    expect(
      (await off.request('/api/admin/source', { method: 'POST', body, headers: auth })).status,
    ).toBe(503);
  });

  it(
    'flips a connected live stream to replay and back without reconnecting',
    { timeout: 20_000 },
    async () => {
      const srv = liveServer();
      const s = (await srv.registry.get(DEMO))!;
      const res = await srv.app.request(`/api/games/${DEMO}/stream?from=0`);
      let flipped = false;
      let back = false;
      const frames = await readSse(res, (f) => {
        console.log(f.length, f.at(-1)?.event, f.at(-1)?.data.slice(0, 80), s.log.length);
        const controls = f
          .filter((x) => x.event === 'control')
          .map((x) => StreamControlSchema.parse(JSON.parse(x.data)));
        const games = f.filter((x) => x.event === 'game');
        if (!flipped && games.length >= s.log.length) {
          flipped = true;
          void srv.app.request('/api/admin/source', {
            method: 'POST',
            headers: auth,
            body: JSON.stringify({ gameId: DEMO, source: 'replay', speed: 16, from: 0 }),
          });
        }
        const resets = controls.filter((c) => c.type === 'reset');
        if (resets.length === 1 && !back && games.length >= s.log.length + 2) {
          back = true;
          void srv.app.request('/api/admin/source', {
            method: 'POST',
            headers: auth,
            body: JSON.stringify({ gameId: DEMO, source: 'live' }),
          });
        }
        return resets.length >= 2;
      });
      const controls = frames
        .filter((x) => x.event === 'control')
        .map((x) => StreamControlSchema.parse(JSON.parse(x.data)));
      const resets = controls.filter((c) => c.type === 'reset');
      expect(resets[0]).toMatchObject({ type: 'reset', source: 'replay', from: 0 });
      expect(resets[1]).toMatchObject({ type: 'reset', source: 'live' });
      // After the first reset the replay starts again from seq 0 on the same connection.
      const idx = frames.findIndex(
        (f) => f.event === 'control' && JSON.parse(f.data).type === 'reset',
      );
      const afterReset = frames.slice(idx).find((f) => f.event === 'game');
      expect(LoggedEventSchema.parse(JSON.parse(afterReset!.data)).seq).toBe(0);
      const status = await (
        await srv.app.request(`/api/admin/source?gameId=${DEMO}`, { headers: auth })
      ).json();
      expect(status).toMatchObject({ source: 'live' });
    },
  );
});
