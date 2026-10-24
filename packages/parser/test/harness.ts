/**
 * Scores the parser against nflverse's labeled columns. nflverse `desc` reads like ESPN play
 * text, so every labeled play is a free test case.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { ParsedPlay, PlayType } from '@gridcast/types';
import { parsePlay } from '../src/index.ts';

export const FIXTURES = join(import.meta.dirname, '../../../data/fixtures/nflverse');
export const SEASONS = [2024, 2025, 2026] as const;

export type Row = Record<string, string>;

/** Minimal RFC 4180 CSV reader (quoted fields, escaped quotes, embedded commas). */
export function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows;
  if (!header) return [];
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

export function loadSeason(season: number): Row[] {
  const buf = gunzipSync(readFileSync(join(FIXTURES, `parser_eval_${season}.csv.gz`)));
  return parseCsv(buf.toString('utf8'));
}

const num = (s: string | undefined): number | undefined =>
  s === undefined || s === '' || s === 'NA' ? undefined : Number(s);

const flag = (s: string | undefined): boolean => Number(s) === 1;

export function expectedType(r: Row): PlayType {
  switch (r.play_type) {
    case 'pass':
      if (flag(r.sack)) return 'sack';
      if (flag(r.qb_spike)) return 'spike';
      return 'pass';
    case 'run':
      return 'run';
    case 'qb_kneel':
      return 'kneel';
    case 'qb_spike':
      return 'spike';
    case 'punt':
      return 'punt';
    case 'kickoff':
      return 'kickoff';
    case 'field_goal':
      return 'fg';
    case 'extra_point':
      return 'pat';
    case 'no_play':
      return flag(r.penalty) ? 'penalty' : 'other';
    default:
      return 'other';
  }
}

export function inputFor(r: Row) {
  const down = num(r.down);
  const distance = num(r.ydstogo);
  const ytg = num(r.yardline_100);
  return {
    text: r.desc ?? '',
    ...(down !== undefined ? { down } : {}),
    ...(distance !== undefined ? { distance } : {}),
    ...(ytg !== undefined ? { yardsToEndzone: ytg } : {}),
    ...(r.posteam ? { offense: r.posteam } : {}),
    ...(r.defteam ? { defense: r.defteam } : {}),
  };
}

type Metric = { ok: number; n: number };
const rate = (m: Metric) => (m.n ? m.ok / m.n : 1);

export type Mismatch = { metric: string; desc: string; expected: string; got: string };

export type EvalResult = {
  plays: number;
  type: Metric;
  yards: Metric;
  direction: Metric;
  result: Metric;
  mismatches: Mismatch[];
  confusion: Record<string, number>;
};

export function evaluate(rows: Row[], keepMismatches = 400): EvalResult {
  const out: EvalResult = {
    plays: 0,
    type: { ok: 0, n: 0 },
    yards: { ok: 0, n: 0 },
    direction: { ok: 0, n: 0 },
    result: { ok: 0, n: 0 },
    mismatches: [],
    confusion: {},
  };
  const miss = (metric: string, desc: string, expected: unknown, got: unknown) => {
    if (out.mismatches.length < keepMismatches)
      out.mismatches.push({ metric, desc, expected: String(expected), got: String(got) });
  };
  for (const r of rows) {
    out.plays++;
    let p: ParsedPlay;
    try {
      p = parsePlay(inputFor(r));
    } catch (e) {
      miss('crash', r.desc ?? '', 'no throw', (e as Error).message);
      continue;
    }
    const exp = expectedType(r);
    out.type.n++;
    if (p.type === exp) out.type.ok++;
    else {
      const key = `${exp}->${p.type}`;
      out.confusion[key] = (out.confusion[key] ?? 0) + 1;
      miss('type', r.desc ?? '', exp, p.type);
    }

    // Yards: scrimmage plays where nflverse labels the gain (two-point tries carry no gain).
    const yg = num(r.yards_gained);
    if (
      ['run', 'pass', 'sack', 'kneel'].includes(exp) &&
      yg !== undefined &&
      !flag(r.two_point_attempt)
    ) {
      out.yards.n++;
      if (p.yards === yg) out.yards.ok++;
      else miss('yards', r.desc ?? '', yg, p.yards);
    }

    // Direction: pass_location for passes, run_location for runs.
    const dir = exp === 'pass' ? r.pass_location : exp === 'run' ? r.run_location : '';
    if (dir && dir !== 'NA') {
      out.direction.n++;
      if (p.direction === dir) out.direction.ok++;
      else miss('direction', r.desc ?? '', dir, p.direction);
    }

    // Result spot-check on passes: complete / incomplete / interception.
    if (exp === 'pass' && !flag(r.two_point_attempt)) {
      out.result.n++;
      const want = flag(r.interception)
        ? 'interception'
        : flag(r.complete_pass)
          ? ['complete', 'td', 'fumble']
          : 'incomplete';
      const ok = Array.isArray(want) ? want.includes(p.result) : p.result === want;
      if (ok) out.result.ok++;
      else miss('result', r.desc ?? '', want, p.result);
    }
  }
  return out;
}

export const pct = (m: Metric) => `${(rate(m) * 100).toFixed(2)}%`;
export { rate };
