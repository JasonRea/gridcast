/**
 * A tiny, pure stand-in for the slice of GSAP's timeline that apps/web/src/field/animate.ts uses:
 * `to`, `fromTo`, `set`, `call`-style discrete sets, yoyo/repeat, motion paths and GSAP's
 * position strings ('<', '>', '>+1.1', absolute seconds, default = end of timeline).
 *
 * Instead of mutating DOM nodes it records tweens, then `sample(t)` returns every animated value
 * at time `t`. That keeps the planner testable in Node and lets the renderer draw any frame
 * (including the last one, for instant catch-up) without running the animation.
 */

export type Ease =
  | 'none'
  | 'power1.in'
  | 'power1.out'
  | 'power1.inOut'
  | 'power2.in'
  | 'power2.out'
  | 'power2.inOut'
  | 'bounce.out';

export type NumProp = 'x' | 'y' | 'opacity' | 'scale';
export type StrProp = 'fill' | 'text';
export type Position = number | string;
export type Pt = { x: number; y: number };

type NumVals = Partial<Record<NumProp, number>>;
type StrVals = Partial<Record<StrProp, string>>;

export type Tween = {
  target: string;
  start: number;
  /** One iteration. Total length is dur * (repeat + 1). */
  dur: number;
  ease: Ease;
  to: NumVals;
  /** Explicit start values (fromTo); otherwise the value when the tween starts. */
  from?: NumVals;
  /** Discrete values, applied at `start + dur` (or at `start` for zero-length sets). */
  str?: StrVals;
  yoyo?: boolean;
  repeat?: number;
  /** Motion path through these points (x / y follow it instead of `to`). */
  path?: Pt[];
  /** Insertion order, the tie-breaker for equal starts. */
  order: number;
  /** Filled in by `compile`: resolved start values per prop. */
  resolved?: NumVals;
};

export type TargetState = {
  x: number;
  y: number;
  opacity: number;
  scale: number;
  fill?: string;
  text?: string;
};

