/** Low-level text helpers shared by the play parser. Pure functions, no state. */
import { normalizeAbbr } from '@gridcast/types';

/**
 * A player reference in play text. nflverse writes "8-A.Rodgers", ESPN writes "A.Rodgers".
 * Handles multi-letter initials ("Ja.Williams"), double initials ("C.J.Stroud") and multi-word
 * last names ("A.St. Brown", "T.Van Ginkel").
 */
const NAME_CORE =
  "[A-Z][A-Za-z]{0,3}\\.(?:[A-Z]\\.)?\\s?(?:St\\.\\s?|Van\\s|Vander\\s|Von\\s|Del\\s|De\\s|Da\\s|Di\\s|Le\\s|La\\s|El\\s|Ta\\s)?[A-Z][A-Za-z'\\-]*(?:\\s(?:Jr\\.?|Sr\\.?|II|III|IV|V)(?![A-Za-z]))?";
export const NAME = `(?:(\\d{1,2})-)?(${NAME_CORE})`;

/** "(12:34) " prefix, plus leading formation tags we read separately. */
export function stripClock(text: string): string {
  return text.replace(/^\s*\(\s*\d{0,2}:\d{2}\s*\)\s*/, '').trim();
}

export function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** "for 13 yards", "for -3 yds", "for no gain", "for 1 yard". */
export const GAIN = /\bfor (?:(-?\d+) (?:yards?|yds?)\b|(no gain))/i;

export function parseGain(s: string): number | undefined {
  const m = GAIN.exec(s);
  if (!m) return undefined;
  if (m[2]) return 0;
  return m[1] !== undefined ? Number(m[1]) : undefined;
}

/** A field spot "TB 49", "PIT -5", "50". Returns the side (normalized) and yard number. */
export type Spot = { side?: string; yd: number };

export const SPOT = '(?:([A-Z]{2,3}) (-?\\d{1,2})|(50))';

export function toSpot(
  side: string | undefined,
  num: string | undefined,
  fifty?: string,
): Spot | undefined {
  if (fifty) return { yd: 50 };
  if (!side || num === undefined) return undefined;
  return { side: normalizeAbbr(side), yd: Number(num) };
}

/**
 * Converts a spot to 0-100 yards from the offense's own goal line. Needs at least one team
 * abbreviation to know which half of the field "TB 49" refers to.
 */
export function spotToYd(spot: Spot, offense?: string, defense?: string): number | undefined {
  if (spot.side === undefined) return spot.yd;
  const off = offense ? normalizeAbbr(offense) : undefined;
  const def = defense ? normalizeAbbr(defense) : undefined;
  if (off && spot.side === off) return spot.yd;
  if (def && spot.side === def) return 100 - spot.yd;
  if (off && spot.side !== off) return 100 - spot.yd;
  if (def && spot.side !== def) return spot.yd;
  return undefined;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
