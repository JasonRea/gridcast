/**
 * X highlight clips (P1). Every 60 s, recent video posts from official accounts are matched to
 * plays of live games and published as clip events. Finished games get a one-time backfill of
 * the game window (X recent search reaches back 7 days), matched to big plays only and cached.
 * Pay-per-use API; off without X_BEARER_TOKEN.
 *
 * Trust: a post counts only if its author is on the allowlist below (the NFL, the two teams,
 * the national broadcasters) AND X marks the account as a verified organization
 * (verified_type "business" or "government"). A look-alike handle cannot pass both.
 *
 * Clips for finished games live in data/assets/clips/<gameId>.json (committed, hand-picked or
 * saved with `pnpm clips:backfill`) and in <cacheDir>/clips/<gameId>.json (automatic backfill):
 * [{ "playId": "...", "url": "https://x.com/..." }].
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { Clip, GameEvent, PlayEvent } from '@gridcast/types';
import type { GameRegistry } from '../games/registry.ts';
import type { GameSession } from '../games/session.ts';
import { fetchJson, type Fetcher } from '../util/fetchJson.ts';
import { log } from '../util/logger.ts';
import { matchPost, score, type Post } from './match.ts';

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

/** League and national broadcast accounts that post official highlights. */
export const LEAGUE_HANDLES = [
  'NFL',
  'NFLonFOX',
  'NFLonCBS',
  'NFLonPrime',
  'SNFonNBC',
  'ESPNNFL',
  'nflnetwork',
];

