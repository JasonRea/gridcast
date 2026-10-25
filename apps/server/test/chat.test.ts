import { describe, expect, it } from 'vitest';
import { runTool } from '../src/chat/tools.ts';
import { DEMO, testServer } from './helpers.ts';

describe('Ask-the-game tools on the fixture game', () => {
  it('game state', async () => {
    const s = (await testServer().registry.get(DEMO))!;
    expect(runTool(s, 'get_game_state', {})).toMatchObject({
      away: { abbr: 'PIT', score: 26 },
      home: { abbr: 'TB', score: 19 },
    });
  });

  it('filters plays and labels them by quarter and clock', async () => {
    const s = (await testServer().registry.get(DEMO))!;
    const { matching, plays } = runTool(s, 'get_plays', {
      quarter: 4,
      team: 'pit',
      type: 'fg',
    }) as { matching: number; plays: { when: string; text: string }[] };
    expect(matching).toBe(3);
    expect(plays.length).toBe(3);
    expect(plays.every((p) => p.when.startsWith('Q4 '))).toBe(true);
    expect(plays.map((p) => p.when)).toEqual(['Q4 8:08', 'Q4 1:55', 'Q4 1:21']);
  });

  it('counts are exact even when the list is cut short, and team totals add up', async () => {
    const s = (await testServer().registry.get(DEMO))!;
    const ints = runTool(s, 'get_plays', { result: 'interception', limit: 1 }) as {
      matching: number;
      plays: unknown[];
    };
    expect(ints.matching).toBe(3);
    expect(ints.plays).toHaveLength(1);
    const t = runTool(s, 'get_team_stats', {}) as Record<
      string,
      { interceptionsThrown: number; touchdowns: number; fieldGoals: number }
    >;
    expect(t.PIT!.interceptionsThrown + t.TB!.interceptionsThrown).toBe(3);
    // PIT 26 = 2 TD + 4 FG; TB 19 = 1 TD + 4 FG.
    expect(t.PIT!.touchdowns * 7 + t.PIT!.fieldGoals * 3).toBe(26);
    expect(t.TB!.touchdowns * 7 + t.TB!.fieldGoals * 3).toBe(19);
  });

  it('player stats by last name', async () => {
    const s = (await testServer().registry.get(DEMO))!;
    const r = runTool(s, 'get_player_stats', { name: 'Aaron Rodgers' }) as {
      team: string;
      passing: { td: number; att: number };
    };
    expect(r.team).toBe('PIT');
    expect(r.passing.td).toBe(2);
    expect(r.passing.att).toBeGreaterThan(20);
  });

  it('win probability history names the biggest swings', async () => {
    const s = (await testServer().registry.get(DEMO))!;
    const r = runTool(s, 'get_wp_history', {}) as {
      biggestSwings: { when: string }[];
      series: unknown[];
    };
    expect(r.biggestSwings).toHaveLength(8);
    expect(r.series.length).toBeGreaterThan(30);
  });

  it('rejects bad tool input instead of guessing', async () => {
    const s = (await testServer().registry.get(DEMO))!;
    expect(() => runTool(s, 'get_player_stats', {})).toThrow();
    expect(() => runTool(s, 'get_plays', { limit: 1000 })).toThrow();
    expect(() => runTool(s, 'nope', {})).toThrow();
  });

  it('the chat route is off without a Claude key', async () => {
    const { app } = testServer();
    const res = await app.request(`/api/games/${DEMO}/chat`, {
      method: 'POST',
      body: JSON.stringify({ question: 'Who won?' }),
    });
    expect(res.status).toBe(404);
  });
});
