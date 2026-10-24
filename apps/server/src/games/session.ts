/**
 * One game: its event log, how its stream is sourced (live feed or recorded replay), and the
 * metadata the API returns. Live and replay share this object; only the clock differs.
 */
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EspnAthleteSchema,
  type DepthChart,
  type EspnDepthChart,
  type EspnRoster,
  type EspnSummary,
  type GameCard,
  type GameEvent,
  type GameState,
  type GameStatus,
  type PlayEvent,
  type RosterPlayer,
  type StreamControl,
  type TeamInfo,
} from '@gridcast/types';
import type { EventLog } from '../log/eventLog.ts';
import { matchupTeams } from '../espn/teams.ts';
import {
  GameNormalizer,
  metaFromSummary,
  playsFromSummary,
  winProbMap,
  type GameMeta,
} from '../pipeline/normalize.ts';

/** Bump when the normalizer or parser output changes, so finished games rebuild their logs. */
export const PIPELINE_VERSION = 6;

export type Source = 'live' | 'replay';

export type SourceChange = { source: Source; speed: number; from: number };

export function statusOf(summary: EspnSummary): GameStatus {
  const st = summary.header.competitions[0]?.status?.type.state;
  return st === 'post' ? 'final' : st === 'in' ? 'live' : 'pre';
}

export function cardFromSummary(summary: EspnSummary): GameCard | undefined {
  const comp = summary.header.competitions[0];
  if (!comp) return undefined;
  const teams = matchupTeams(comp);
  if (!teams) return undefined;
  const score = (side: 'home' | 'away') => comp.competitors.find((c) => c.homeAway === side)?.score;
  const hs = score('home');
  const as = score('away');
  const status = statusOf(summary);
  const pick = summary.pickcenter?.[0];
  const venue = summary.gameInfo?.venue?.fullName ?? comp.venue?.fullName;
  const tv = comp.broadcasts?.flatMap(
    (b) => b.names ?? (b.media?.shortName ? [b.media.shortName] : []),
  )[0];
  return {
    id: summary.header.id,
    status,
    kickoff: comp.date ?? new Date().toISOString(),
    ...(summary.header.season?.year ? { season: summary.header.season.year } : {}),
    ...(summary.header.week ? { week: summary.header.week } : {}),
    home: { ...teams.home, ...(hs !== undefined && status !== 'pre' ? { score: hs } : {}) },
    away: { ...teams.away, ...(as !== undefined && status !== 'pre' ? { score: as } : {}) },
    detail: comp.status?.type.shortDetail ?? comp.status?.type.detail ?? '',
    ...(venue ? { venue } : {}),
    ...(tv ? { tv } : {}),
    ...(pick?.details ? { spread: pick.details } : {}),
    ...(pick?.overUnder !== undefined ? { total: pick.overUnder } : {}),
  };
}

export function rosterPlayers(r: EspnRoster | undefined): RosterPlayer[] {
  if (!r) return [];
  const out: RosterPlayer[] = [];
  for (const group of r.athletes) {
    for (const item of group.items) {
      const a = EspnAthleteSchema.safeParse(item);
      if (!a.success) continue;
      const last = a.data.lastName ?? a.data.displayName.split(' ').slice(1).join(' ');
      const first = a.data.firstName ?? a.data.displayName.split(' ')[0] ?? '';
      const jersey = a.data.jersey ? Number(a.data.jersey) : undefined;
      out.push({
        id: a.data.id,
        name: a.data.displayName,
        shortName: `${first.slice(0, 1)}.${last}`,
        lastName: last,
        ...(jersey !== undefined && Number.isFinite(jersey) ? { jersey } : {}),
        position: a.data.position?.abbreviation ?? '',
      });
    }
  }
  return out;
}

export function depthChart(d: EspnDepthChart | undefined, roster: RosterPlayer[]): DepthChart {
  const out: DepthChart = {};
  if (!d) return out;
  const byId = new Map(roster.map((p) => [p.id, p]));
  for (const group of d.depthchart) {
    for (const [key, pos] of Object.entries(group.positions)) {
      const k = (pos.position?.abbreviation ?? key).toUpperCase();
      if (out[k]) continue;
      out[k] = pos.athletes.flatMap((a) => {
        const known = byId.get(a.id);
        if (known) return [known];
        if (!a.displayName) return [];
        const parts = a.displayName.split(' ');
        const jersey = a.jersey ? Number(a.jersey) : undefined;
        return [
          {
            id: a.id,
            name: a.displayName,
            shortName: `${parts[0]?.slice(0, 1) ?? ''}.${parts.slice(1).join(' ')}`,
            lastName: parts.slice(1).join(' '),
            ...(jersey !== undefined && Number.isFinite(jersey) ? { jersey } : {}),
            position: k,
          },
        ];
      });
    }
  }
  return out;
}

