/**
 * Formation templates: 11 slots per side, as (dx downfield, dy to the offense's right) in yards
 * relative to the ball at the line of scrimmage. Defense slots use the same frame (dx > 0 is the
 * defense's side of the ball).
 */
import type { Formation, ParsedPlay } from '@gridcast/types';

export type Slot = {
  /** Stable slot key; also the depth-chart position used to fill it. */
  key: string;
  /** Depth chart position keys to try, in order. */
  pos: string[];
  /** Index into that position's depth list (WR1, WR2, ...). */
  depth?: number;
  dx: number;
  dy: number;
};

const OL: Slot[] = [
  { key: 'C', pos: ['C'], dx: 0, dy: 0 },
  { key: 'LG', pos: ['LG', 'G'], dx: -0.4, dy: -1.6 },
  { key: 'RG', pos: ['RG', 'G'], dx: -0.4, dy: 1.6 },
  { key: 'LT', pos: ['LT', 'T'], dx: -0.7, dy: -3.2 },
  { key: 'RT', pos: ['RT', 'T'], dx: -0.7, dy: 3.2 },
];

const WR = (depth: number, dx: number, dy: number): Slot => ({
  key: `WR${depth + 1}`,
  pos: ['WR'],
  depth,
  dx,
  dy,
});

export const OFFENSE: Record<Formation, Slot[]> = {
  shotgun: [
    ...OL,
    { key: 'QB', pos: ['QB'], dx: -5, dy: 0 },
    { key: 'RB', pos: ['RB'], dx: -5, dy: 1.6 },
    { key: 'TE', pos: ['TE'], dx: -0.7, dy: 4.6 },
    WR(0, -0.5, -19),
    WR(1, -0.5, 17),
    WR(2, -1.2, -11),
  ],
  under_center: [
    ...OL,
    { key: 'QB', pos: ['QB'], dx: -1, dy: 0 },
    { key: 'RB', pos: ['RB'], dx: -7, dy: 0 },
    { key: 'TE', pos: ['TE'], dx: -0.7, dy: 4.6 },
    WR(0, -0.5, -19),
    WR(1, -0.5, 17),
    WR(2, -1.2, -11),
  ],
  pistol: [
    ...OL,
    { key: 'QB', pos: ['QB'], dx: -4, dy: 0 },
    { key: 'RB', pos: ['RB'], dx: -7, dy: 0 },
    { key: 'TE', pos: ['TE'], dx: -0.7, dy: 4.6 },
    WR(0, -0.5, -19),
    WR(1, -0.5, 17),
    WR(2, -1.2, -11),
  ],
  empty: [
    ...OL,
    { key: 'QB', pos: ['QB'], dx: -5, dy: 0 },
    { key: 'RB', pos: ['RB'], dx: -1.2, dy: 9 },
    { key: 'TE', pos: ['TE'], dx: -0.7, dy: 4.6 },
    WR(0, -0.5, -19),
    WR(1, -0.5, 17),
    WR(2, -1.2, -11),
  ],
  victory: [
    ...OL,
    { key: 'QB', pos: ['QB'], dx: -1, dy: 0 },
    { key: 'RB', pos: ['RB'], dx: -6, dy: 0 },
    { key: 'TE', pos: ['TE'], dx: -0.7, dy: 4.6 },
    { key: 'WR1', pos: ['TE', 'WR'], depth: 1, dx: -0.7, dy: -4.6 },
    { key: 'WR2', pos: ['FB', 'RB'], depth: 1, dx: -2.5, dy: -1.5 },
    { key: 'WR3', pos: ['WR'], depth: 0, dx: -2.5, dy: 1.5 },
  ],
  punt: [
    ...OL.map((s) => ({ ...s, key: s.key, pos: s.key === 'C' ? ['LS', 'C'] : s.pos })),
    { key: 'QB', pos: ['P'], dx: -14, dy: 0 },
    { key: 'RB', pos: ['RB', 'FB'], dx: -5, dy: 1.6 },
    { key: 'TE', pos: ['TE'], dx: -1, dy: 4.6 },
    { key: 'WR1', pos: ['CB', 'WR'], dx: -0.5, dy: -21 },
    { key: 'WR2', pos: ['WR'], depth: 1, dx: -0.5, dy: 21 },
    { key: 'WR3', pos: ['TE', 'WR'], depth: 1, dx: -1, dy: -4.6 },
  ],
  fg: [
    ...OL.map((s) => ({ ...s, pos: s.key === 'C' ? ['LS', 'C'] : s.pos })),
    { key: 'QB', pos: ['PK', 'K'], dx: -9.5, dy: -1.5 },
    { key: 'RB', pos: ['H', 'P'], dx: -7, dy: 0 },
    { key: 'TE', pos: ['TE'], dx: -1, dy: 4.6 },
    { key: 'WR1', pos: ['TE', 'WR'], depth: 1, dx: -1, dy: -4.6 },
    { key: 'WR2', pos: ['WR'], dx: -1.6, dy: -5.6 },
    { key: 'WR3', pos: ['WR'], depth: 1, dx: -1.6, dy: 5.6 },
  ],
  kickoff: [
    { key: 'C', pos: ['PK', 'K'], dx: -6, dy: -1 },
    ...[-23, -18, -13, -8, -3].map((dy, i) => ({
      key: `KL${i}`,
      pos: ['LB', 'S', 'CB'],
      depth: i,
      dx: -1,
      dy,
    })),
    ...[3, 8, 13, 18, 23].map((dy, i) => ({
      key: `KR${i}`,
      pos: ['WR', 'CB', 'S'],
      depth: i,
      dx: -1,
      dy,
    })),
  ],
};

