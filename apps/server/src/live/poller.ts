/**
 * Live ESPN polling. Every 10 s the featured game (and any live game someone is watching) is
 * fetched, every raw response is recorded to disk, and new plays go through the same normalizer
 * and event log as replays. The kill switch only changes the clock; recording continues.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EspnClient } from '../espn/client.ts';
import type { GameRegistry } from '../games/registry.ts';
import type { GameSession } from '../games/session.ts';
import { log } from '../util/logger.ts';

const IDLE_MS = 5 * 60_000;

export class LivePoller {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  /** Consecutive failures per game, for logging only. */
  private failures = new Map<string, number>();

  constructor(
    private readonly espn: EspnClient,
    private readonly registry: GameRegistry,
    private readonly opts: { featuredGameId: string; intervalMs: number; recordDir?: string },
  ) {}

  private wanted(s: GameSession): boolean {
    if (s.status === 'final' && s.readMeta().recordedLive !== true) return false;
    if (s.gameId === this.opts.featuredGameId) return s.status !== 'final' || this.recentlyFinal(s);
    return s.status === 'live' && Date.now() - s.lastViewed < IDLE_MS;
  }

  /** Keep polling a just-finished featured game briefly to pick up final corrections. */
  private recentlyFinal(s: GameSession): boolean {
    return s.lastUpdate !== undefined && Date.now() - s.lastUpdate < 10 * 60_000;
  }

  private record(gameId: string, body: unknown) {
    if (!this.opts.recordDir) return;
    try {
      const dir = join(this.opts.recordDir, gameId);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${Date.now()}-summary.json`), JSON.stringify(body));
    } catch (e) {
      log.warn('recorder write failed', { gameId, error: (e as Error).message });
    }
  }

  /** One polling pass. Never throws. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const featured = await this.registry.get(this.opts.featuredGameId);
      const sessions = new Set(this.registry.loaded().filter((s) => this.wanted(s)));
      if (featured && this.wanted(featured)) sessions.add(featured);
      for (const s of sessions) {
        const res = await this.espn.summary(s.gameId, { fresh: true });
        if (!res || res.source !== 'live') {
          const n = (this.failures.get(s.gameId) ?? 0) + 1;
          this.failures.set(s.gameId, n);
          if (n === 1 || n % 6 === 0)
            log.warn('live poll failed', { gameId: s.gameId, failures: n });
          continue;
        }
        this.failures.delete(s.gameId);
        this.record(s.gameId, res.data);
        const fresh = s.ingestSummary(res.data);
        if (fresh.length) {
          s.writeMeta({ recordedLive: true });
          log.info('live events', { gameId: s.gameId, events: fresh.length });
        }
      }
    } catch (e) {
      log.error('live poll crashed (continuing)', { error: (e as Error).message });
    } finally {
      this.running = false;
    }
  }

  start(): void {
    this.stop();
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.opts.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
