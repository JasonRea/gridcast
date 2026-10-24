/** Scoreboard cards for the home page, from ESPN (or the saved fixture when ESPN is down). */
import {
  EspnEventSchema,
  type EspnEvent,
  type GameCard,
  type GameStatus,
  type ScoreboardResponse,
} from '@gridcast/types';
import type { EspnClient } from '../espn/client.ts';
import { matchupTeams } from '../espn/teams.ts';

/** 2026 regular season week 1 starts Tuesday Sep 8 (games Thu Sep 10). */
const SEASON_START: Record<number, number> = { 2026: Date.UTC(2026, 8, 8, 12) };

export function currentWeek(season: number, now = Date.now()): number {
  const start = SEASON_START[season] ?? Date.UTC(season, 8, 8, 12);
  const w = Math.floor((now - start) / (7 * 86_400_000)) + 1;
  return Math.min(18, Math.max(1, w));
}

function status(e: EspnEvent): GameStatus {
  const st = (e.status ?? e.competitions[0]?.status)?.type.state;
  return st === 'post' ? 'final' : st === 'in' ? 'live' : 'pre';
}

export function cardFromEvent(e: EspnEvent): GameCard | undefined {
  const comp = e.competitions[0];
  if (!comp) return undefined;
  const teams = matchupTeams(comp);
  if (!teams) return undefined;
  const st = status(e);
  const score = (side: 'home' | 'away') => comp.competitors.find((c) => c.homeAway === side)?.score;
  const hs = score('home');
  const as = score('away');
  const sit = comp.situation;
  const possession =
    sit?.possession === teams.home.id
      ? teams.home.abbr
      : sit?.possession === teams.away.id
        ? teams.away.abbr
        : undefined;
  const odds = comp.odds?.[0];
  const tv = comp.broadcasts?.flatMap(
    (b) => b.names ?? (b.media?.shortName ? [b.media.shortName] : []),
  )[0];
  const wp = sit?.lastPlay?.probability?.homeWinPercentage;
  const statusObj = e.status ?? comp.status;
  return {
    id: e.id,
    status: st,
    kickoff: comp.date ?? e.date,
    ...(e.season?.year ? { season: e.season.year } : {}),
    ...(e.week?.number ? { week: e.week.number } : {}),
    home: { ...teams.home, ...(hs !== undefined && st !== 'pre' ? { score: hs } : {}) },
    away: { ...teams.away, ...(as !== undefined && st !== 'pre' ? { score: as } : {}) },
    detail: statusObj?.type.shortDetail ?? statusObj?.type.detail ?? '',
    ...(possession && st === 'live' ? { possession } : {}),
    ...(sit?.shortDownDistanceText && st === 'live'
      ? { downDistance: sit.shortDownDistanceText }
      : {}),
    ...(tv ? { tv } : {}),
    ...(comp.venue?.fullName ? { venue: comp.venue.fullName } : {}),
    ...(odds?.details ? { spread: odds.details } : {}),
    ...(odds?.overUnder !== undefined ? { total: odds.overUnder } : {}),
    ...(wp !== undefined ? { homeWinProb: wp } : {}),
  };
}

export class ScoreboardService {
  private cache = new Map<string, { at: number; value: ScoreboardResponse }>();

  constructor(
    private readonly espn: EspnClient,
    private readonly opts: { featuredGameId: string; demoGameId: string; ttlMs?: number },
  ) {}

  async get(season: number, week: number): Promise<ScoreboardResponse | undefined> {
    const key = `${season}:${week}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < (this.opts.ttlMs ?? 15_000)) return hit.value;
    const res = await this.espn.scoreboard(season, week);
    if (!res) return undefined;
    const games: GameCard[] = [];
    for (const raw of res.data.events) {
      const ev = EspnEventSchema.safeParse(raw);
      if (!ev.success) continue;
      const card = cardFromEvent(ev.data);
      if (!card) continue;
      if (card.id === this.opts.featuredGameId) card.featured = true;
      if (card.id === this.opts.demoGameId) card.demo = true;
      card.dataSource = res.source;
      games.push(card);
    }
    games.sort(
      (a, b) => Number(!!b.featured) - Number(!!a.featured) || a.kickoff.localeCompare(b.kickoff),
    );
    const value: ScoreboardResponse = { season, week, games, dataSource: res.source };
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }
}
