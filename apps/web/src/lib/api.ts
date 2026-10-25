/** The web app talks only to the Gridcast server. Never to ESPN, Kalshi, X or Claude directly. */
import {
  TranslateResponseSchema,
  type EventsResponse,
  type GameDetail,
  type Language,
  type ScoreboardResponse,
} from '@gridcast/types';

export const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return (await res.json()) as T;
}

export const api = {
  scoreboard: (season?: number, week?: number) => {
    const q = new URLSearchParams();
    if (season) q.set('season', String(season));
    if (week) q.set('week', String(week));
    return get<ScoreboardResponse>(`/api/games?${q}`);
  },
  game: (id: string) => get<GameDetail>(`/api/games/${id}`),
  events: (id: string, from = 0) => get<EventsResponse>(`/api/games/${id}/events?from=${from}`),
  /** Commentary lines in another language, same order. Throws when translation is off. */
  translate: async (lang: Language, texts: string[]): Promise<string[]> => {
    const res = await fetch(`${API_BASE}/api/translate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lang, texts }),
    });
    if (!res.ok) throw new Error(`translate ${res.status}`);
    return TranslateResponseSchema.parse(await res.json()).texts;
  },
  streamUrl: (id: string, opts: { from: number; speed?: number }) => {
    const q = new URLSearchParams({ from: String(opts.from) });
    if (opts.speed) q.set('speed', String(opts.speed));
    return `${API_BASE}/api/games/${id}/stream?${q}`;
  },
};
