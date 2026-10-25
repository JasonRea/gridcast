import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EspnSummarySchema, type PlayEvent } from '@gridcast/types';
// The server normalizer is pure; reuse it so these tests run on real fixture plays.
import { normalizeSummary } from '../../server/src/pipeline/normalize';
// Parity check against the web's GSAP timelines (test-only: the app never loads GSAP).
import { buildTimeline } from '../../web/src/field/animate';
import { gsap } from 'gsap';
import { MotionPathPlugin } from 'gsap/MotionPathPlugin';
import { absX, FIELD_H, FIELD_W } from '@web/field/geometry';
import { buildLineup } from '@web/field/lineup';
import { BALL, BANNER, planPlay, templateFor, type Template } from '../src/field/plan';
import { progressOf, Timeline } from '../src/field/timeline';

gsap.registerPlugin(MotionPathPlugin);

const fixture = (name: string) =>
  JSON.parse(readFileSync(join(import.meta.dirname, '../../../data/fixtures/espn', name), 'utf8'));
const summary = EspnSummarySchema.parse(fixture('summary_401873002.json'));
const plays: PlayEvent[] = normalizeSummary(summary)!.events.flatMap((e) =>
  e.kind === 'play' ? [e] : [],
);
const teams = { home: 'TB', away: 'PIT' };
const o = { homeAbbr: 'TB' };

function plan(play: PlayEvent) {
  const lineup = buildLineup({ play, teams, depth: {}, rosters: {} });
  const p = planPlay({
    play,
    frame: lineup.frame,
    players: lineup.players,
    o,
    colors: { offense: '#D50A0A', defense: '#FFB612', ball: '#F5F5F5' },
    names: { offense: 'Bucs', defense: 'Steelers' },
    teams: ['TB', 'PIT'],
  });
  return { ...p, lineup };
}

/** Synthetic variants so every template is covered even if the fixture lacks one. */
function variant(base: PlayEvent, parsed: Partial<PlayEvent['parsed']>): PlayEvent {
  return { ...base, id: `${base.id}9`, parsed: { ...base.parsed, ...parsed } };
}

describe('timeline engine', () => {
  it('resolves GSAP position strings', () => {
    const tl = new Timeline();
    tl.to('a', { x: 1, duration: 1 }, 2);
    expect(tl.at('<')).toBe(2);
    expect(tl.at('>')).toBe(3);
    expect(tl.at('>+1.1')).toBeCloseTo(4.1);
    expect(tl.at('<+0.5')).toBeCloseTo(2.5);
    expect(tl.at(undefined)).toBe(3);
  });

  it('handles yoyo / repeat like GSAP', () => {
    const tw = { target: 'a', start: 0, dur: 1, ease: 'none' as const, to: {}, order: 0 };
    expect(progressOf({ ...tw, yoyo: true, repeat: 1 }, 0.5)).toBeCloseTo(0.5);
    expect(progressOf({ ...tw, yoyo: true, repeat: 1 }, 1.5)).toBeCloseTo(0.5);
    expect(progressOf({ ...tw, yoyo: true, repeat: 1 }, 5)).toBe(0);
    expect(progressOf({ ...tw, yoyo: true, repeat: 2 }, 5)).toBe(1);
  });

  it('chains tweens from where the previous one left off', () => {
    const tl = new Timeline();
    tl.to('a', { x: 100, duration: 1, ease: 'none' }, 0);
    tl.to('a', { x: 0, duration: 1, ease: 'none' }, 0.5);
    const c = tl.compile({ a: { x: 0, y: 0, opacity: 1, scale: 1 } });
    expect(c.sample(0.5).a!.x).toBeCloseTo(50);
    expect(c.sample(1).a!.x).toBeCloseTo(25);
    expect(c.sample(2).a!.x).toBeCloseTo(0);
  });
});

