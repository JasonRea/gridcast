import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Clip, PlayEvent } from '@gridcast/types';
import { matchPost } from '../src/clips/match.ts';
import { ClipPoller } from '../src/clips/poller.ts';
import { DEMO, testConfig, testServer } from './helpers.ts';

async function demo() {
  const s = (await testServer().registry.get(DEMO))!;
  const plays = s.log.all().flatMap((e) => (e.event.kind === 'play' ? [e.event as PlayEvent] : []));
  const td = plays.find((p) => p.raw.text.includes('G.Bernard for 6 yards, TOUCHDOWN'))!;
  return { s, plays, td };
}

describe('clip matching', () => {
  it('matches a post to the play by time window and names', async () => {
    const { plays, td } = await demo();
    const post = {
      id: '1',
      text: 'Aaron Rodgers finds Bernard for the walk-off TOUCHDOWN in overtime!',
      createdAt: td.ts + 90_000,
    };
    expect(matchPost(post, plays)?.id).toBe(td.id);
  });

  it('ignores posts outside the 5 minute window or without enough signal', async () => {
    const { plays, td } = await demo();
    expect(
      matchPost({ id: '2', text: 'Bernard touchdown!', createdAt: td.ts + 6 * 60_000 }, plays),
    ).toBeUndefined();
    expect(
      matchPost({ id: '3', text: 'What a game in Tampa', createdAt: td.ts + 60_000 }, plays),
    ).toBeUndefined();
  });
});

describe('clip poller', () => {
  it('publishes matched X posts as clip events, once', async () => {
    const { s, td } = await demo();
    const body = {
      data: [
        {
          id: '99',
          text: 'Rodgers to Bernard. TOUCHDOWN STEELERS',
          created_at: new Date(td.ts + 60_000).toISOString(),
        },
      ],
    };
    let auth = '';
    const fetcher = async (_url: string, init?: RequestInit) => {
      auth = (init?.headers as Record<string, string>).authorization ?? '';
      return Response.json(body);
    };
    const poller = new ClipPoller(testServer().registry, { bearer: 'xyz', fetcher });
    expect(poller.query(s)).toContain('from:steelers');
    expect(await poller.pollGame(s)).toBe(1);
    expect(await poller.pollGame(s)).toBe(0);
    expect(auth).toBe('Bearer xyz');
    const clip = s.log.all().find((e) => e.event.kind === 'clip')?.event as Clip;
    expect(clip).toMatchObject({ playId: td.id, url: 'https://x.com/i/status/99', source: 'x' });
  });

  it('adds hand-picked clips for a finished game when the log is built', async () => {
    const cfg = testConfig();
    const assetsDir = join(cfg.dataDir, 'assets');
    const { td } = await demo();
    mkdirSync(join(assetsDir, 'clips'), { recursive: true });
    writeFileSync(
      join(assetsDir, 'clips', `${DEMO}.json`),
      JSON.stringify([{ playId: td.id, url: 'https://x.com/NFL/status/1' }]),
    );
    const s = (await testServer({ ...cfg, assetsDir }).registry.get(DEMO))!;
    const events = s.log.all().map((e) => e.event);
    const i = events.findIndex((e) => e.kind === 'clip');
    expect(events[i]).toMatchObject({ playId: td.id, source: 'manual' });
  });
});
