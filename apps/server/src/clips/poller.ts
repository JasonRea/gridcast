/**
 * X highlight clips (P1). Every 60 s, recent video posts from @NFL and both teams' accounts are
 * matched to plays and published as clip events. Pay-per-use API: one search per live game per
 * minute. Off without X_BEARER_TOKEN. Hand-picked clips for a finished game live in
 * data/assets/clips/<gameId>.json ([{ "playId": "...", "url": "https://x.com/..." }]).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { Clip, GameEvent, PlayEvent } from '@gridcast/types';
import type { GameRegistry } from '../games/registry.ts';
import type { GameSession } from '../games/session.ts';
import { fetchJson, type Fetcher } from '../util/fetchJson.ts';
import { log } from '../util/logger.ts';
import { matchPost, type Post } from './match.ts';

export const TEAM_HANDLES: Record<string, string> = {
  ARI: 'AZCardinals',
  ATL: 'AtlantaFalcons',
  BAL: 'Ravens',
  BUF: 'BuffaloBills',
  CAR: 'Panthers',
  CHI: 'ChicagoBears',
  CIN: 'Bengals',
  CLE: 'Browns',
  DAL: 'dallascowboys',
  DEN: 'Broncos',
  DET: 'Lions',
  GB: 'packers',
  HOU: 'HoustonTexans',
  IND: 'Colts',
  JAX: 'Jaguars',
  KC: 'Chiefs',
  LV: 'Raiders',
  LAC: 'chargers',
  LAR: 'RamsNFL',
  MIA: 'MiamiDolphins',
  MIN: 'Vikings',
  NE: 'Patriots',
  NO: 'Saints',
  NYG: 'Giants',
  NYJ: 'nyjets',
  PHI: 'Eagles',
  PIT: 'steelers',
  SF: '49ers',
  SEA: 'Seahawks',
  TB: 'Buccaneers',
  TEN: 'Titans',
  WSH: 'Commanders',
};

const SearchSchema = z.looseObject({
  data: z
    .array(
      z.looseObject({
        id: z.string(),
        text: z.string(),
        created_at: z.string(),
        author_id: z.string().optional(),
      }),
    )
    .optional(),
});

const ManualSchema = z.array(z.object({ playId: z.string(), url: z.string().url() }));

/** Rebuild enricher: hand-picked clips for finished games, right after their play. */
export function manualClips(assetsDir: string) {
  return (session: GameSession, events: GameEvent[]): GameEvent[] => {
    const path = join(assetsDir, 'clips', `${session.gameId}.json`);
    if (!existsSync(path)) return events;
    const parsed = ManualSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
    if (!parsed.success) {
      log.warn('bad manual clips file', { gameId: session.gameId });
      return events;
    }
    const byPlay = new Map(parsed.data.map((c) => [c.playId, c.url]));
    return events.flatMap((e) => {
      const url = e.kind === 'play' ? byPlay.get(e.id) : undefined;
      if (!url || e.kind !== 'play') return [e];
      const clip: Clip = { kind: 'clip', playId: e.id, ts: e.ts + 900, url, source: 'manual' };
      return [e, clip];
    });
  };
}

export class ClipPoller {
  private timer: ReturnType<typeof setInterval> | undefined;
  private seen = new Set<string>();

  constructor(
    private readonly registry: GameRegistry,
    private readonly opts: { bearer: string; intervalMs?: number; fetcher?: Fetcher },
  ) {}

  query(s: GameSession): string {
    const handles = ['NFL', TEAM_HANDLES[s.card.home.abbr], TEAM_HANDLES[s.card.away.abbr]].filter(
      Boolean,
    );
    return `(${handles.map((h) => `from:${h}`).join(' OR ')}) has:videos -is:retweet -is:reply`;
  }

  async pollGame(s: GameSession): Promise<number> {
    const start = new Date(Date.now() - 30 * 60_000).toISOString();
    const url = `https://api.x.com/2/tweets/search/recent?query=${encodeURIComponent(this.query(s))}&tweet.fields=created_at,author_id&max_results=25&start_time=${start}`;
    const res = await fetchJson(url, SearchSchema, {
      headers: { authorization: `Bearer ${this.opts.bearer}` },
      ...(this.opts.fetcher ? { fetcher: this.opts.fetcher } : {}),
    });
    if (!res.ok) return 0;
    const plays = s.log
      .all()
      .flatMap((e) => (e.event.kind === 'play' ? [e.event as PlayEvent] : []));
    const clips: Clip[] = [];
    for (const t of res.data.data ?? []) {
      if (this.seen.has(t.id)) continue;
      this.seen.add(t.id);
      const post: Post = { id: t.id, text: t.text, createdAt: Date.parse(t.created_at) };
      const play = matchPost(post, plays);
      if (play)
        clips.push({
          kind: 'clip',
          playId: play.id,
          ts: Date.now(),
          url: `https://x.com/i/status/${t.id}`,
          source: 'x',
        });
    }
    return s.publish(clips).length;
  }

  async tick(): Promise<void> {
    for (const s of this.registry.loaded()) {
      if (s.status !== 'live' || s.source !== 'live') continue;
      try {
        await this.pollGame(s);
      } catch (e) {
        log.warn('clip poll failed', { gameId: s.gameId, error: (e as Error).message });
      }
    }
  }

  start(): void {
    this.timer = setInterval(() => void this.tick(), this.opts.intervalMs ?? 60_000);
    this.timer.unref?.();
  }
}
