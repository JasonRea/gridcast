import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  OddsTickSchema,
  ScoreboardResponseSchema,
  type KalshiEvent,
  type OddsTick,
} from '@gridcast/types';
import { createKalshiClient } from '../src/kalshi/client.ts';
import { candleProb, priceHistory } from '../src/kalshi/history.ts';
import { dateCode, matchGame } from '../src/kalshi/match.ts';
import { OddsService } from '../src/kalshi/poller.ts';
import { DEMO, FEATURED, testConfig, testServer } from './helpers.ts';

const PIT_NO = { home: 'NO', away: 'PIT', kickoff: '2026-10-25T09:30:00-04:00' };

function event(home: number, away: number): KalshiEvent {
  return {
    event_ticker: 'KXNFLGAME-26OCT25PITNO',
    markets: [
      { ticker: 'KXNFLGAME-26OCT25PITNO-PIT', yes_bid: away - 1, yes_ask: away + 1 },
      { ticker: 'KXNFLGAME-26OCT25PITNO-NO', yes_bid: home - 1, yes_ask: home + 1 },
    ],
  };
}

describe('Kalshi matching', () => {
  it('builds the Eastern-date ticker code', () => {
    expect(dateCode(PIT_NO.kickoff)).toBe('26OCT25');
    expect(dateCode('2026-10-26T20:15:00-04:00')).toBe('26OCT26');
  });

  it('finds PIT vs NO in the saved snapshot and reads the home price', async () => {
    const cfg = testConfig();
    const res = await createKalshiClient({
      fixturesDir: cfg.fixturesDir,
      offline: true,
    }).nflGames();
    const m = matchGame(res!.events, PIT_NO);
    expect(m?.ticker).toMatch(/^KXNFLGAME-26OCT25PITNO-/);
    expect(m!.homeProb).toBeGreaterThan(0.3);
    expect(m!.homeProb).toBeLessThan(0.5);
  });

  it('ignores other games and tolerates empty books', () => {
    expect(matchGame([event(40, 60)], { ...PIT_NO, home: 'TB' })).toBeUndefined();
    expect(
      matchGame(
        [{ event_ticker: 'KXNFLGAME-26OCT25PITNO', markets: [{ ticker: 'x-NO' }] }],
        PIT_NO,
      ),
    ).toBeUndefined();
  });
});

describe('odds poller', () => {
  it('publishes an odds event when the price moves, and only then', async () => {
    const { registry } = testServer();
    const session = (await registry.get(FEATURED))!;
    const prices = [
      [40, 60],
      [40, 60],
      [46, 54],
    ];
    let i = 0;
    const client = {
      nflGames: async () => ({
        events: [event(...(prices[Math.min(i++, 2)] as [number, number]))],
        source: 'live' as const,
      }),
    };
    const odds = new OddsService(client, registry, { featuredGameId: FEATURED, intervalMs: 5000 });
    await odds.poll();
    await odds.poll();
    await odds.poll();
    const ticks = session.log
      .all()
      .map((e) => e.event)
      .filter((e): e is OddsTick => e.kind === 'odds');
    expect(ticks.map((t) => t.homeProb)).toEqual([0.4, 0.46]);
    expect(odds.homeProb(FEATURED)).toBe(0.46);
  });

  it('a failed Kalshi call is skipped, not thrown', async () => {
    const { registry } = testServer();
    await registry.get(FEATURED);
    const odds = new OddsService({ nflGames: async () => undefined }, registry, {
      featuredGameId: FEATURED,
      intervalMs: 5000,
    });
    await expect(odds.poll()).resolves.toBeUndefined();
  });

  it('scoreboard cards carry the Kalshi price', async () => {
    const { app } = testServer();
    const body = ScoreboardResponseSchema.parse(
      await (await app.request('/api/games?season=2026&week=7')).json(),
    );
    // Real fixture price (0.395 when saved); tolerance covers re-fetching it.
    expect(body.games.find((g) => g.id === FEATURED)?.kalshiHomeProb).toBeCloseTo(0.4, 1);
  });
});

describe('Kalshi price history in the demo replay', () => {
  it('reads both team markets into a home probability series', () => {
    const pts = priceHistory(join(testConfig().fixturesDir, 'kalshi'), {
      home: 'TB',
      away: 'PIT',
      kickoff: '2026-10-18T17:00Z',
    });
    expect(pts.length).toBeGreaterThan(200);
    expect(pts.every((p) => p.homeProb > 0 && p.homeProb < 1)).toBe(true);
    // TB lost: by the end the market has TB near zero.
    expect(pts.at(-1)!.homeProb).toBeLessThan(0.1);
  });

  it('weaves odds ticks into the replay log, in time order, one move per gap at most', async () => {
    const s = (await testServer().registry.get(DEMO))!;
    const events = s.log.all().map((e) => e.event);
    const ticks = events.filter((e): e is OddsTick => e.kind === 'odds');
    expect(ticks.length).toBeGreaterThan(20);
    expect(ticks.every((t) => OddsTickSchema.safeParse(t).success)).toBe(true);
    expect(ticks[0]!.ticker).toMatch(/^KXNFLGAME-26OCT18PITTB-/);
    // Pregame price comes before the opening kickoff.
    expect(events.findIndex((e) => e.kind === 'odds')).toBeLessThan(
      events.findIndex((e) => e.kind === 'play'),
    );
    // Never two ticks without a play between them.
    let sincePlay = 0;
    for (const e of events) {
      if (e.kind === 'play') sincePlay = 0;
      if (e.kind === 'odds') expect(++sincePlay).toBe(1);
    }
    for (let i = 1; i < ticks.length; i++)
      expect(ticks[i]!.ts).toBeGreaterThanOrEqual(ticks[i - 1]!.ts);
  });

  it('candle prices use the bid/ask mid, then the last trade', () => {
    expect(
      candleProb({
        end_period_ts: 1,
        yes_bid: { close_dollars: '0.45' },
        yes_ask: { close_dollars: '0.47' },
      }),
    ).toBeCloseTo(0.46, 5);
    expect(candleProb({ end_period_ts: 1, price: { close_dollars: '0.3' } })).toBe(0.3);
    expect(candleProb({ end_period_ts: 1, price: { close_dollars: null } })).toBeUndefined();
  });
});