describe('planPlay on the demo game (401873002)', () => {
  it('plans every play: finite, on the field, 3-6 s plus the closing beat', () => {
    expect(plays.length).toBeGreaterThan(150);
    for (const play of plays) {
      const p = plan(play);
      expect(p.durationMs, play.raw.text).toBeGreaterThanOrEqual(2500);
      expect(p.durationMs, play.raw.text).toBeLessThanOrEqual(8000);
      for (let t = 0; t <= p.timeline.duration; t += 0.25) {
        const f = p.timeline.sample(t);
        for (const [k, s] of Object.entries(f)) {
          expect(Number.isFinite(s.x) && Number.isFinite(s.y), `${play.id} ${k} @${t}`).toBe(true);
          expect(s.opacity).toBeGreaterThanOrEqual(0);
          expect(s.opacity).toBeLessThanOrEqual(1);
        }
        const b = f[BALL]!;
        expect(b.x).toBeGreaterThan(-200);
        expect(b.x).toBeLessThan(FIELD_W + 200);
        expect(b.y).toBeGreaterThan(-200);
        expect(b.y).toBeLessThan(FIELD_H + 200);
      }
    }
  });

  it('lines every player up on their formation spot after the 0.5 s line-up', () => {
    for (const play of plays.slice(0, 60)) {
      const p = plan(play);
      const f = p.timeline.sample(0.5);
      for (const pl of p.lineup.players) {
        // Movement starts at the snap (0.75 s), so 0.5 s is the formation exactly.
        expect(f[pl.key]!.x).toBeCloseTo(pl.pos.x, 3);
        expect(f[pl.key]!.y).toBeCloseTo(pl.pos.y, 3);
      }
    }
  });

  it('ends the ball on the play end spot for runs, completions and returns', () => {
    for (const play of plays) {
      const p = plan(play);
      const tmpl = p.template;
      if (!['run', 'pass_complete', 'touchdown', 'turnover'].includes(tmpl)) continue;
      if (tmpl === 'turnover' && play.parsed.result === 'fumble') continue;
      const end = p.timeline.sample(p.timeline.duration)[BALL]!;
      expect(end.x, play.raw.text).toBeCloseTo(
        absX(p.lineup.frame.offense, p.lineup.frame.endYd, o),
        0,
      );
    }
  });

  it('covers all 10 templates plus generic', () => {
    const seen = new Set<Template>(plays.map(templateFor));
    const base = plays.find((p) => p.parsed.type === 'pass')!;
    const extra: PlayEvent[] = [
      variant(base, { type: 'run', result: 'normal' }),
      variant(base, { type: 'pass', result: 'complete' }),
      variant(base, { type: 'pass', result: 'incomplete' }),
      variant(base, { type: 'pass', result: 'interception' }),
      variant(base, { type: 'run', result: 'fumble' }),
      variant(base, { type: 'sack', result: 'normal', yards: -7, endYd: base.parsed.startYd - 7 }),
      variant(base, { type: 'punt', result: 'normal', kickYards: 45, fairCatch: true }),
      variant(base, { type: 'fg', result: 'good', kickYards: 40 }),
      variant(base, {
        type: 'penalty',
        result: 'normal',
        penalty: { name: 'Holding', team: 'TB', yards: 10, accepted: true, noPlay: true },
      }),
      variant(base, { type: 'pass', result: 'td', yards: 30 }),
      variant(base, { type: 'kneel', result: 'normal' }),
      variant(base, { type: 'spike', result: 'incomplete' }),
      variant(base, { type: 'other', result: 'normal' }),
    ];
    for (const e of extra) {
      seen.add(templateFor(e));
      const p = plan(e);
      expect(p.durationMs).toBeGreaterThan(2000);
    }
    expect([...seen].sort()).toEqual(
      [
        'field_goal',
        'generic',
        'kick',
        'kneel_spike',
        'pass_complete',
        'pass_incomplete',
        'penalty',
        'run',
        'sack',
        'touchdown',
        'turnover',
      ].sort(),
    );
  });

  it('shows the TOUCHDOWN banner on touchdowns', () => {
    const td = plays.find((p) => templateFor(p) === 'touchdown')!;
    const p = plan(td);
    const texts = new Set<string>();
    for (let t = 0; t <= p.timeline.duration; t += 0.1) {
      const b = p.timeline.sample(t)[BANNER]!;
      if (b.opacity > 0.5 && b.text) texts.add(b.text);
    }
    expect([...texts]).toContain('TOUCHDOWN');
  });
});

