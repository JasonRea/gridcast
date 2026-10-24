import type { GameState } from '@gridcast/types';

const ORD = ['', '1st', '2nd', '3rd', '4th'];

export function periodLabel(q: number): string {
  return q <= 4 ? `Q${q}` : q === 5 ? 'OT' : `${q - 4}OT`;
}

export function clockLabel(clock: string): string {
  const [m, s] = clock.split(':');
  return `${Number(m ?? 0)}:${(s ?? '00').padStart(2, '0')}`;
}

export function downDistance(s: Pick<GameState, 'down' | 'distance' | 'yardLine'>): string {
  if (!s.down) return '';
  const goal = s.distance !== undefined && s.yardLine + s.distance >= 100;
  return `${ORD[s.down] ?? `${s.down}th`} & ${goal ? 'Goal' : (s.distance ?? '')}`;
}

/** "PIT 38", "TB 12", "50" from the possession team's frame. */
export function ballOn(s: Pick<GameState, 'yardLine' | 'possession'>, other: string): string {
  if (s.yardLine === 50) return '50';
  return s.yardLine < 50 ? `${s.possession} ${s.yardLine}` : `${other} ${100 - s.yardLine}`;
}

export function pct(p: number | undefined): string {
  return p === undefined ? '--' : `${Math.round(p * 100)}%`;
}

export function kickoffLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}
