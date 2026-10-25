import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Clip, PlayEvent } from '@gridcast/types';
import { matchPost, score } from '../src/clips/match.ts';
import { existsSync, readFileSync } from 'node:fs';
import { ClipPoller, trustedHandles, trustedPosts } from '../src/clips/poller.ts';
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
          author_id: 'u1',
        },
      ],
      includes: { users: [{ id: 'u1', username: 'steelers', verified_type: 'business' }] },
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

describe('reputable accounts only', () => {
  const allow = trustedHandles('TB', 'PIT');
  const post = (id: string, author: string) => ({
    id,
    text: 'Bernard touchdown',
    created_at: '2026-10-18T20:30:00Z',
    author_id: author,
  });

  it('allows the league, the broadcasters and the two teams', () => {
    expect(allow).toEqual(expect.arrayContaining(['NFL', 'NFLonFOX', 'Buccaneers', 'steelers']));
    expect(allow).not.toContain('Saints');
  });

  it('keeps only allowlisted authors that X verifies as organizations', () => {
    const res = {
      data: [post('1', 'a'), post('2', 'b'), post('3', 'c'), post('4', 'd'), post('5', 'missing')],
      includes: {
        users: [
          { id: 'a', username: 'Steelers', verified_type: 'business' }, // case differs: fine
          { id: 'b', username: 'steelers_fan', verified_type: 'business' }, // not on the list
          { id: 'c', username: 'NFL', verified_type: 'blue' }, // paid check, not an organization
          { id: 'd', username: 'NFL' }, // no verification info: dropped
        ],
      },
    };
    expect(trustedPosts(res, allow).map((p) => p.id)).toEqual(['1']);
  });
});

describe('finished games: clip backfill', () => {
  async function setup(nowAfterEnd: number) {
    const cfg = testConfig();
    const { registry } = testServer(cfg);
    const s = (await registry.get(DEMO))!;
    const plays = s.log
      .all()
      .flatMap((e) => (e.event.kind === 'play' ? [e.event as PlayEvent] : []));
    const td = plays.find((p) => p.raw.text.includes('G.Bernard for 6 yards, TOUCHDOWN'))!;
    const small = plays.find((p) => !p.big && p.parsed.type === 'run' && p.parsed.players.length)!;
    const smallName = small.parsed.players[0]!.name.split('.').pop()!;
    const urls: string[] = [];
    const users = [
      { id: 'team', username: 'steelers', verified_type: 'business' },
      { id: 'fake', username: 'steelersclips', verified_type: 'blue' },
    ];
    const at = (p: PlayEvent) => new Date(p.ts + 2 * 60_000).toISOString();
    const fetcher = async (url: string) => {
      urls.push(url);
      const page2 = url.includes('next_token=');
      const data = page2
        ? [
            {
              id: '20',
              text: `${smallName} up the middle, ${smallName}!`,
              created_at: at(small),
              author_id: 'team',
            },
          ]
        : [
            {
              id: '10',
              text: 'Rodgers to Bernard. TOUCHDOWN',
              created_at: at(td),
              author_id: 'team',
            },
            { id: '11', text: 'Bernard TOUCHDOWN Rodgers', created_at: at(td), author_id: 'fake' },
          ];
      return Response.json({ data, includes: { users }, meta: page2 ? {} : { next_token: 'p2' } });
    };
    const last = plays[plays.length - 1]!.ts;
    const poller = new ClipPoller(registry, {
      bearer: 'x',
      fetcher,
      cacheDir: cfg.cacheDir,
      now: () => last + nowAfterEnd,
    });
    return { cfg, registry, poller, td, small, urls };
  }

  it('searches the game window once, keeps trusted posts on big plays, rebuilds the log', async () => {
    const { cfg, registry, poller, td, small, urls } = await setup(24 * 3600_000);
    await poller.backfill((await registry.get(DEMO))!);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('expansions=author_id');
    expect(urls[0]).toContain('user.fields=username,verified_type');
    expect(urls[0]).toMatch(/start_time=.*&end_time=/);
    const saved = JSON.parse(readFileSync(join(cfg.cacheDir, 'clips', `${DEMO}.json`), 'utf8')) as {
      playId: string;
      url: string;
    }[];
    // The verified team post on the TD; not the look-alike, not the routine run.
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      playId: td.id,
      url: 'https://x.com/i/status/10',
      text: 'Rodgers to Bernard. TOUCHDOWN',
    });
    expect(saved.some((c) => c.playId === small.id)).toBe(false);
    const clip = (await registry.get(DEMO))!.log
      .all()
      .map((e) => e.event)
      .find((e) => e.kind === 'clip');
    expect(clip).toMatchObject({ playId: td.id, source: 'manual' });
    // Never searches the same finished game twice.
    await poller.backfill((await registry.get(DEMO))!);
    expect(urls).toHaveLength(2);
  });

  it('does nothing once the game is out of X search reach', async () => {
    const { cfg, registry, poller, urls } = await setup(8 * 24 * 3600_000);
    await poller.backfill((await registry.get(DEMO))!);
    expect(urls).toHaveLength(0);
    expect(existsSync(join(cfg.cacheDir, 'clips', `${DEMO}.json`))).toBe(false);
  });
});

describe('matching mistakes seen on real posts (PIT @ TB)', () => {
  async function plays() {
    const s = (await testServer().registry.get(DEMO))!;
    return s.log.all().flatMap((e) => (e.event.kind === 'play' ? [e.event as PlayEvent] : []));
  }
  const after = (p: PlayEvent, min = 2) => p.ts + min * 60_000;

  it('a different player with the same surname is not a match ("Kendal Daniels" vs J.Daniels)', async () => {
    const all = await plays();
    const daniels = all.find((p) => p.parsed.players.some((x) => x.name === 'J.Daniels'))!;
    const post = { id: 'a', text: 'Kendal Daniels makes the stop', createdAt: after(daniels) };
    expect(score(post, daniels)).toBe(0);
    expect(score({ ...post, text: 'Jalon Daniels keeps it' }, daniels)).toBeGreaterThan(0);
    expect(score({ ...post, text: 'Daniels keeps it' }, daniels)).toBeGreaterThan(0);
  });

  it('injury posts are never clips', async () => {
    const all = await plays();
    const td = all.find((p) => p.raw.text.includes('G.Bernard for 6 yards, TOUCHDOWN'))!;
    const post = {
      id: 'b',
      text: 'Prayers up for Germie Bernard 🙏 touchdown',
      createdAt: after(td),
    };
    expect(matchPost(post, all, 10 * 60_000)).toBeUndefined();
  });

  it('"ties it up" goes to the field goal, not the kickoff right after it', async () => {
    const all = await plays();
    const fg = all.find((p) => p.raw.text.includes('C.Boswell 58 yard field goal is GOOD'))!;
    const kick = all[all.indexOf(fg) + 1]!;
    expect(kick.parsed.type).toBe('kickoff');
    const post = { id: 'c', text: 'Chris Boswell ties it up!', createdAt: after(kick, 1) };
    expect(matchPost(post, all, 10 * 60_000)?.id).toBe(fg.id);
    const lead = {
      id: 'd',
      text: 'Chris Boswell gives the Steelers the lead!',
      createdAt: after(kick, 1),
    };
    const fg2 = all.find((p) => p.raw.text.includes('C.Boswell 20 yard field goal is GOOD'))!;
    expect(matchPost({ ...lead, createdAt: after(fg2, 1) }, all, 10 * 60_000)?.id).toBe(fg2.id);
  });
});