describe('parity with the web GSAP timelines', () => {
  type Obj = Record<string, unknown> & { setAttribute: (k: string, v: string) => void };
  const obj = (init: Record<string, unknown>): Obj => ({
    ...init,
    setAttribute(k: string, v: string) {
      this[k] = v;
    },
  });

  it('matches GSAP positions for players at every 0.2 s and for the ball at the end', () => {
    const warn = console.warn;
    console.warn = () => undefined; // GSAP complains about DOM-only plugins in Node.
    let compared = 0;
    let worst = 0;
    let worstAt = '';
    for (const play of plays) {
      const ours = plan(play);
      const { players, frame } = ours.lineup;
      const els = new Map(
        players.map((pl) => [
          pl.key,
          obj({ x: pl.pos.x, y: pl.pos.y, opacity: pl.involved ? 1 : 0.55, scale: 1 }),
        ]),
      );
      // Plain object (no setAttribute) so MotionPathPlugin treats it as a generic target.
      const ball: Record<string, unknown> = { x: 0, y: 0, scale: 1, opacity: 1 };
      const tl = buildTimeline({
        play,
        frame,
        players,
        o,
        colors: { offense: '#D50A0A', defense: '#FFB612', ball: '#F5F5F5' },
        names: { offense: 'Bucs', defense: 'Steelers' },
        targets: {
          player: (k) => (els.get(k) ?? null) as unknown as SVGGElement,
          ball: ball as unknown as SVGGElement,
          ballBody: obj({ fill: '#F5F5F5' }) as unknown as SVGElement,
          flag: obj({ x: 0, y: 0, opacity: 0 }) as unknown as SVGGElement,
          banner: obj({ opacity: 0, scale: 1, textContent: '' }) as unknown as SVGTextElement,
          marker: obj({ opacity: 0, x: 0, y: 0, textContent: '' }) as unknown as SVGTextElement,
          flash: () => null,
        },
      });
      expect(ours.timeline.duration).toBeCloseTo(tl.duration(), 3);
      // Step GSAP at 120 fps like real playback (it records a tween's start values on its first
      // rendered frame), comparing every 0.2 s.
      for (let step = 0; step / 120 <= tl.duration(); step++) {
        const t = step / 120;
        tl.seek(t, false);
        if (step % 24 !== 0) continue;
        const f = ours.timeline.sample(t);
        for (const pl of players) {
          const g = els.get(pl.key)!;
          // Within 0.2 yards (2 SVG units) of GSAP at every sample.
          const dx = Math.abs(f[pl.key]!.x - (g.x as number));
          const dy = Math.abs(f[pl.key]!.y - (g.y as number));
          if (Math.max(dx, dy) > worst)
            worstAt = `${play.id} ${templateFor(play)} ${pl.key} @${t.toFixed(1)}`;
          worst = Math.max(worst, dx, dy);
          expect(dx, `${play.id} ${pl.key} x @${t.toFixed(1)}`).toBeLessThan(2);
          expect(dy, `${play.id} ${pl.key} y @${t.toFixed(1)}`).toBeLessThan(2);
          compared++;
        }
      }
      tl.seek(tl.duration(), false);
      const end = ours.timeline.sample(ours.timeline.duration)[BALL]!;
      // GSAP's MotionPathPlugin needs a DOM, so in Node it leaves arcs (kicks, incompletions,
      // field goals) unmoved; compare the ball only where the play ends on a plain tween.
      if (['kick', 'pass_incomplete', 'field_goal'].includes(ours.template)) {
        tl.kill();
        continue;
      }
      expect(Math.abs(end.x - (ball.x as number)), `${play.id} ball x`).toBeLessThan(2);
      expect(Math.abs(end.y - (ball.y as number)), `${play.id} ball y`).toBeLessThan(2);
      tl.kill();
    }
    expect(compared).toBeGreaterThan(10_000);
    console.warn = warn;
    console.info(`GSAP parity: ${compared} samples, worst ${worst.toFixed(2)} units at ${worstAt}`);
  });
});