export class GameSession extends EventEmitter<{
  source: [SourceChange];
  events: [GameEvent[]];
  /** Partial commentary while it streams (not logged). */
  delta: [StreamControl];
}> {
  source: Source;
  replaySpeed = 1;
  replayFrom = 0;
  status: GameStatus;
  card: GameCard;
  meta: GameMeta;
  rosters: Record<string, RosterPlayer[]> = {};
  depth: Record<string, DepthChart> = {};
  /** Latest raw summary (used for preview data on upcoming games). */
  summary: EspnSummary;
  /** ms epoch of the last successful upstream update. */
  lastUpdate: number | undefined;
  /** ms epoch of the last time a client looked at this game. */
  lastViewed = Date.now();
  private normalizer: GameNormalizer;
  private readonly ids = new Set<string>();

  constructor(
    readonly gameId: string,
    readonly log: EventLog,
    summary: EspnSummary,
    private readonly metaDir: string,
    private readonly enrich?: (p: PlayEvent) => PlayEvent,
  ) {
    super();
    this.setMaxListeners(0);
    this.summary = summary;
    const card = cardFromSummary(summary);
    const meta = metaFromSummary(summary);
    if (!card || !meta) throw new Error(`summary ${gameId} has no competition`);
    this.card = card;
    this.meta = meta;
    this.status = card.status;
    this.source = this.status === 'final' ? 'replay' : 'live';
    this.normalizer = new GameNormalizer(meta, this.enrich);
    for (const { event } of log.all()) this.trackId(event);
  }

  get teams(): { home: TeamInfo; away: TeamInfo } {
    return { home: this.card.home, away: this.card.away };
  }

  get state(): GameState | undefined {
    for (let i = this.log.length - 1; i >= 0; i--) {
      const e = this.log.all()[i]?.event;
      if (e && (e.kind === 'play' || e.kind === 'stoppage')) return e.state;
    }
    return undefined;
  }

  private eventId(e: GameEvent): string | undefined {
    if (e.kind === 'play' || e.kind === 'stoppage') return `${e.kind}:${e.id}`;
    if (e.kind === 'commentary') return `c:${e.playId}:${e.voice}`;
    if (e.kind === 'clip') return `clip:${e.playId}:${e.url}`;
    return undefined;
  }

  private trackId(e: GameEvent) {
    const id = this.eventId(e);
    if (id) this.ids.add(id);
  }

  has(e: GameEvent): boolean {
    const id = this.eventId(e);
    return id ? this.ids.has(id) : false;
  }

  /** Appends new events (skipping ones already logged) and notifies enrichers. */
  publish(events: GameEvent[]): GameEvent[] {
    const fresh = events.filter((e) => !this.has(e));
    for (const e of fresh) {
      this.trackId(e);
      this.log.append(e);
    }
    if (fresh.length) this.emit('events', fresh);
    return fresh;
  }

  /** Feeds a summary through the normalizer (live polling and the first live load). */
  ingestSummary(summary: EspnSummary): GameEvent[] {
    this.summary = summary;
    const card = cardFromSummary(summary);
    if (card) {
      this.card = { ...this.card, ...card };
      this.status = card.status;
    }
    const wp = winProbMap(summary);
    const out: GameEvent[] = [];
    for (const { play, driveId } of playsFromSummary(summary)) {
      const w = wp.get(play.id);
      out.push(
        ...this.normalizer.ingest(play, {
          ...(w !== undefined ? { wp: w } : {}),
          ...(driveId ? { driveId } : {}),
        }),
      );
    }
    this.lastUpdate = Date.now();
    return this.publish(out);
  }

  /** Rebuilds a finished game's log from scratch. */
  rebuild(summary: EspnSummary, extra: (events: GameEvent[]) => GameEvent[] = (e) => e): void {
    this.normalizer = new GameNormalizer(this.meta, this.enrich);
    const wp = winProbMap(summary);
    const events: GameEvent[] = [];
    for (const { play, driveId } of playsFromSummary(summary)) {
      const w = wp.get(play.id);
      events.push(
        ...this.normalizer.ingest(play, {
          ...(w !== undefined ? { wp: w } : {}),
          ...(driveId ? { driveId } : {}),
        }),
      );
    }
    const all = extra(events);
    this.ids.clear();
    for (const e of all) this.trackId(e);
    this.log.replace(all);
    this.writeMeta();
  }

  setSource(source: Source, opts: { speed?: number; from?: number } = {}): SourceChange {
    this.source = source;
    if (opts.speed !== undefined) this.replaySpeed = opts.speed;
    this.replayFrom = opts.from ?? 0;
    const change = {
      source,
      speed: this.replaySpeed,
      from: source === 'replay' ? this.replayFrom : 0,
    };
    this.emit('source', change);
    return change;
  }

  private metaPath() {
    return join(this.metaDir, `${this.gameId}.meta.json`);
  }

  readMeta(): { version?: number; recordedLive?: boolean } {
    const p = this.metaPath();
    if (!existsSync(p)) return {};
    try {
      return JSON.parse(readFileSync(p, 'utf8')) as { version?: number; recordedLive?: boolean };
    } catch {
      return {};
    }
  }

  writeMeta(extra: { recordedLive?: boolean } = {}): void {
    writeFileSync(
      this.metaPath(),
      JSON.stringify({ ...this.readMeta(), version: PIPELINE_VERSION, ...extra }),
    );
  }
}
