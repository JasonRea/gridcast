import type { PlayEvent } from '@gridcast/types';
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
