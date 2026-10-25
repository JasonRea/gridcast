/**
 * Typed fetchers for the Gridcast server API (mirrors apps/web/src/lib/api.ts). The app talks
 * only to our server: never ESPN, Kalshi, X, ElevenLabs, Claude or Gemini, and holds no keys.
 *
 * Every response is checked with the shared zod schemas. Lists fail soft: a malformed game
 * card or log entry is logged and dropped instead of failing the whole screen.
 */
import {
  EventsResponseSchema,
  GameCardSchema,
  GameDetailSchema,
  LoggedEventSchema,
  RoomResponseSchema,
  ScoreboardResponseSchema,
  TranslateResponseSchema,
  type EventsResponse,
  type GameCard,
  type GameDetail,
  type Language,
  type LoggedEvent,
  type RoomResponse,
  type ScoreboardResponse,
} from '@gridcast/types';
import { z } from 'zod';
import { apiBase } from './base';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
  ) {
    super(`${status} ${path}`);
  }
}

type Log = (msg: string, detail?: unknown) => void;
let warn: Log = (msg, detail) => console.warn(`[gridcast] ${msg}`, detail ?? '');
/** Tests silence or capture warnings. */
export function setWarn(fn: Log): void {
  warn = fn;
}

const TIMEOUT_MS = 15_000;

async function getJson(path: string): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${apiBase()}${path}`, { signal: ctrl.signal });
    if (!res.ok) throw new ApiError(res.status, path);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/** Keeps the items of `arr` that pass `schema`; logs and drops the rest. */
export function keepValid<T>(arr: unknown, schema: z.ZodType<T>, what: string): T[] {
  if (!Array.isArray(arr)) return [];
  const out: T[] = [];
  arr.forEach((item, i) => {
    const r = schema.safeParse(item);
    if (r.success) out.push(r.data);
    else warn(`skipped bad ${what} #${i}`, r.error.issues[0]);
  });
  return out;
}

/** Scoreboard: the envelope must parse; bad cards are dropped one by one. */
export function parseScoreboard(raw: unknown): ScoreboardResponse {
  const env = ScoreboardResponseSchema.omit({ games: true })
    .extend({ games: z.array(z.unknown()) })
    .safeParse(raw);
  if (!env.success) throw new Error('Bad scoreboard response');
  const games: GameCard[] = keepValid(env.data.games, GameCardSchema, 'game card');
  return { ...env.data, games };
}

/** Event log page: bad entries are dropped, the rest keep their order. */
export function parseEvents(raw: unknown): EventsResponse {
  const env = EventsResponseSchema.omit({ events: true })
    .extend({ events: z.array(z.unknown()) })
    .safeParse(raw);
  if (!env.success) throw new Error('Bad events response');
  const events: LoggedEvent[] = keepValid(env.data.events, LoggedEventSchema, 'log entry');
  return { ...env.data, events };
}

const OPTIONAL_BLOCKS = ['preview', 'depth', 'rosters', 'state', 'kalshiHomeProb'] as const;

/** Game detail: a bad optional block (preview, depth chart, ...) is dropped, not fatal. */
export function parseGame(raw: unknown): GameDetail {
  const r = GameDetailSchema.safeParse(raw);
  if (r.success) return r.data;
  if (!raw || typeof raw !== 'object') throw new Error('Bad game response');
  const obj: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  for (const key of OPTIONAL_BLOCKS) {
    if (!GameDetailSchema.shape[key].safeParse(obj[key]).success) {
      warn(`game detail: dropped bad "${key}"`);
      delete obj[key];
    }
  }
  const again = GameDetailSchema.safeParse(obj);
  if (!again.success) throw new Error('Bad game response');
  return again.data;
}

export const api = {
  health: async () =>
    z
      .object({ ok: z.boolean(), offline: z.boolean().optional() })
      .parse(await getJson('/api/health')),
  scoreboard: async (season?: number, week?: number): Promise<ScoreboardResponse> => {
    const q = new URLSearchParams();
    if (season) q.set('season', String(season));
    if (week) q.set('week', String(week));
    const qs = q.toString();
    return parseScoreboard(await getJson(`/api/games${qs ? `?${qs}` : ''}`));
  },
  game: async (id: string): Promise<GameDetail> =>
    parseGame(await getJson(`/api/games/${encodeURIComponent(id)}`)),
  events: async (id: string, from = 0): Promise<EventsResponse> =>
    parseEvents(await getJson(`/api/games/${encodeURIComponent(id)}/events?from=${from}`)),
  room: async (id: string): Promise<RoomResponse> =>
    RoomResponseSchema.parse(await getJson(`/api/games/${encodeURIComponent(id)}/room`)),
  /** Commentary lines in another language, same order. Throws when translation is off. */
  translate: async (lang: Language, texts: string[]): Promise<string[]> => {
    const res = await fetch(`${apiBase()}/api/translate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lang, texts }),
    });
    if (!res.ok) throw new ApiError(res.status, '/api/translate');
    return TranslateResponseSchema.parse(await res.json()).texts;
  },
  streamUrl: (id: string, opts: { from: number; speed?: number }) => {
    const q = new URLSearchParams({ from: String(opts.from) });
    if (opts.speed) q.set('speed', String(opts.speed));
    return `${apiBase()}/api/games/${encodeURIComponent(id)}/stream?${q}`;
  },
  chatUrl: (id: string) => `${apiBase()}/api/games/${encodeURIComponent(id)}/chat`,
  ttsUrl: () => `${apiBase()}/api/tts`,
};
