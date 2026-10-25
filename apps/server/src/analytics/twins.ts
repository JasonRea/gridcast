/**
 * Historical twins (A4): what NFL teams did on 4th down in the same spot, 2016-2025. Reads the
 * table built offline by scripts/build_twins.py (data/assets/twins.json) and uses the bucket
 * edges stored in it, so the server buckets exactly like the script. Falls back from the most
 * specific situation to broader ones until there are enough plays.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { FourthDownHistory, GameState } from '@gridcast/types';

const TwinsSchema = z.object({
  seasons: z.tuple([z.number(), z.number()]),
  minN: z.number(),
  buckets: z.object({
    distance: z.array(z.number()),
    field: z.array(z.number()),
    score: z.array(z.number()),
    time: z.array(z.string()),
  }),
  levels: z.array(z.array(z.enum(['d', 'f', 's', 't']))),
  cells: z.record(
    z.string(),
    z.tuple([z.number(), z.number(), z.number(), z.number(), z.number()]),
  ),
});
type TwinsTable = z.infer<typeof TwinsSchema>;

export function loadTwins(assetsDir: string): Twins | undefined {
  const p = join(assetsDir, 'twins.json');
  if (!existsSync(p)) return undefined;
  const t = TwinsSchema.safeParse(JSON.parse(readFileSync(p, 'utf8')));
  return t.success ? new Twins(t.data) : undefined;
}

const bucket = (v: number, edges: number[]) => {
  const i = edges.findIndex((e) => v <= e);
  return i < 0 ? edges.length : i;
};

const secondsLeft = (s: GameState) => {
  const [m, sec] = s.clock.split(':').map(Number);
  return Math.max(0, 4 - Math.min(4, s.quarter)) * 900 + (m ?? 0) * 60 + (sec ?? 0);
};

/** Never below this many plays, whatever the table's own minimum. */
const MIN_PLAYS = 30;

export class Twins {
  constructor(private readonly t: TwinsTable) {}

  private label(dims: string[], k: Record<string, number>): string {
    const { distance, field, score } = this.t.buckets;
    const range = (edges: number[], i: number, unit = '') => {
      const lo = i === 0 ? undefined : edges[i - 1]! + 1;
      const hi = edges[i];
      if (hi === undefined) return `${lo}+${unit}`;
      if (lo === undefined || lo === hi) return `${hi}${unit}`;
      return `${lo}-${hi}${unit}`;
    };
    const parts = [`4th & ${range(distance, k.d!)}`];
    const f = k.f!;
    parts.push(
      f === 0
        ? `${field[0]} or fewer yards from the end zone`
        : `${range(field, f)} yards from the end zone`,
    );
    if (dims.includes('s')) {
      const s = k.s!;
      const lo = s === 0 ? undefined : score[s - 1]! + 1;
      const hi = score[s];
      parts.push(
        hi === 0 && lo === 0
          ? 'tied'
          : hi !== undefined && hi < 0
            ? `down ${-hi}${lo === undefined ? '+' : `-${-lo}`}`
            : `up ${lo}${hi === undefined ? '+' : `-${hi}`}`,
      );
    }
    if (dims.includes('t'))
      parts.push(
        ['in the first three quarters', 'in the 4th quarter', 'in the last 5 minutes'][k.t!]!,
      );
    return parts.join(', ');
  }

  /** What teams did facing this 4th down. `offenseIsHome` sets the sign of the score margin. */
  lookup(s: GameState, offenseIsHome: boolean): FourthDownHistory | undefined {
    if (s.down !== 4 || s.distance === undefined) return undefined;
    const margin = offenseIsHome ? s.home - s.away : s.away - s.home;
    const secs = secondsLeft(s);
    const k: Record<string, number> = {
      d: bucket(s.distance, this.t.buckets.distance),
      f: bucket(100 - s.yardLine, this.t.buckets.field),
      s: bucket(margin, this.t.buckets.score),
      t: s.quarter >= 5 || (s.quarter === 4 && secs <= 300) ? 2 : s.quarter === 4 ? 1 : 0,
    };
    for (const dims of this.t.levels) {
      const cell = this.t.cells[dims.map((d) => k[d]).join(':')];
      if (!cell || cell[0] < Math.max(MIN_PLAYS, this.t.minN)) continue;
      const [n, go, conv, fg, punt] = cell;
      return {
        n,
        goRate: Math.round((go / n) * 1000) / 1000,
        ...(go >= 10 ? { convRate: Math.round((conv / go) * 1000) / 1000 } : {}),
        fgRate: Math.round((fg / n) * 1000) / 1000,
        puntRate: Math.round((punt / n) * 1000) / 1000,
        situation: this.label(dims, k),
        seasons: `${this.t.seasons[0]}-${this.t.seasons[1]}`,
      };
    }
    return undefined;
  }
}
