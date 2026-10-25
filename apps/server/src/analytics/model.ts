/**
 * Expected points, EPA and the 4th-down bot, from lookup tables precomputed offline from nflverse
 * (scripts/build_analytics.py -> data/assets). Pure functions over the tables.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { FourthChoice, FourthDownCall, GameState, PlayEvent } from '@gridcast/types';

const EpTableSchema = z.object({
  distBuckets: z.array(z.number()),
  yardLineBucket: z.number(),
  ep: z.array(z.array(z.array(z.number()))),
});
const FourthSchema = z.object({
  goConversion: z.array(z.number()),
  fgMake: z.record(z.string(), z.number()),
  puntOppYardLine: z.array(z.number()),
  yardLineBucket: z.number(),
});

export type Tables = { ep: z.infer<typeof EpTableSchema>; fourth: z.infer<typeof FourthSchema> };

export function loadTables(assetsDir: string): Tables | undefined {
  const epPath = join(assetsDir, 'ep_table.json');
  const fdPath = join(assetsDir, 'fourth_down.json');
  if (!existsSync(epPath) || !existsSync(fdPath)) return undefined;
  const ep = EpTableSchema.safeParse(JSON.parse(readFileSync(epPath, 'utf8')));
  const fourth = FourthSchema.safeParse(JSON.parse(readFileSync(fdPath, 'utf8')));
  return ep.success && fourth.success ? { ep: ep.data, fourth: fourth.data } : undefined;
}

const r1 = (n: number) => Math.round(n * 100) / 100;

export class Analytics {
  constructor(private readonly t: Tables) {}

  /** EP for the offense with `down` & `distance` at `yardLine` (0-100 from its own goal line). */
  ep(down: number, distance: number, yardLine: number): number {
    const d = Math.min(4, Math.max(1, Math.round(down)));
    const db = this.t.ep.distBuckets.findIndex((hi) => distance <= hi);
    const ytg = Math.min(99, Math.max(1, Math.round(100 - yardLine)));
    const yb = Math.floor((ytg - 1) / this.t.ep.yardLineBucket);
    return this.t.ep.ep[d - 1]?.[db < 0 ? this.t.ep.distBuckets.length - 1 : db]?.[yb] ?? 0;
  }

  /** EP of a game state from the possession team's point of view (1st & 10 when no down). */
  epState(s: GameState): number {
    return this.ep(s.down ?? 1, s.distance ?? 10, s.yardLine);
  }

  /** EPA for a scrimmage play: EP after minus EP before (scores use points scored). */
  epa(p: PlayEvent): number | undefined {
    const pp = p.parsed;
    if (!['run', 'pass', 'sack', 'penalty', 'punt', 'fg', 'kneel', 'spike'].includes(pp.type))
      return undefined;
    if (!p.pre.down) return undefined;
    const before = this.ep(p.pre.down, p.pre.distance ?? 10, p.pre.yardLine);
    let after: number;
    // A touchdown is worth 6 plus the expected try, whatever the try did (ESPN folds it into
    // the same play, so pp.points can be 6, 7 or 8).
    if (pp.points && pp.result === 'td') after = 6.95;
    else if (pp.points && pp.result === 'good') after = pp.points;
    else if (p.state.possession !== p.pre.possession) after = -this.epState(p.state);
    else after = this.epState(p.state);
    return r1(after - before);
  }

  goProb(distance: number): number {
    const c = this.t.fourth.goConversion;
    return c[Math.min(c.length - 1, Math.max(0, Math.round(distance) - 1))] ?? 0.5;
  }

  fgProb(yardLine: number): number | undefined {
    const dist = Math.round(100 - yardLine + 17);
    if (dist > 66) return undefined;
    return this.t.fourth.fgMake[String(Math.max(18, dist))];
  }

  private puntOpp(yardLine: number): number {
    const ytg = Math.min(99, Math.max(1, Math.round(100 - yardLine)));
    const b = this.t.fourth.puntOppYardLine;
    return b[Math.floor((ytg - 1) / this.t.fourth.yardLineBucket)] ?? 20;
  }

  /** Go / punt / field goal in expected points for the offense facing 4th & `distance`. */
  fourthDown(s: GameState): FourthDownCall | undefined {
    if (s.down !== 4 || s.distance === undefined) return undefined;
    const yl = s.yardLine;
    const dist = s.distance;
    const goProb = this.goProb(dist);
    const success = Math.min(99, yl + dist);
    const goal = success >= 100 || yl + dist >= 100;
    const goSuccessEp = goal ? 6.95 : this.ep(1, Math.min(10, 100 - success), success);
    const go = goProb * goSuccessEp + (1 - goProb) * -this.ep(1, 10, 100 - yl);
    const options: FourthDownCall['options'] = { go: r1(go) };
    const fgProb = this.fgProb(yl);
    if (fgProb !== undefined) {
      const missAt = Math.max(20, 100 - (yl - 7));
      options.fg = r1(
        fgProb * 3 + (1 - fgProb) * -this.ep(1, 10, 100 - Math.max(yl - 7, 100 - missAt)),
      );
    }
    if (yl < 65) options.punt = r1(-this.ep(1, 10, this.puntOpp(yl)));
    const recommend = (Object.entries(options) as [FourthChoice, number][]).sort(
      (a, b) => b[1] - a[1],
    )[0]![0];
    return {
      options,
      recommend,
      goProb: r1(goProb),
      ...(fgProb !== undefined ? { fgProb: r1(fgProb) } : {}),
    };
  }

  /** Grades the actual call on a 4th-down snap. */
  grade(p: PlayEvent): FourthDownCall | undefined {
    const rec = this.fourthDown(p.pre);
    if (!rec) return undefined;
    const t = p.parsed.type;
    const call: FourthChoice | undefined =
      t === 'punt'
        ? 'punt'
        : t === 'fg'
          ? 'fg'
          : ['run', 'pass', 'sack'].includes(t)
            ? 'go'
            : undefined;
    if (!call) return rec;
    const best = rec.options[rec.recommend] ?? 0;
    const chosen = rec.options[call];
    return {
      ...rec,
      call,
      ...(chosen !== undefined ? { delta: r1(Math.max(0, best - chosen)) } : {}),
    };
  }

  /** Normalizer hook: attaches EPA and 4th-down calls to a play. */
  enrich = (p: PlayEvent): PlayEvent => {
    const epa = this.epa(p);
    const fourth = p.pre.down === 4 ? this.grade(p) : undefined;
    const next =
      p.state.down === 4 && p.state.possession === p.pre.possession
        ? this.fourthDown(p.state)
        : undefined;
    return {
      ...p,
      ...(epa !== undefined ? { epa } : {}),
      ...(fourth ? { fourthDown: fourth } : {}),
      ...(next ? { nextFourthDown: next } : {}),
    };
  };
}
