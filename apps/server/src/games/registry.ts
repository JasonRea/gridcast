/** Loads and caches GameSessions. The single entry point for "give me game X". */
import { mkdirSync } from 'node:fs';
import type { GameEvent, PlayEvent } from '@gridcast/types';
import type { Config } from '../config.ts';
import type { EspnClient } from '../espn/client.ts';
import { EventLog } from '../log/eventLog.ts';
import { log } from '../util/logger.ts';
import { depthChart, GameSession, PIPELINE_VERSION, rosterPlayers } from './session.ts';

export type SessionHook = (session: GameSession) => void;
/** Adds derived events (commentary, ...) when a finished game's log is rebuilt. */
export type RebuildEnricher = (session: GameSession, events: GameEvent[]) => GameEvent[];

export class GameRegistry {
  private readonly sessions = new Map<string, Promise<GameSession | undefined>>();
  private readonly hooks: SessionHook[] = [];
  private enrichers: RebuildEnricher[] = [];

  constructor(
    private readonly config: Config,
    private readonly espn: EspnClient,
    private readonly opts: { persist?: boolean; enrichPlay?: (p: PlayEvent) => PlayEvent } = {},
  ) {
    if (opts.persist !== false) mkdirSync(config.logsDir, { recursive: true });
  }

  /** Runs for every session once it is loaded (commentary, odds, ...). */
  onSession(hook: SessionHook): void {
    this.hooks.push(hook);
  }

  addRebuildEnricher(fn: RebuildEnricher): void {
    this.enrichers.push(fn);
  }

  loaded(): GameSession[] {
    return [...this.sessionsResolved.values()];
  }

  private readonly sessionsResolved = new Map<string, GameSession>();

  get(gameId: string): Promise<GameSession | undefined> {
    if (!/^\d{6,12}$/.test(gameId)) return Promise.resolve(undefined);
    let p = this.sessions.get(gameId);
    if (!p) {
      p = this.load(gameId).catch((e: unknown) => {
        log.error('failed to load game', { gameId, error: (e as Error).message });
        this.sessions.delete(gameId);
        return undefined;
      });
      this.sessions.set(gameId, p);
    }
    return p;
  }

  /** Rebuilds a finished game's log (after background commentary generation, for example). */
  async refresh(gameId: string): Promise<void> {
    const session = this.sessionsResolved.get(gameId);
    if (!session || session.status !== 'final' || session.readMeta().recordedLive) return;
    const res = await this.espn.summary(gameId);
    if (!res) return;
    session.rebuild(res.data, (events) =>
      this.enrichers.reduce((acc, fn) => fn(session, acc), events),
    );
    log.info('rebuilt replay log', { gameId, events: session.log.length });
  }

  private async load(gameId: string): Promise<GameSession | undefined> {
    const res = await this.espn.summary(gameId);
    if (!res) {
      this.sessions.delete(gameId);
      return undefined;
    }
    const summary = res.data;
    const eventLog = new EventLog(gameId, this.config.logsDir, this.opts.persist !== false);
    const session = new GameSession(
      gameId,
      eventLog,
      summary,
      this.config.logsDir,
      this.opts.enrichPlay,
    );
    if (res.source === 'live') session.lastUpdate = Date.now();

    if (session.status === 'final') {
      const meta = this.opts.persist === false ? {} : session.readMeta();
      const stale = meta.version !== PIPELINE_VERSION;
      if (eventLog.length === 0 || (!meta.recordedLive && stale)) {
        session.rebuild(summary, (events) =>
          this.enrichers.reduce((acc, fn) => fn(session, acc), events),
        );
        log.info('built replay log', { gameId, events: eventLog.length });
      }
    } else {
      const fresh = session.ingestSummary(summary);
      if (fresh.length && this.opts.persist !== false) session.writeMeta({ recordedLive: true });
    }

    const { home, away } = session.teams;
    const [hr, ar, hd, ad] = await Promise.all([
      this.espn.roster(home.id, home.abbr),
      this.espn.roster(away.id, away.abbr),
      this.espn.depthChart(home.id, home.abbr),
      this.espn.depthChart(away.id, away.abbr),
    ]);
    const homeRoster = rosterPlayers(hr);
    const awayRoster = rosterPlayers(ar);
    session.rosters = { [home.abbr]: homeRoster, [away.abbr]: awayRoster };
    session.depth = {
      [home.abbr]: depthChart(hd, homeRoster),
      [away.abbr]: depthChart(ad, awayRoster),
    };

    this.sessionsResolved.set(gameId, session);
    for (const h of this.hooks) h(session);
    return session;
  }
}
