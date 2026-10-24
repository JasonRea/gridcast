/** Zod schemas for Kalshi's public market-data REST API (no auth). Lenient on purpose. */
import { z } from 'zod';

const cents = z.number().optional();
const dollars = z.union([z.string(), z.number()]).optional();

export const KalshiMarketSchema = z.looseObject({
  ticker: z.string(),
  event_ticker: z.string().optional(),
  title: z.string().optional(),
  yes_sub_title: z.string().optional(),
  status: z.string().optional(),
  yes_bid: cents,
  yes_ask: cents,
  last_price: cents,
  yes_bid_dollars: dollars,
  yes_ask_dollars: dollars,
  last_price_dollars: dollars,
  volume: z.number().optional(),
  close_time: z.string().optional(),
});
export type KalshiMarket = z.infer<typeof KalshiMarketSchema>;

export const KalshiEventSchema = z.looseObject({
  event_ticker: z.string(),
  series_ticker: z.string().optional(),
  title: z.string().optional(),
  sub_title: z.string().optional(),
  markets: z.array(KalshiMarketSchema).optional(),
});
export type KalshiEvent = z.infer<typeof KalshiEventSchema>;

export const KalshiEventsResponseSchema = z.looseObject({
  _synthetic: z.boolean().optional(),
  events: z.array(z.unknown()),
  cursor: z.string().nullish(),
});

export const KalshiMarketsResponseSchema = z.looseObject({
  markets: z.array(z.unknown()),
  cursor: z.string().nullish(),
});

/** `*_dollars` fields are "0.4200"-style strings; convert to cents. */
function dollarsToCents(v: string | number | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n * 100 : undefined;
}

/**
 * Probability (0-1) that the market resolves YES: bid/ask midpoint when both sides are quoted,
 * else last trade. Returns undefined for an empty book.
 */
export function kalshiYesProb(m: KalshiMarket): number | undefined {
  const bid = m.yes_bid ?? dollarsToCents(m.yes_bid_dollars);
  const ask = m.yes_ask ?? dollarsToCents(m.yes_ask_dollars);
  const last = m.last_price ?? dollarsToCents(m.last_price_dollars);
  if (bid !== undefined && ask !== undefined && bid > 0 && ask > 0 && ask >= bid) {
    return (bid + ask) / 200;
  }
  if (last !== undefined && last > 0) return last / 100;
  return undefined;
}