export const EASES: Record<Ease, (t: number) => number> = {
  none: (t) => t,
  'power1.in': (t) => t * t,
  'power1.out': (t) => 1 - (1 - t) * (1 - t),
  'power1.inOut': (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  'power2.in': (t) => t * t * t,
  'power2.out': (t) => 1 - (1 - t) ** 3,
  'power2.inOut': (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  'bounce.out': (t) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
};

/** GSAP's default ease for tweens that name none. */
const DEFAULT_EASE: Ease = 'power1.out';

function total(tw: Tween): number {
  return tw.dur * ((tw.repeat ?? 0) + 1);
}

/** Eased progress 0..1 of a tween `local` seconds after it started (handles yoyo/repeat). */
export function progressOf(tw: Tween, local: number): number {
  const ease = EASES[tw.ease];
  if (tw.dur <= 0) return 1;
  const reps = (tw.repeat ?? 0) + 1;
  const tot = tw.dur * reps;
  if (local >= tot) {
    // Final iteration ends forward, or back at the start for yoyo with an odd repeat count.
    return tw.yoyo && reps % 2 === 0 ? 0 : 1;
  }
  const t = Math.max(0, local);
  const iter = Math.floor(t / tw.dur);
  let f = (t - iter * tw.dur) / tw.dur;
  if (tw.yoyo && iter % 2 === 1) f = 1 - f;
  return ease(f);
}

/** Quadratic Bezier through three points (passes through the middle one at t = 0.5). */
function pathAt(p: Pt[], t: number): Pt {
  const [a, m, b] = [p[0]!, p[1] ?? p[0]!, p[2] ?? p[1] ?? p[0]!];
  const c = { x: 2 * m.x - (a.x + b.x) / 2, y: 2 * m.y - (a.y + b.y) / 2 };
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
  };
}

export class Timeline {
  private tweens: Tween[] = [];
  private lastStart = 0;
  private lastEnd = 0;
  private end = 0;
  private n = 0;

  /** Resolves a GSAP position parameter against what was added so far. */
  at(pos: Position | undefined): number {
    if (pos === undefined) return this.end;
    if (typeof pos === 'number') return pos;
    const m = /^([<>])?(?:([+-])=?(\d*\.?\d+))?$/.exec(pos.trim());
    if (!m) return this.end;
    const anchor = m[1] === '<' ? this.lastStart : m[1] === '>' ? this.lastEnd : this.end;
    const off = m[3] ? Number(m[3]) * (m[2] === '-' ? -1 : 1) : 0;
    return Math.max(0, anchor + off);
  }

  private add(tw: Omit<Tween, 'order'>): this {
    const full: Tween = { ...tw, order: this.n++ };
    this.tweens.push(full);
    this.lastStart = full.start;
    this.lastEnd = full.start + total(full);
    this.end = Math.max(this.end, this.lastEnd);
    return this;
  }

  to(
    target: string | null,
    vars: NumVals & { duration: number; ease?: Ease; yoyo?: boolean; repeat?: number },
    pos?: Position,
  ): this {
    const { duration, ease, yoyo, repeat, ...to } = vars;
    return this.add({
      target: target ?? '',
      start: this.at(pos),
      dur: duration,
      ease: ease ?? DEFAULT_EASE,
      to,
      ...(yoyo ? { yoyo } : {}),
      ...(repeat ? { repeat } : {}),
    });
  }

  /** A timed discrete change (fill color fade or text swap), applied when it completes. */
  toStr(target: string, str: StrVals, duration: number, pos?: Position): this {
    return this.add({ target, start: this.at(pos), dur: duration, ease: 'none', to: {}, str });
  }

  fromTo(
    target: string,
    from: NumVals,
    vars: NumVals & { duration: number; ease?: Ease; yoyo?: boolean; repeat?: number },
    pos?: Position,
  ): this {
    const { duration, ease, yoyo, repeat, ...to } = vars;
    return this.add({
      target,
      start: this.at(pos),
      dur: duration,
      ease: ease ?? DEFAULT_EASE,
      from,
      to: { ...from, ...to },
      ...(yoyo ? { yoyo } : {}),
      ...(repeat ? { repeat } : {}),
    });
  }

  set(target: string, vals: NumVals & StrVals, pos?: Position): this {
    const { fill, text, ...num } = vals;
    const str: StrVals = {
      ...(fill !== undefined ? { fill } : {}),
      ...(text !== undefined ? { text } : {}),
    };
    return this.add({
      target,
      start: this.at(pos),
      dur: 0,
      ease: 'none',
      to: num,
      from: num,
      ...(fill !== undefined || text !== undefined ? { str } : {}),
    });
  }

  /** Motion path tween on x / y (GSAP MotionPathPlugin with three points). */
  path(target: string, points: Pt[], duration: number, pos?: Position, ease: Ease = 'none'): this {
    const last = points[points.length - 1]!;
    return this.add({
      target,
      start: this.at(pos),
      dur: duration,
      ease,
      to: { x: last.x, y: last.y },
      from: { x: points[0]!.x, y: points[0]!.y },
      path: points,
    });
  }

  /** Extends the timeline without animating anything (GSAP's `tl.to({}, {duration})`). */
  hold(duration: number, pos?: Position): this {
    return this.to(null, { duration }, pos);
  }

  duration(): number {
    return this.end;
  }

  compile(initial: Record<string, TargetState>): CompiledTimeline {
    return new CompiledTimeline(
      this.tweens.filter((t) => t.target !== ''),
      initial,
      this.end,
    );
  }
}

const NUM_PROPS: NumProp[] = ['x', 'y', 'opacity', 'scale'];
const STR_PROPS: StrProp[] = ['fill', 'text'];

export class CompiledTimeline {
  private byProp = new Map<string, Tween[]>();
  private targets: string[];

  constructor(
    tweens: Tween[],
    private readonly initial: Record<string, TargetState>,
    readonly duration: number,
  ) {
    const sorted = [...tweens].sort((a, b) => a.start - b.start || a.order - b.order);
    const targets = new Set(Object.keys(initial));
    for (const tw of sorted) {
      targets.add(tw.target);
      const props = [
        ...NUM_PROPS.filter((p) => tw.to[p] !== undefined || (tw.path && (p === 'x' || p === 'y'))),
        ...STR_PROPS.filter((p) => tw.str?.[p] !== undefined),
      ];
      for (const p of props) {
        const key = `${tw.target}.${p}`;
        const list = this.byProp.get(key) ?? [];
        list.push(tw);
        this.byProp.set(key, list);
      }
    }
    this.targets = [...targets];
    // Resolve each tween's start values in start order, like GSAP recording them on first render.
    for (const tw of sorted) {
      const resolved: NumVals = {};
      for (const p of NUM_PROPS) {
        if (tw.to[p] === undefined) continue;
        resolved[p] = tw.from?.[p] ?? this.num(tw.target, p, tw.start, tw);
      }
      tw.resolved = resolved;
    }
  }

  /** Tween that decides `prop` at `t`: the latest-starting active one, else the last to end. */
  private winner(list: Tween[], t: number, before?: Tween): Tween | undefined {
    let active: Tween | undefined;
    let done: Tween | undefined;
    for (const tw of list) {
      if (
        before &&
        (tw.start > before.start || (tw.start === before.start && tw.order >= before.order))
      )
        break;
      if (tw.start > t) break;
      const end = tw.start + total(tw);
      if (t < end) active = tw;
      else if (!done || end >= done.start + total(done)) done = tw;
    }
    return active ?? done;
  }

  private num(target: string, prop: NumProp, t: number, before?: Tween): number {
    const base = this.initial[target]?.[prop] ?? (prop === 'opacity' || prop === 'scale' ? 1 : 0);
    const list = this.byProp.get(`${target}.${prop}`);
    if (!list) return base;
    const tw = this.winner(list, t, before);
    if (!tw) return base;
    const k = progressOf(tw, t - tw.start);
    if (tw.path && (prop === 'x' || prop === 'y')) return pathAt(tw.path, k)[prop];
    const from = tw.resolved?.[prop] ?? base;
    const to = tw.to[prop] ?? from;
    return from + (to - from) * k;
  }

  private str(target: string, prop: StrProp, t: number): string | undefined {
    const list = this.byProp.get(`${target}.${prop}`);
    let v = this.initial[target]?.[prop];
    if (!list) return v;
    for (const tw of list) {
      if (tw.start + tw.dur <= t || (tw.dur === 0 && tw.start <= t)) v = tw.str?.[prop] ?? v;
    }
    return v;
  }

  /** Every target's values at `t` seconds. */
  sample(t: number): Record<string, TargetState> {
    const out: Record<string, TargetState> = {};
    for (const target of this.targets) {
      const s: TargetState = {
        x: this.num(target, 'x', t),
        y: this.num(target, 'y', t),
        opacity: this.num(target, 'opacity', t),
        scale: this.num(target, 'scale', t),
      };
      const fill = this.str(target, 'fill', t);
      const text = this.str(target, 'text', t);
      if (fill !== undefined) s.fill = fill;
      if (text !== undefined) s.text = text;
      out[target] = s;
    }
    return out;
  }

  /** Tweens touching one target (tests). */
  tweensFor(target: string): Tween[] {
    const seen = new Set<Tween>();
    for (const [k, list] of this.byProp)
      if (k.startsWith(`${target}.`)) list.forEach((t) => seen.add(t));
    return [...seen].sort((a, b) => a.start - b.start || a.order - b.order);
  }
}
