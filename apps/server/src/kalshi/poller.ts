/**
 * Polls Kalshi every 5 s. One request covers every open NFL game: live sessions get an `odds`
 * event whenever the price moves; the scoreboard reads the latest price per game.
 */
import type { OddsTick } from '@gridcast/types';
import type { GameRegistry } from '../games/registry.ts';
import type { GameSession } from '../games/session.ts';
import { log } from '../util/logger.ts';
import type { KalshiClient } from './client.ts';
import { matchGame, type MatchedOdds } from './match.ts';

/** Price moves smaller than this (in probability) are not worth an event. */
const MIN_MOVE = 0.005;
/** Sessions nobody has looked at for this long stop polling (the featured game never stops). */
const IDLE_MS = 5 * 60_000;

export class OddsService {
  private latest = new Map<string, MatchedOdds & { at: number }>();
  private lastFetch = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private inflight: Promise<void> | undefined;

  constructor(
    private readonly client: KalshiClient,
    private readonly registry: GameRegistry,
    private readonly opts: { featuredGameId: string; intervalMs: number },
  ) {}

  /** Latest Kalshi home probability for a game, if matched. */
  homeProb(gameId: string): number | undefined {
    return this.latest.get(gameId)?.homeProb;
  }

  private watched(s: GameSession): boolean {
    if (s.status === 'final' || s.source === 'replay') return false;
    return s.gameId === this.opts.featuredGameId || Date.now() - s.lastViewed < IDLE_MS;
  }

  /** Fetches once and updates every game passed in (scoreboard cards and live sessions). */
  async poll(
    cards: { id: string; home: { abbr: string }; away: { abbr: string }; kickoff: string }[] = [],
  ): Promise<void> {
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      const res = await this.client.nflGames();
      this.lastFetch = Date.now();
      if (!res) return;
      const sessions = this.registry.loaded().filter((s) => this.watched(s));
      const games = new Map<string, { home: string; away: string; kickoff: string }>();
      for (const c of cards)
        games.set(c.id, { home: c.home.abbr, away: c.away.abbr, kickoff: c.kickoff });
      for (const s of sessions)
        games.set(s.gameId, {
          home: s.card.home.abbr,
          away: s.card.away.abbr,
          kickoff: s.card.kickoff,
        });
      for (const [id, g] of games) {
        const m = matchGame(res.events, g);
        if (!m) continue;
        const prev = this.latest.get(id);
        this.latest.set(id, { ...m, at: Date.now() });
        const session = sessions.find((s) => s.gameId === id);
        if (
          session &&
          (!prev || Math.abs(prev.homeProb - m.homeProb) >= MIN_MOVE || !this.hasOdds(session))
        ) {
          const tick: OddsTick = {
            kind: 'odds',
            ts: Date.now(),
            source: 'kalshi',
            market: 'moneyline',
            homeProb: m.homeProb,
            ticker: m.ticker,
          };
          session.publish([tick]);
        }
      }
    })()
      .catch((e: unknown) => log.warn('odds poll failed', { error: (e as Error).message }))
      .finally(() => {
        this.inflight = undefined;
      });
    return this.inflight;
  }

  private hasOdds(s: GameSession): boolean {
    return s.log.all().some((e) => e.event.kind === 'odds');
  }

  /** Scoreboard helper: refresh at most every 30 s, then fill kalshiHomeProb. */
  async forCards<
    T extends {
      id: string;
      home: { abbr: string };
      away: { abbr: string };
      kickoff: string;
      status: string;
    },
  >(cards: T[]): Promise<(T & { kalshiHomeProb?: number })[]> {
    if (Date.now() - this.lastFetch > 30_000)
      await this.poll(cards.filter((c) => c.status !== 'final'));
    return cards.map((c) => {
      const p = c.status === 'final' ? undefined : this.homeProb(c.id);
      return p === undefined ? c : { ...c, kalshiHomeProb: p };
    });
  }

  start(): void {
    this.stop();
    this.timer = setInterval(() => void this.poll(), this.opts.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
