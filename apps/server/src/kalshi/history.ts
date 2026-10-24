/**
 * Kalshi price history for finished games. A finished game's replay log gets the market's real
 * minute-by-minute prices as `odds` events, so the WP bar and the odds-vs-model chart show the
 * market next to the model. Prices come from saved candlestick files
 * (data/fixtures/kalshi/candles_<market ticker>.json, written by `pnpm fixtures:fetch`).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { normalizeAbbr, type GameEvent, type OddsTick } from '@gridcast/types';
import type { RebuildEnricher } from '../games/registry.ts';
import { log } from '../util/logger.ts';
import { NFL_SERIES } from './client.ts';
import { dateCode } from './match.ts';

/** Kalshi `/series/{s}/markets/{t}/candlesticks` response. Lenient: Kalshi is undocumented. */
const DollarOhlc = z.object({ close_dollars: z.string().nullish() }).partial().nullish();
const CandleSchema = z.object({
  end_period_ts: z.number(),
  yes_bid: DollarOhlc,
  yes_ask: DollarOhlc,
  price: DollarOhlc,
});
export const CandlesResponseSchema = z.object({
  ticker: z.string().optional(),
  candlesticks: z.array(z.unknown()),
});
type Candle = z.infer<typeof CandleSchema>;

/** Same move threshold as the live poller: smaller moves are not worth an event. */
const MIN_MOVE = 0.005;

const dollars = (s: string | null | undefined) => {
  if (s === null || s === undefined) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

/** Yes probability at the close of a candle: bid/ask mid, else the last trade. */
export function candleProb(c: Candle): number | undefined {
  const bid = dollars(c.yes_bid?.close_dollars);
  const ask = dollars(c.yes_ask?.close_dollars);
  if (bid !== undefined && ask !== undefined && bid > 0 && ask > 0 && ask >= bid)
    return (bid + ask) / 2;
  const last = dollars(c.price?.close_dollars);
  return last !== undefined && last > 0 ? last : undefined;
}

function loadCandles(dir: string, ticker: string): Map<number, number> | undefined {
  const path = join(dir, `candles_${ticker}.json`);
  if (!existsSync(path)) return undefined;
  const parsed = CandlesResponseSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.success) {
    log.warn('bad Kalshi candlestick file', { path });
    return undefined;
  }
  const out = new Map<number, number>();
  for (const raw of parsed.data.candlesticks) {
    const c = CandleSchema.safeParse(raw);
    if (!c.success) continue;
    const p = candleProb(c.data);
    if (p !== undefined) out.set(c.data.end_period_ts * 1000, p);
  }
  return out;
}

export type PricePoint = { ts: number; homeProb: number; ticker: string };

/**
 * Home win probability over time for a game, from the saved candles of both team markets
 * (normalized so the two sides sum to 1, like the live poller).
 */
export function priceHistory(
  dir: string,
  game: { home: string; away: string; kickoff: string },
): PricePoint[] {
  const home = normalizeAbbr(game.home);
  const away = normalizeAbbr(game.away);
  const event = `${NFL_SERIES}-${dateCode(game.kickoff)}${away}${home}`;
  const h = loadCandles(dir, `${event}-${home}`);
  const a = loadCandles(dir, `${event}-${away}`);
  if (!h && !a) return [];
  const times = [...new Set([...(h?.keys() ?? []), ...(a?.keys() ?? [])])].sort((x, y) => x - y);
  const out: PricePoint[] = [];
  for (const ts of times) {
    const ph = h?.get(ts);
    const pa = a?.get(ts);
    const p =
      ph !== undefined && pa !== undefined
        ? ph / (ph + pa)
        : (ph ?? (pa !== undefined ? 1 - pa : undefined));
    if (p === undefined || !Number.isFinite(p)) continue;
    out.push({
      ts,
      homeProb: Math.round(p * 1000) / 1000,
      ticker: h ? `${event}-${home}` : `${event}-${away}`,
    });
  }
  return out;
}

/**
 * Rebuild enricher: weaves the market's price into a finished game's log. Between two plays
 * only the latest price is kept, and only when it moved, so there is about one tick per play.
 */
export function kalshiHistory(dir: string): RebuildEnricher {
  return (session, events) => {
    if (session.status !== 'final' || events.some((e) => e.kind === 'odds')) return events;
    const points = priceHistory(dir, {
      home: session.card.home.abbr,
      away: session.card.away.abbr,
      kickoff: session.card.kickoff,
    });
    if (!points.length) return events;
    const out: GameEvent[] = [];
    let k = 0;
    let lastProb: number | undefined;
    let lastTs = -Infinity;
    const flushBefore = (ts: number) => {
      let latest: PricePoint | undefined;
      while (k < points.length && points[k]!.ts < ts) latest = points[k++];
      if (!latest) return;
      if (lastProb !== undefined && Math.abs(latest.homeProb - lastProb) < MIN_MOVE) return;
      lastProb = latest.homeProb;
      const tick: OddsTick = {
        kind: 'odds',
        ts: Math.max(latest.ts, lastTs),
        source: 'kalshi',
        market: 'moneyline',
        homeProb: latest.homeProb,
        ticker: latest.ticker,
      };
      out.push(tick);
    };
    for (const e of events) {
      if (e.kind === 'play') flushBefore(e.ts);
      out.push(e);
      lastTs = Math.max(lastTs, e.ts);
    }
    return out;
  };
}
