import { describe, expect, it } from 'vitest';
import { DEMO, testServer } from '../../server/test/helpers';
import { parseEvents, parseGame, parseScoreboard, setWarn } from '../src/api/client';

const warnings: string[] = [];
setWarn((m) => warnings.push(m));

async function json(path: string): Promise<Record<string, unknown>> {
  const { app } = testServer();
  return (await (await app.request(path)).json()) as Record<string, unknown>;
}

describe('API client schema handling (fixture server, no network)', () => {
  it('parses a real scoreboard and drops only the bad card', async () => {
    const raw = await json('/api/games?season=2026&week=7');
    const good = parseScoreboard(raw);
    expect(good.games.length).toBeGreaterThan(1);
    const games = raw.games as unknown[];
    const broken = { ...raw, games: [{ id: 42, status: 'nope' }, ...games] };
    warnings.length = 0;
    const out = parseScoreboard(broken);
    expect(out.games).toHaveLength(games.length);
    expect(warnings.some((w) => w.includes('game card'))).toBe(true);
  });

  it('throws on a scoreboard with no envelope', () => {
    expect(() => parseScoreboard({ hello: 'world' })).toThrow();
    expect(() => parseScoreboard(null)).toThrow();
  });

  it('keeps log order and skips malformed entries', async () => {
    const raw = await json(`/api/games/${DEMO}/events`);
    const ok = parseEvents(raw);
    expect(ok.events.length).toBeGreaterThan(500);
    const events = raw.events as unknown[];
    const broken = {
      ...raw,
      events: [events[0], { seq: -1, event: { kind: 'mystery' } }, 'junk', events[1]],
    };
    const out = parseEvents(broken);
    expect(out.events.map((e) => e.seq)).toEqual([0, 1]);
  });

  it('drops a bad optional block from game detail instead of losing the game', async () => {
    const raw = await json(`/api/games/${DEMO}`);
    expect(parseGame(raw).id).toBe(DEMO);
    const out = parseGame({ ...raw, preview: { storylines: 'not an array' }, depth: 7 });
    expect(out.id).toBe(DEMO);
    expect(out.preview).toBeUndefined();
    expect(out.depth).toBeUndefined();
    expect(out.rosters).toBeDefined();
    expect(() => parseGame({ ...raw, features: 'all' })).toThrow();
  });
});
