/** Kalshi public market data (no auth). Validated with zod; failures are logged and skipped. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KalshiEventSchema, KalshiEventsResponseSchema, type KalshiEvent } from '@gridcast/types';
import { fetchJson, type Fetcher } from '../util/fetchJson.ts';

export const KALSHI_BASE = 'https://external-api.kalshi.com/trade-api/v2';
export const NFL_SERIES = 'KXNFLGAME';

export type KalshiClient = {
  /** Open NFL game events with their markets. */
  nflGames(): Promise<{ events: KalshiEvent[]; source: 'live' | 'fixture' } | undefined>;
};

export function createKalshiClient(opts: {
  fixturesDir: string;
  offline: boolean;
  base?: string;
  fetcher?: Fetcher;
}): KalshiClient {
  const base = opts.base ?? KALSHI_BASE;
  const toEvents = (raw: unknown[]) =>
    raw.flatMap((e) => {
      const p = KalshiEventSchema.safeParse(e);
      return p.success ? [p.data] : [];
    });
  return {
    async nflGames() {
      if (!opts.offline) {
        const r = await fetchJson(
          `${base}/events?series_ticker=${NFL_SERIES}&status=open&with_nested_markets=true&limit=200`,
          KalshiEventsResponseSchema,
          { ...(opts.fetcher ? { fetcher: opts.fetcher } : {}), timeoutMs: 4000 },
        );
        if (r.ok) return { events: toEvents(r.data.events), source: 'live' };
        return undefined;
      }
      const path = join(opts.fixturesDir, 'kalshi', `events_${NFL_SERIES}.json`);
      if (!existsSync(path)) return undefined;
      const parsed = KalshiEventsResponseSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
      return parsed.success
        ? { events: toEvents(parsed.data.events), source: 'fixture' }
        : undefined;
    },
  };
}
