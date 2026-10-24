/**
 * Play animation templates. Each builds a GSAP timeline from the ParsedPlay: deterministic,
 * driven only by parsed facts (type, result, direction, depth, yards, spots).
 * Every template runs 3-6 s at 1x.
 */
import { gsap } from 'gsap';
import type { PlayEvent } from '@gridcast/types';
import { lateralFor, rel, SCALE, type Orientation, type Pt } from './geometry';
import type { FieldPlayer, Frame } from './lineup';

export type Template =
  | 'run'
  | 'pass_complete'
  | 'pass_incomplete'
  | 'turnover'
  | 'sack'
  | 'kick'
  | 'field_goal'
  | 'penalty'
  | 'touchdown'
  | 'kneel_spike'
  | 'generic';

/** Picks the template for a play. Touchdowns layer onto run / pass. */
export function templateFor(play: PlayEvent): Template {
  const p = play.parsed;
  if (p.confidence < 0.6 || p.type === 'other') return 'generic';
  if (p.result === 'interception' || p.result === 'fumble') return 'turnover';
  switch (p.type) {
    case 'run':
      return p.result === 'td' ? 'touchdown' : 'run';
    case 'pass':
      if (p.result === 'incomplete') return 'pass_incomplete';
      return p.result === 'td' ? 'touchdown' : 'pass_complete';
    case 'sack':
      return 'sack';
    case 'punt':
    case 'kickoff':
      return 'kick';
    case 'fg':
    case 'pat':
      return 'field_goal';
    case 'penalty':
      return 'penalty';
    case 'kneel':
    case 'spike':
      return 'kneel_spike';
    default:
      return 'generic';
  }
}

export type AnimTargets = {
  player: (key: string) => SVGGElement | null;
  ball: SVGGElement;
  ballBody: SVGElement;
  flag: SVGGElement;
  banner: SVGTextElement;
  marker: SVGTextElement;
  flash: (team: string) => SVGRectElement | null;
};

export type AnimInput = {
  play: PlayEvent;
  frame: Frame;
  players: FieldPlayer[];
  o: Orientation;
  colors: { offense: string; defense: string; ball: string };
  targets: AnimTargets;
  /** Defense team display name for banners. */
  names: { offense: string; defense: string };
};

