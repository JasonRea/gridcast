/**
 * Matches a Kalshi game event to one of our games. Event tickers look like
 * KXNFLGAME-26OCT25PITNO (date + away + home); each team has a market ending in -<TEAM>.
 */
import { kalshiYesProb, normalizeAbbr, type KalshiEvent } from '@gridcast/types';

/** Spellings a team may have in Kalshi tickers. */
const VARIANTS: Record<string, string[]> = {
  LAR: ['LAR', 'LA'],
  WSH: ['WSH', 'WAS'],
  JAX: ['JAX', 'JAC'],
  LV: ['LV', 'LVR'],
};

function variants(abbr: string): string[] {
  const a = normalizeAbbr(abbr);
  return VARIANTS[a] ?? [a];
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** "26OCT25" for a kickoff, in US Eastern date (Kalshi uses the local game date). */
export function dateCode(kickoffIso: string): string {
  const d = new Date(Date.parse(kickoffIso) - 4 * 3600_000);
  return `${String(d.getUTCFullYear()).slice(2)}${MONTHS[d.getUTCMonth()]}${String(d.getUTCDate()).padStart(2, '0')}`;
}

export type MatchedOdds = { ticker: string; homeProb: number };

export function matchGame(
  events: KalshiEvent[],
  game: { home: string; away: string; kickoff: string },
): MatchedOdds | undefined {
  const code = dateCode(game.kickoff);
  const homes = variants(game.home);
  const aways = variants(game.away);
  const ev = events.find((e) => {
    const suffix = e.event_ticker.split('-')[1] ?? '';
    if (!suffix.startsWith(code)) return false;
    const teams = suffix.slice(code.length);
    return aways.some((a) => homes.some((h) => teams === `${a}${h}` || teams === `${h}${a}`));
  });
  if (!ev?.markets?.length) return undefined;
  const marketFor = (vs: string[]) =>
    ev.markets!.find((m) => vs.some((v) => m.ticker.endsWith(`-${v}`)));
  const home = marketFor(homes);
  const away = marketFor(aways);
  const ph = home ? kalshiYesProb(home) : undefined;
  const pa = away ? kalshiYesProb(away) : undefined;
  let homeProb: number | undefined;
  if (ph !== undefined && pa !== undefined)
    homeProb = ph / (ph + pa); // remove the spread between the two books
  else homeProb = ph ?? (pa !== undefined ? 1 - pa : undefined);
  if (homeProb === undefined || !Number.isFinite(homeProb)) return undefined;
  return { ticker: (home ?? away)!.ticker, homeProb: Math.round(homeProb * 1000) / 1000 };
}
