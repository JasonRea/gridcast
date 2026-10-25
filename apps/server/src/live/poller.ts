/**
 * Live ESPN polling. Every 10 s the featured game (and any live game someone is watching) is
 * fetched, and new plays go through the same normalizer and event log as replays. The kill
 * switch only changes the clock; recording continues.
 *
 * Recorder: raw responses are kept (gzipped) once the game has started, and only when ESPN's
 * data changed. Oct 25: recording every 10 s from the night before, uncompressed, filled the
 * 1 GB volume during the 4th quarter. A failed write turns the recorder off, never the poller.
 * A finished game is polled for 10 minutes after it was first seen final, then left alone.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { EspnClient } from '../espn/client.ts';
import type { GameRegistry } from '../games/registry.ts';
import type { GameSession } from '../games/session.ts';
import { log } from '../util/logger.ts';

const IDLE_MS = 5 * 60_000;
/** Watched pre-game sessions start polling this long before the scheduled kickoff. */
const KICKOFF_LEAD_MS = 15 * 60_000;

export class LivePoller {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  /** Consecutive failures per game, for logging only. */
  private failures = new Map<string, number>();
  /** When each game was first seen final. */
  private finalSeen = new Map<string, number>();
  /** Hash of the last recorded response per game: unchanged responses are not written. */
  private lastRecorded = new Map<string, string>();
  private recorderOff = false;

  constructor(
    private readonly espn: EspnClient,
    private readonly registry: GameRegistry,
    private readonly opts: {
      featuredGameId: string;
      intervalMs: number;
      recordDir?: string;
      now?: () => number;
    },
  ) {}

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  private wanted(s: GameSession): boolean {
    if (s.status === 'final' && s.readMeta().recordedLive !== true) return false;
    if (s.gameId === this.opts.featuredGameId) return s.status !== 'final' || this.recentlyFinal(s);
    if (this.now() - s.lastViewed >= IDLE_MS) return false;
    if (s.status === 'live') return true;
    // A watched game opened before kickoff: start polling near kickoff, or it would stay "pre"
    // forever (nothing else updates its status). Oct 25: SF @ ATL sat on the preview while live.
    if (s.status === 'pre') {
      const kickoff = Date.parse(s.card.kickoff);
      return Number.isFinite(kickoff) && kickoff - this.now() <= KICKOFF_LEAD_MS;
    }
    return false;
  }

  /** Keep polling a just-finished featured game briefly to pick up final corrections. */
  private recentlyFinal(s: GameSession): boolean {
    const seen = this.finalSeen.get(s.gameId);
    // Never seen final in this process (e.g. a restart after the game): one last look.
    return seen === undefined || this.now() - seen < 10 * 60_000;
  }

  /** Records a raw response: game started, data changed, gzipped. Returns whether it wrote. */
  record(s: GameSession, body: unknown): boolean {
    if (!this.opts.recordDir || this.recorderOff || s.status === 'pre') return false;
    const json = JSON.stringify(body);
    const hash = createHash('sha1').update(json).digest('hex');
    if (this.lastRecorded.get(s.gameId) === hash) return false;
    try {
      const dir = join(this.opts.recordDir, s.gameId);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${this.now()}-summary.json.gz`), gzipSync(json));
      this.lastRecorded.set(s.gameId, hash);
      return true;
    } catch (e) {
      // Disk trouble: stop recording (raw copies are a nice-to-have), keep the game flowing.
      this.recorderOff = true;
      log.error('recorder off after a failed write', {
        gameId: s.gameId,
        error: (e as Error).message,
      });
      return false;
    }
  }

  /** One polling pass. Never throws. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      // Events kept in memory after a failed disk write get another try.
      for (const s of this.registry.loaded()) if (s.log.unsaved) s.log.flush();
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
        const fresh = s.ingestSummary(res.data);
        this.record(s, res.data);
        if (s.status === 'final' && !this.finalSeen.has(s.gameId))
          this.finalSeen.set(s.gameId, this.now());
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