const DL: Slot[] = [
  { key: 'DE1', pos: ['LDE', 'DE', 'OLB'], dx: 1, dy: -4.2 },
  { key: 'DT1', pos: ['LDT', 'NT', 'DT'], dx: 1, dy: -1.2 },
  { key: 'DT2', pos: ['RDT', 'NT', 'DT'], dx: 1, dy: 1.2 },
  { key: 'DE2', pos: ['RDE', 'DE', 'OLB'], dx: 1, dy: 4.2 },
];

export const DEFENSE = {
  base: [
    ...DL,
    { key: 'LB1', pos: ['WLB', 'LILB', 'LB'], dx: 5, dy: -4 },
    { key: 'LB2', pos: ['MLB', 'RILB', 'LB'], dx: 5, dy: 0.5 },
    { key: 'NB', pos: ['NB', 'SLB', 'CB'], dx: 4, dy: 8 },
    { key: 'CB1', pos: ['LCB', 'CB'], dx: 6, dy: -19 },
    { key: 'CB2', pos: ['RCB', 'CB'], dx: 6, dy: 17 },
    { key: 'S1', pos: ['FS', 'S'], dx: 13, dy: -7 },
    { key: 'S2', pos: ['SS', 'S'], dx: 12, dy: 7 },
  ],
  goalLine: [
    ...DL,
    { key: 'LB1', pos: ['WLB', 'LILB', 'LB'], dx: 3, dy: -3 },
    { key: 'LB2', pos: ['MLB', 'RILB', 'LB'], dx: 3, dy: 1 },
    { key: 'NB', pos: ['SLB', 'NB', 'CB'], dx: 2, dy: 6 },
    { key: 'CB1', pos: ['LCB', 'CB'], dx: 3, dy: -17 },
    { key: 'CB2', pos: ['RCB', 'CB'], dx: 3, dy: 15 },
    { key: 'S1', pos: ['FS', 'S'], dx: 6, dy: -6 },
    { key: 'S2', pos: ['SS', 'S'], dx: 6, dy: 6 },
  ],
  puntReturn: [
    ...DL,
    { key: 'LB1', pos: ['WLB', 'LB'], dx: 2, dy: -6 },
    { key: 'LB2', pos: ['MLB', 'LB'], dx: 2, dy: 6 },
    { key: 'NB', pos: ['SLB', 'LB'], dx: 8, dy: 0 },
    { key: 'CB1', pos: ['LCB', 'CB'], dx: 1, dy: -20 },
    { key: 'CB2', pos: ['RCB', 'CB'], dx: 1, dy: 20 },
    { key: 'S1', pos: ['FS', 'S'], dx: 15, dy: -4 },
    { key: 'S2', pos: ['PR', 'KR', 'WR'], dx: 42, dy: 0 },
  ],
  kickReturn: [
    ...[-14, -6, 6, 14].map((dy, i) => ({
      key: ['DE1', 'DT1', 'DT2', 'DE2'][i]!,
      pos: ['TE', 'LB', 'DE'],
      depth: i,
      dx: 12,
      dy,
    })),
    { key: 'LB1', pos: ['LB', 'FB'], dx: 20, dy: -8 },
    { key: 'LB2', pos: ['LB', 'RB'], dx: 20, dy: 8 },
    { key: 'NB', pos: ['RB', 'FB'], dx: 28, dy: 0 },
    { key: 'CB1', pos: ['CB'], dx: 12, dy: -21 },
    { key: 'CB2', pos: ['CB'], depth: 1, dx: 12, dy: 21 },
    { key: 'S1', pos: ['S', 'RB'], dx: 52, dy: -4 },
    { key: 'S2', pos: ['KR', 'PR', 'WR'], dx: 62, dy: 3 },
  ],
  fgBlock: [
    ...DL,
    { key: 'LB1', pos: ['WLB', 'LB'], dx: 1, dy: -6.5 },
    { key: 'LB2', pos: ['MLB', 'LB'], dx: 1, dy: 6.5 },
    { key: 'NB', pos: ['SLB', 'LB'], dx: 4, dy: 0 },
    { key: 'CB1', pos: ['LCB', 'CB'], dx: 1.5, dy: -9 },
    { key: 'CB2', pos: ['RCB', 'CB'], dx: 1.5, dy: 9 },
    { key: 'S1', pos: ['FS', 'S'], dx: 8, dy: -4 },
    { key: 'S2', pos: ['SS', 'S'], dx: 8, dy: 4 },
  ],
} satisfies Record<string, Slot[]>;

export function offenseFormation(p: Pick<ParsedPlay, 'formation' | 'type'>): Formation {
  if (p.type === 'kickoff') return 'kickoff';
  if (p.type === 'punt') return 'punt';
  if (p.type === 'fg' || p.type === 'pat') return 'fg';
  if (p.type === 'kneel') return 'victory';
  return p.formation ?? 'shotgun';
}

export function defenseFormation(
  p: Pick<ParsedPlay, 'type'>,
  startYd: number,
): keyof typeof DEFENSE {
  if (p.type === 'kickoff') return 'kickReturn';
  if (p.type === 'punt') return 'puntReturn';
  if (p.type === 'fg' || p.type === 'pat') return 'fgBlock';
  return startYd >= 92 ? 'goalLine' : 'base';
}
