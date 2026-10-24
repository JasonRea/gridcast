import type { LoggedEvent, PlayEvent } from '@gridcast/types';
import { clockLabel, periodLabel } from './format';

export function playLabel(p: PlayEvent): string {
  return `${periodLabel(p.pre.quarter)} ${clockLabel(p.pre.clock)}`;
}

/** Home win probability swing caused by a play, in points (0-100). */
export function swing(p: PlayEvent): number {
  if (p.wpBefore === undefined || p.wpAfter === undefined) return 0;
  return (p.wpAfter - p.wpBefore) * 100;
}

/** Short headline for a play, from parsed facts. */
export function headline(p: PlayEvent): string {
  const pp = p.parsed;
  const name = (role: string) => {
    const n = pp.players.find((x) => x.role === role)?.name ?? '';
    return n.split('.').pop() ?? n;
  };
  switch (pp.type) {
    case 'pass':
      if (pp.result === 'interception') return `${name('passer')} intercepted`;
      if (pp.result === 'td') return `${name('passer')} to ${name('receiver')}, TD`;
      return pp.result === 'incomplete'
        ? `${name('passer')} incomplete`
        : `${name('passer')} to ${name('receiver')}, ${pp.yards} yds`;
    case 'run':
      return pp.result === 'td'
        ? `${name('rusher')} TD run`
        : pp.result === 'fumble'
          ? `${name('rusher')} fumble`
          : `${name('rusher')} ${pp.yards} yd run`;
    case 'sack':
      return `${name('passer')} sacked`;
    case 'fg':
      return `${pp.kickYards ?? ''}-yd FG ${pp.result === 'good' ? 'good' : 'missed'}`;
    case 'punt':
      return 'Punt';
    case 'kickoff':
      return pp.result === 'td' ? 'Kick return TD' : 'Kickoff';
    case 'penalty':
      return `Flag: ${pp.penalty?.name ?? 'penalty'}`;
    default:
      return pp.type;
  }
}

/**
 * Where a replay starts, from the page's `?from=` value: a play index ("120", 0-based) or a
 * period ("q4", "ot"). Returns the log seq to start the stream at, or undefined to start at the
 * top. Lets the demo open straight on a dramatic drive.
 */
export function startSeq(log: readonly LoggedEvent[], from: string | null): number | undefined {
  if (!from) return undefined;
  const plays = log.filter((e) => e.event.kind === 'play');
  const v = from.trim().toLowerCase();
  if (/^\d+$/.test(v)) return plays[Math.min(Number(v), plays.length - 1)]?.seq;
  const q = v === 'ot' ? 5 : /^q([1-5])$/.exec(v)?.[1];
  if (q === undefined) return undefined;
  return firstPlayOfQuarter(log, Number(q));
}

/** Log seq of the first play in a quarter (5 = overtime), if the game got there. */
export function firstPlayOfQuarter(
  log: readonly LoggedEvent[],
  quarter: number,
): number | undefined {
  return log.find((e) => e.event.kind === 'play' && e.event.pre.quarter >= quarter)?.seq;
}
