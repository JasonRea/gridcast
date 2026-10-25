/** Matches highlight posts to plays: posted within 5 min after the play, plus names or keywords. */
import type { PlayEvent } from '@gridcast/types';

export type Post = { id: string; text: string; createdAt: number; author?: string };

export const WINDOW_MS = 5 * 60_000;

const surname = (n: string) => (n.split('.').pop() ?? n).trim().toLowerCase();

export function score(post: Post, p: PlayEvent): number {
  const t = post.text.toLowerCase();
  let s = 0;
  for (const pl of p.parsed.players) {
    const last = surname(pl.name);
    if (last.length > 2 && t.includes(last)) s += pl.role === 'tackler' ? 1 : 2;
  }
  const r = p.parsed.result;
  if (r === 'td' && /touchdown|\btd\b/.test(t)) s += 2;
  if (r === 'interception' && /intercept|\bpick(ed)?\b|\bint\b/.test(t)) s += 2;
  if (r === 'fumble' && /fumble|strip/.test(t)) s += 2;
  if (p.parsed.type === 'fg' && /field goal|\bfg\b|from \d+ yards?/.test(t)) s += 1;
  if (p.parsed.type === 'sack' && /sack/.test(t)) s += 1;
  return s;
}

/** Best play for a post among plays in its time window, or undefined below the bar. */
export function matchPost(
  post: Post,
  plays: PlayEvent[],
  windowMs = WINDOW_MS,
): PlayEvent | undefined {
  const candidates = plays.filter(
    (p) => post.createdAt >= p.ts && post.createdAt - p.ts <= windowMs,
  );
  let best: { p: PlayEvent; s: number } | undefined;
  for (const p of candidates) {
    const s = score(post, p) + (p.big ? 1 : 0);
    if (!best || s > best.s || (s === best.s && p.ts > best.p.ts)) best = { p, s };
  }
  return best && best.s >= 3 ? best.p : undefined;
}