/** Allowlist for a game: the league, the broadcasters and the two teams. */
export function trustedHandles(home: string, away: string): string[] {
  return [...LEAGUE_HANDLES, TEAM_HANDLES[home], TEAM_HANDLES[away]].filter(
    (h): h is string => !!h,
  );
}

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
  includes: z
    .looseObject({
      users: z
        .array(
          z.looseObject({
            id: z.string(),
            username: z.string(),
            verified_type: z.string().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  meta: z.looseObject({ next_token: z.string().optional() }).optional(),
});
type Search = z.infer<typeof SearchSchema>;

/**
 * Posts from trusted authors only: on the allowlist (case-insensitive) and verified as an
 * organization by X. Anything else, including a missing author record, is dropped.
 */
export function trustedPosts(res: Search, allow: string[]): (Post & { author: string })[] {
  const ok = new Set(allow.map((h) => h.toLowerCase()));
  const users = new Map((res.includes?.users ?? []).map((u) => [u.id, u]));
  return (res.data ?? []).flatMap((t) => {
    const u = t.author_id ? users.get(t.author_id) : undefined;
    if (!u || !ok.has(u.username.toLowerCase())) return [];
    if (u.verified_type !== 'business' && u.verified_type !== 'government') return [];
    const createdAt = Date.parse(t.created_at);
    if (!Number.isFinite(createdAt)) return [];
    return [{ id: t.id, text: t.text, createdAt, author: u.username }];
  });
}

const SEARCH_FIELDS =
  'tweet.fields=created_at,author_id&expansions=author_id&user.fields=username,verified_type';

const ManualSchema = z.array(z.object({ playId: z.string(), url: z.string().url() }));
export type SavedClip = z.infer<typeof ManualSchema>[number];

function readClips(path: string, gameId: string): SavedClip[] {
  if (!existsSync(path)) return [];
  try {
    const parsed = ManualSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
    if (parsed.success) return parsed.data;
  } catch {
    // fall through
  }
  log.warn('bad clips file', { gameId, path });
  return [];
}

/**
 * Rebuild enricher: clips for finished games, right after their play. Committed clips
 * (assetsDir) win over the automatic backfill cache (cacheDir) for the same play.
 */
export function manualClips(assetsDir: string, cacheDir?: string) {
  return (session: GameSession, events: GameEvent[]): GameEvent[] => {
    const file = `${session.gameId}.json`;
    const saved = [
      ...(cacheDir ? readClips(join(cacheDir, 'clips', file), session.gameId) : []),
      ...readClips(join(assetsDir, 'clips', file), session.gameId),
    ];
    if (!saved.length) return events;
    const byPlay = new Map(saved.map((c) => [c.playId, c.url]));
    return events.flatMap((e) => {
      const url = e.kind === 'play' ? byPlay.get(e.id) : undefined;
      if (!url || e.kind !== 'play') return [e];
      const clip: Clip = { kind: 'clip', playId: e.id, ts: e.ts + 900, url, source: 'manual' };
      return [e, clip];
    });
  };
}

/** X recent search only reaches back this far. */
const SEARCH_REACH_MS = 7 * 24 * 3600_000;
/** Teams post highlights a few minutes after the play; finished games allow a little more. */
const BACKFILL_WINDOW_MS = 10 * 60_000;
const BACKFILL_PAGES = 3;

export class ClipPoller {
  private timer: ReturnType<typeof setInterval> | undefined;
  private seen = new Set<string>();
  private backfilling = new Set<string>();

  constructor(
    private readonly registry: GameRegistry,
    private readonly opts: {
      bearer: string;
      intervalMs?: number;
      fetcher?: Fetcher;
      /** Where automatic backfills are cached (one search per finished game, ever). */
      cacheDir?: string;
      now?: () => number;
    },
  ) {}

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  query(s: GameSession): string {
    const handles = trustedHandles(s.card.home.abbr, s.card.away.abbr);
    return `(${handles.map((h) => `from:${h}`).join(' OR ')}) has:videos -is:retweet -is:reply`;
  }

  private async search(url: string): Promise<Search | undefined> {
    const res = await fetchJson(url, SearchSchema, {
      headers: { authorization: `Bearer ${this.opts.bearer}` },
      ...(this.opts.fetcher ? { fetcher: this.opts.fetcher } : {}),
    });
    return res.ok ? res.data : undefined;
  }

  async pollGame(s: GameSession): Promise<number> {
    const start = new Date(this.now() - 30 * 60_000).toISOString();
    const url = `https://api.x.com/2/tweets/search/recent?query=${encodeURIComponent(this.query(s))}&${SEARCH_FIELDS}&max_results=25&start_time=${start}`;
    const res = await this.search(url);
    if (!res) return 0;
    const plays = s.log
      .all()
      .flatMap((e) => (e.event.kind === 'play' ? [e.event as PlayEvent] : []));
    const clips: Clip[] = [];
    for (const post of trustedPosts(res, trustedHandles(s.card.home.abbr, s.card.away.abbr))) {
      if (this.seen.has(post.id)) continue;
      this.seen.add(post.id);
      const play = matchPost(post, plays);
      if (play)
        clips.push({
          kind: 'clip',
          playId: play.id,
          ts: this.now(),
          url: `https://x.com/i/status/${post.id}`,
          source: 'x',
        });
    }
    return s.publish(clips).length;
  }

  /**
   * Clips for a finished game: searches the game window once (up to 3 pages of 100 posts),
   * matches trusted posts to big plays only, one clip per play. Returns undefined when the game
   * is out of X's 7-day reach or the search failed.
   */
  async findClips(s: GameSession): Promise<SavedClip[] | undefined> {
    const plays = s.log
      .all()
      .flatMap((e) => (e.event.kind === 'play' ? [e.event as PlayEvent] : []));
    if (!plays.length) return [];
    const now = this.now();
    const first = plays[0]!.ts;
    const last = plays[plays.length - 1]!.ts;
    const start = Math.max(first - 5 * 60_000, now - SEARCH_REACH_MS + 60_000);
    const end = Math.min(last + 60 * 60_000, now - 30_000);
    if (end <= start || last + BACKFILL_WINDOW_MS < now - SEARCH_REACH_MS) return undefined;
    const allow = trustedHandles(s.card.home.abbr, s.card.away.abbr);
    const posts: Post[] = [];
    let next: string | undefined;
    for (let page = 0; page < BACKFILL_PAGES; page++) {
      const url =
        `https://api.x.com/2/tweets/search/recent?query=${encodeURIComponent(this.query(s))}` +
        `&${SEARCH_FIELDS}&max_results=100` +
        `&start_time=${new Date(start).toISOString()}&end_time=${new Date(end).toISOString()}` +
        (next ? `&next_token=${encodeURIComponent(next)}` : '');
      const res = await this.search(url);
      if (!res) return page === 0 ? undefined : bestPerPlay(posts, plays);
      posts.push(...trustedPosts(res, allow));
      next = res.meta?.next_token;
      if (!next) break;
    }
    return bestPerPlay(posts, plays);
  }

  /** Session hook: backfill a finished game once, cache it, rebuild its log with the clips. */
  async backfill(s: GameSession): Promise<void> {
    const dir = this.opts.cacheDir;
    if (!dir || s.status !== 'final' || this.backfilling.has(s.gameId)) return;
    const path = join(dir, 'clips', `${s.gameId}.json`);
    if (existsSync(path)) return;
    this.backfilling.add(s.gameId);
    try {
      const clips = await this.findClips(s);
      if (!clips) return;
      mkdirSync(join(dir, 'clips'), { recursive: true });
      // Written even when empty: one search per finished game, ever.
      writeFileSync(path, JSON.stringify(clips, null, 1) + '\n');
      log.info('clip backfill', { gameId: s.gameId, clips: clips.length });
      if (clips.length) await this.registry.refresh(s.gameId);
    } catch (e) {
      log.warn('clip backfill failed', { gameId: s.gameId, error: (e as Error).message });
    } finally {
      this.backfilling.delete(s.gameId);
    }
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

/** Big plays only, and the best-scoring post for each play. */
export function bestPerPlay(posts: Post[], plays: PlayEvent[]): SavedClip[] {
  const big = plays.filter((p) => p.big);
  const best = new Map<string, { url: string; s: number }>();
  for (const post of posts) {
    const play = matchPost(post, big, BACKFILL_WINDOW_MS);
    if (!play) continue;
    const s = score(post, play);
    const cur = best.get(play.id);
    if (!cur || s > cur.s) best.set(play.id, { url: `https://x.com/i/status/${post.id}`, s });
  }
  return plays.flatMap((p) => {
    const b = best.get(p.id);
    return b ? [{ playId: p.id, url: b.url }] : [];
  });
}