const clampN = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function buildTimeline(input: AnimInput): gsap.core.Timeline {
  const { play, frame, players, o, colors, targets } = input;
  const p = play.parsed;
  const tl = gsap.timeline({ paused: true });
  const off = frame.offense;
  const at = (yd: number, dy = 0): Pt => rel(off, yd, 0, dy, o);
  const rp = (dx: number, dy: number): Pt => rel(off, frame.losYd, dx, dy, o);
  const byKey = new Map(players.map((pl) => [pl.key, pl]));
  const el = (k: string) => targets.player(k);
  const posOf = (k: string): Pt => byKey.get(k)?.pos ?? rp(0, 0);
  const move = (k: string, to: Pt, dur: number, pos: gsap.Position, ease = 'power1.inOut') => {
    const e = el(k);
    if (e) tl.to(e, { x: to.x, y: to.y, duration: dur, ease }, pos);
  };
  const ballTo = (to: Pt, dur: number, pos: gsap.Position, ease = 'power1.inOut') =>
    tl.to(targets.ball, { x: to.x, y: to.y, duration: dur, ease }, pos);
  const arc = (from: Pt, to: Pt, dur: number, pos: gsap.Position, height = 1.8) => {
    const mid = {
      x: (from.x + to.x) / 2,
      y: (from.y + to.y) / 2 - Math.min(60, Math.abs(to.x - from.x) * 0.12),
    };
    tl.to(
      targets.ball,
      { duration: dur, ease: 'none', motionPath: { path: [from, mid, to], curviness: 1.2 } },
      pos,
    );
    tl.to(
      targets.ball,
      { scale: height, duration: dur / 2, ease: 'power1.out', yoyo: true, repeat: 1 },
      '<',
    );
  };
  const banner = (text: string, pos: gsap.Position, color = '#FFFFFF') => {
    tl.call(
      () => {
        targets.banner.textContent = text;
        targets.banner.setAttribute('fill', color);
      },
      [],
      pos,
    );
    tl.fromTo(
      targets.banner,
      { opacity: 0, scale: 0.92 },
      { opacity: 1, scale: 1, duration: 0.25, transformOrigin: '50% 50%' },
      '<',
    );
    tl.to(targets.banner, { opacity: 0, duration: 0.4 }, '>+1.1');
  };
  const marker = (text: string, where: Pt, pos: gsap.Position) => {
    tl.call(
      () => {
        targets.marker.textContent = text;
      },
      [],
      pos,
    );
    tl.fromTo(
      targets.marker,
      { opacity: 0, x: where.x, y: where.y - 22 },
      { opacity: 1, duration: 0.25 },
      '<',
    );
    tl.to(targets.marker, { opacity: 0, duration: 0.4 }, '>+1.2');
  };
  const ballColor = (c: string, pos: gsap.Position) =>
    tl.to(targets.ballBody, { fill: c, duration: 0.15 }, pos);
  const converge = (k: string[], to: Pt, dur: number, pos: gsap.Position, spread = 1.6) => {
    k.forEach((key, i) => {
      const from = posOf(key);
      const dist = Math.hypot(from.x - to.x, from.y - to.y);
      const reach = dist < 220 ? 0.92 : 0.6;
      const ang = (i / Math.max(1, k.length)) * Math.PI * 2;
      const tgt = {
        x: from.x + (to.x + Math.cos(ang) * spread * SCALE - from.x) * reach,
        y: from.y + (to.y + Math.sin(ang) * spread * SCALE - from.y) * reach,
      };
      move(key, tgt, dur, pos, 'power2.out');
    });
  };

  // Line up: everyone to formation spots, ball to the snap spot.
  const snapSpot = p.type === 'kickoff' ? posOf('off:C') : rp(0.3, 0);
  players.forEach((pl) => {
    const e = el(pl.key);
    if (e)
      tl.to(
        e,
        {
          x: pl.pos.x,
          y: pl.pos.y,
          opacity: pl.involved ? 1 : 0.55,
          duration: 0.5,
          ease: 'power2.inOut',
        },
        0,
      );
  });
  tl.set(targets.ball, { x: snapSpot.x, y: snapSpot.y, scale: 1, opacity: 1 }, 0);
  tl.set(targets.ballBody, { fill: colors.ball }, 0);
  tl.set([targets.banner, targets.marker], { opacity: 0 }, 0);
  tl.set(targets.flag, { opacity: 0 }, 0);
  const SNAP = 0.75;

  const offKeys = players.filter((x) => x.side === 'off').map((x) => x.key);
  const defKeys = players.filter((x) => x.side === 'def').map((x) => x.key);
  const endSpot = at(frame.endYd, 0);
  const tmpl = templateFor(play);
  const isTd = p.result === 'td';
  const tdFlash = (pos: gsap.Position) => {
    const f = targets.flash(frame.flips && p.type !== 'kickoff' ? frame.defense : frame.offense);
    const scoringEz = targets.flash(isTd && frame.flips ? frame.offense : frame.defense);
    const target = scoringEz ?? f;
    if (target)
      tl.fromTo(
        target,
        { opacity: 0.2 },
        { opacity: 0.75, duration: 0.25, yoyo: true, repeat: 3 },
        pos,
      );
  };

  const carrierKey = (): string => {
    const r = players.find((x) => x.role === 'rusher' && x.side === 'off');
    return r?.key ?? (p.scramble ? 'off:QB' : 'off:RB');
  };

  const runPlay = (td: boolean) => {
    const carrier = carrierKey();
    const gapDy = p.gap === 'end' ? 6 : p.gap === 'tackle' ? 3.2 : p.gap === 'guard' ? 1.6 : 0;
    const dy =
      (p.direction === 'left' ? -1 : p.direction === 'right' ? 1 : 0) *
      (p.direction === 'middle' ? 0 : gapDy || 3);
    ballTo(posOf('off:QB'), 0.25, SNAP);
    if (carrier !== 'off:QB') {
      const mesh = rp(-3.5, dy * 0.3);
      move(carrier, mesh, 0.45, SNAP + 0.05);
      ballTo(mesh, 0.25, SNAP + 0.3);
    }
    const hole = rp(0.6, dy);
    const end = at(frame.endYd, clampN(dy * 1.4, -20, 20));
    const legDur = clampN(Math.abs(p.yards) * 0.05 + 0.9, 0.9, 2.6);
    const t1 = SNAP + 0.55;
    move(carrier, hole, 0.55, t1, 'power1.in');
    ballTo(hole, 0.55, t1, 'power1.in');
    move(carrier, end, legDur, t1 + 0.55, 'power1.out');
    ballTo(end, legDur, t1 + 0.55, 'power1.out');
    // Line play: offensive line drives forward, defenders flow to the ball.
    ['off:LT', 'off:LG', 'off:C', 'off:RG', 'off:RT'].forEach((k) => {
      const f = posOf(k);
      move(
        k,
        { x: f.x + (frame.offense === o.homeAbbr ? 1 : -1) * 1.5 * SCALE, y: f.y + dy * 2 },
        1.1,
        SNAP + 0.1,
      );
    });
    converge(defKeys, end, legDur + 0.4, t1 + 0.2);
    if (td) {
      banner('TOUCHDOWN', t1 + 0.55 + legDur - 0.1, colors.offense);
      tdFlash(t1 + 0.55 + legDur - 0.1);
    }
  };

  const passPlay = (kind: 'complete' | 'incomplete' | 'interception' | 'td') => {
    const qb = 'off:QB';
    const drop = rp(p.formation === 'shotgun' || p.formation === 'empty' ? -6.5 : -7, 0);
    ballTo(posOf(qb), 0.2, SNAP);
    move(qb, drop, 0.6, SNAP + 0.2, 'power2.out');
    tl.to(targets.ball, { x: drop.x, y: drop.y, duration: 0.6, ease: 'power2.out' }, SNAP + 0.2);
    const receiver =
      players.find((x) => x.role === 'receiver')?.key ??
      (p.direction === 'right' ? 'off:WR2' : p.direction === 'middle' ? 'off:WR3' : 'off:WR1');
    const rFrom = posOf(receiver);
    const lane = lateralFor(p.direction, p.depth === 'deep' ? 12 : 9);
    const air = p.airYards ?? (p.depth === 'deep' ? 18 : 6);
    const catchAir =
      kind === 'complete' || kind === 'td' ? Math.max(1, Math.min(air, Math.max(p.yards, 1))) : air;
    const catchPt = at(Math.min(frame.losYd + catchAir, 109), lane);
    const routeDur = 1.25 + (p.depth === 'deep' ? 0.4 : 0);
    move(receiver, catchPt, routeDur, SNAP + 0.1, 'power1.inOut');
    // Decoy routes for the other receivers.
    ['off:WR1', 'off:WR2', 'off:WR3', 'off:TE']
      .filter((k) => k !== receiver)
      .forEach((k, i) => {
        const f = posOf(k);
        const d = frame.offense === o.homeAbbr ? 1 : -1;
        move(
          k,
          { x: f.x + d * (8 + i * 3) * SCALE, y: f.y + (i - 1) * 20 },
          routeDur + 0.3,
          SNAP + 0.1,
        );
      });
    // Coverage shadows the target, the rush gets home late.
    const cover = ['def:CB1', 'def:CB2', 'def:S1', 'def:S2', 'def:NB'].sort(
      (a, b) =>
        Math.hypot(posOf(a).x - catchPt.x, posOf(a).y - catchPt.y) -
        Math.hypot(posOf(b).x - catchPt.x, posOf(b).y - catchPt.y),
    );
    const defender =
      players.find((x) => x.role === 'returner' && x.side === 'def')?.key ?? cover[0]!;
    move(
      defender,
      { x: catchPt.x + (rFrom.x < catchPt.x ? 14 : -14), y: catchPt.y + 10 },
      routeDur + 0.15,
      SNAP + 0.1,
    );
    converge(['def:DE1', 'def:DT1', 'def:DT2', 'def:DE2'], drop, 1.4, SNAP + 0.2, 1.2);
    const throwAt = SNAP + 0.9;
    const flight = clampN(Math.hypot(catchPt.x - drop.x, catchPt.y - drop.y) / 420, 0.45, 1.2);
    if (kind === 'incomplete') {
      const past = at(Math.min(frame.losYd + air + 2.5, 110), lane * 1.15);
      arc(drop, past, flight, throwAt, 1.6);
      tl.to(targets.ball, { opacity: 0.35, scale: 0.7, duration: 0.3 }, '>');
      marker('Incomplete', past, '<');
      return;
    }
    arc(drop, catchPt, flight, throwAt, p.depth === 'deep' ? 2.2 : 1.6);
    const caught = throwAt + flight;
    if (kind === 'interception') {
      move(defender, catchPt, 0.2, caught - 0.2);
      ballColor(colors.defense, caught);
      banner('INTERCEPTION', caught, colors.defense);
      const ret = at(frame.endYd, lane * 0.6);
      move(defender, ret, 1.4, caught + 0.15, 'power1.out');
      ballTo(ret, 1.4, caught + 0.15, 'power1.out');
      converge(
        offKeys.filter((k) => k !== qb),
        ret,
        1.5,
        caught + 0.2,
      );
      marker(`${input.names.defense} ball`, ret, caught + 1.6);
      return;
    }
    const end = at(frame.endYd, lane * 1.1);
    const yac = clampN(Math.abs(frame.endYd - (frame.losYd + catchAir)) * 0.06 + 0.4, 0.4, 2.2);
    move(receiver, end, yac, caught, 'power1.out');
    ballTo(end, yac, caught, 'power1.out');
    converge(
      defKeys.filter((k) => !k.includes('DE') && !k.includes('DT')),
      end,
      yac + 0.3,
      caught - 0.2,
    );
    if (kind === 'td') {
      banner('TOUCHDOWN', caught + yac - 0.1, colors.offense);
      tdFlash(caught + yac - 0.1);
    }
  };

  switch (tmpl) {
    case 'run':
      runPlay(false);
      break;
    case 'touchdown':
      if (p.type === 'pass') passPlay('td');
      else runPlay(true);
      break;
    case 'pass_complete':
      passPlay('complete');
      break;
    case 'pass_incomplete':
      passPlay('incomplete');
      break;
    case 'turnover': {
      if (p.type === 'pass' && p.result === 'interception') {
        passPlay('interception');
        break;
      }
      // Fumble: run (or catch) to the spot, ball pops loose, defense recovers.
      if (p.type === 'pass') passPlay('complete');
      else if (p.type === 'sack') {
        const sackAt = at(frame.endYd);
        move('off:QB', sackAt, 0.9, SNAP + 0.2);
        ballTo(sackAt, 0.9, SNAP + 0.2);
        converge(['def:DE1', 'def:DT1', 'def:DT2', 'def:DE2'], sackAt, 1.0, SNAP + 0.2, 1.1);
      } else runPlay(false);
      const loose = at(frame.endYd + (frame.offense === o.homeAbbr ? 0 : 0), 2);
      const t = tl.duration();
      tl.to(
        targets.ball,
        { x: loose.x, y: loose.y, scale: 1.4, duration: 0.25, yoyo: true, repeat: 1 },
        t,
      );
      ballColor(colors.defense, t + 0.3);
      banner('FUMBLE', t, colors.defense);
      marker(`${input.names.defense} ball`, loose, t + 0.8);
      break;
    }
    case 'sack': {
      const qb = 'off:QB';
      ballTo(posOf(qb), 0.2, SNAP);
      const drop = rp(p.formation === 'shotgun' ? -7 : -7.5, 0);
      move(qb, drop, 0.6, SNAP + 0.2, 'power2.out');
      ballTo(drop, 0.6, SNAP + 0.2, 'power2.out');
      const sackAt = at(frame.endYd, 0.5);
      converge(
        ['def:DE1', 'def:DT1', 'def:DT2', 'def:DE2', 'def:LB1'],
        sackAt,
        1.3,
        SNAP + 0.15,
        1.0,
      );
      move(qb, sackAt, 0.6, SNAP + 0.9, 'power1.in');
      ballTo(sackAt, 0.6, SNAP + 0.9, 'power1.in');
      const e = el(qb);
      if (e)
        tl.to(
          e,
          { scale: 0.85, duration: 0.12, yoyo: true, repeat: 3, transformOrigin: '50% 50%' },
          SNAP + 1.5,
        );
      banner('SACK', SNAP + 1.45, colors.defense);
      break;
    }
    case 'kick': {
      const punt = p.type === 'punt';
      const kicker = punt ? 'off:QB' : 'off:C';
      const kickFrom = punt ? posOf(kicker) : posOf('off:C');
      if (punt) ballTo(kickFrom, 0.45, SNAP, 'none');
      else {
        const tee = rp(0, 0);
        tl.set(targets.ball, { x: tee.x, y: tee.y }, 0);
        move(kicker, tee, 0.6, SNAP - 0.2, 'power1.in');
      }
      const kickYds = p.kickYards ?? (punt ? 45 : 62);
      const landYd = clampN(frame.losYd + kickYds, frame.losYd + 5, 115);
      const land = at(landYd, punt ? 3 : 0);
      const kickT = SNAP + (punt ? 0.65 : 0.45);
      const hang = clampN(kickYds / 26, 1.6, 2.8);
      arc(punt ? kickFrom : rp(0, 0), land, hang, kickT, 2.8);
      const returner =
        players.find((x) => x.side === 'def' && x.role === 'returner')?.key ?? 'def:S2';
      move(returner, land, hang * 0.9, kickT + 0.1, 'power1.inOut');
      const coverage = offKeys.filter((k) => k !== kicker);
      converge(coverage, land, hang + 0.6, kickT, 3);
      const caughtT = kickT + hang;
      if (p.fairCatch) {
        marker('Fair catch', land, caughtT);
      } else if (p.result === 'touchback') {
        const tb = at(frame.endYd, 0);
        ballTo(tb, 0.5, caughtT);
        marker('Touchback', land, caughtT);
      } else {
        const end = at(frame.endYd, 2);
        const retDur = clampN((p.returnYards ?? 10) * 0.05 + 0.6, 0.6, 2.4);
        move(returner, end, retDur, caughtT, 'power1.out');
        ballTo(end, retDur, caughtT, 'power1.out');
        converge(coverage, end, retDur + 0.2, caughtT, 1.5);
        if (p.result === 'td') {
          banner('RETURN TOUCHDOWN', caughtT + retDur - 0.1, colors.defense);
          tdFlash(caughtT + retDur - 0.1);
        }
      }
      break;
    }
    case 'field_goal': {
      const hold = posOf('off:RB');
      ballTo(hold, 0.35, SNAP, 'none');
      move(
        'off:QB',
        { x: hold.x + (posOf('off:QB').x - hold.x) * 0.3, y: hold.y - 6 },
        0.35,
        SNAP + 0.2,
        'power1.in',
      );
      const ok = p.result === 'good';
      const posts = at(110, ok ? 0 : (p.yards % 2 === 0 ? 1 : -1) * 4.5);
      arc(hold, posts, 1.3, SNAP + 0.6, 2.2);
      converge(['def:DT1', 'def:DT2', 'def:DE1', 'def:DE2'], hold, 0.8, SNAP + 0.1, 1.2);
      banner(
        ok ? (p.type === 'pat' ? 'EXTRA POINT GOOD' : 'FIELD GOAL GOOD') : 'NO GOOD',
        SNAP + 1.9,
        ok ? colors.offense : '#8A8A8A',
      );
      break;
    }
    case 'penalty': {
      const foul = rp(1, (Number(play.id.slice(-1)) % 5) - 2);
      tl.set(targets.flag, { x: foul.x, y: foul.y - 50, opacity: 0 }, 0.4);
      tl.to(targets.flag, { y: foul.y, opacity: 1, duration: 0.5, ease: 'bounce.out' }, 0.5);
      banner(`FLAG: ${p.penalty?.name ?? 'PENALTY'}`.toUpperCase(), 0.6, '#FFD60A');
      const end = at(frame.endYd, 0);
      ballTo(end, 1.1, 1.8, 'power1.inOut');
      tl.to({}, { duration: 0.6 }, '>');
      break;
    }
    case 'kneel_spike': {
      ballTo(posOf('off:QB'), 0.2, SNAP);
      const e = el('off:QB');
      if (p.type === 'kneel') {
        if (e) tl.to(e, { scale: 0.75, duration: 0.3, transformOrigin: '50% 50%' }, SNAP + 0.3);
        marker('Kneel', posOf('off:QB'), SNAP + 0.4);
      } else {
        const ground = rp(1.5, 0.5);
        ballTo(ground, 0.25, SNAP + 0.3, 'power2.in');
        marker('Spike: clock stopped', ground, SNAP + 0.5);
      }
      tl.to({}, { duration: 1.4 }, '>');
      break;
    }
    case 'generic':
    default: {
      ballTo(endSpot, 1.6, SNAP, 'power1.inOut');
      tl.to({}, { duration: 0.8 }, '>');
    }
  }

  // Penalty after a play that still counts: drop the flag at the end.
  if (tmpl !== 'penalty' && p.penalty?.accepted && !p.penalty.noPlay) {
    const t = tl.duration();
    const f = at(frame.endYd, 3);
    tl.set(targets.flag, { x: f.x, y: f.y - 50, opacity: 0 }, t);
    tl.to(targets.flag, { y: f.y, opacity: 1, duration: 0.4, ease: 'bounce.out' }, t);
  }
  // Hold the final frame for a beat so the result reads.
  tl.to({}, { duration: 0.6 });
  // Players slightly ahead of the ball are reset on the next line-up, never mid-play.
  return tl;
}
