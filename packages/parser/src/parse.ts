/**
 * Deterministic play parser: play text + ESPN structured fields -> ParsedPlay.
 * The LLM never decides what happened on the field; this does.
 */
import {
  normalizeAbbr,
  type Depth,
  type Direction,
  type Formation,
  type Gap,
  type ParsedPlay,
  type ParserInput,
  type PlayPlayer,
  type PlayResult,
  type PlayType,
} from '@gridcast/types';
import { mainPenalty, parsePenalties, type ParsedPenalty } from './penalty.ts';
import {
  clamp,
  collapse,
  NAME,
  parseGain,
  SPOT,
  spotToYd,
  stripClock,
  toSpot,
  type Spot,
} from './text.ts';

const re = (src: string, flags = '') => new RegExp(src, flags);

/** Plays that are not snaps at all (feed bookkeeping). */
const NON_PLAY =
  /^(?:timeout #?\d|end (?:of )?(?:quarter|half|game|period|regulation)|end quarter|two-minute warning|game|start of|kickoff delayed|\(?\s*kick formation\s*\)?\s*$)/i;

type Context = {
  offense?: string;
  defense?: string;
  startYd: number;
};

function tags(text: string) {
  return {
    shotgun: /\(\s*(?:no huddle,\s*)?shotgun\s*\)/i.test(text),
    noHuddle: /no huddle/i.test(text),
    pistol: /\bpistol\b/i.test(text),
    empty: /\(\s*empty\s*\)/i.test(text),
    puntFormation: /\(\s*punt formation\s*\)/i.test(text),
    fgFormation: /\(\s*(?:field goal|kick) formation\s*\)/i.test(text),
  };
}

/** Removes leading "(Shotgun)" style tags and "reported in as eligible" notes. */
function mainBody(text: string): string {
  let t = stripClock(text);
  t = t.replace(/^(?:\([^)]*\)\s*)+/, '');
  t = t.replace(new RegExp(`^(?:${NAME} reported in as eligible[^.]*\\.\\s*)+`, 'i'), '');
  t = t.replace(/^(?:\([^)]*\)\s*)+/, '');
  return t.trim();
}

function findSpots(s: string, prefix: 'to|at' | 'to' | 'at' = 'to|at'): Spot[] {
  const out: Spot[] = [];
  const r = re(`\\b(?:${prefix}) (?:the )?${SPOT}`, 'g');
  let m: RegExpExecArray | null;
  while ((m = r.exec(s))) {
    const sp = toSpot(m[1], m[2], m[3]);
    if (sp) out.push(sp);
  }
  return out;
}

function lastSpotYd(s: string, ctx: Context, prefix?: 'to|at' | 'to' | 'at'): number | undefined {
  const spots = findSpots(s, prefix);
  const last = spots[spots.length - 1];
  return last ? spotToYd(last, ctx.offense, ctx.defense) : undefined;
}

function nameBefore(s: string, phrase: string): { name: string; jersey?: number } | undefined {
  const m = re(`${NAME}\\s+(?:${phrase})`).exec(s);
  if (!m || !m[2]) return undefined;
  return { name: m[2].trim(), ...(m[1] ? { jersey: Number(m[1]) } : {}) };
}

function nameAfter(s: string, phrase: string): { name: string; jersey?: number } | undefined {
  const m = re(`(?:${phrase})\\s+(?:[A-Z]{2,3}-)?${NAME}`).exec(s);
  if (!m || !m[2]) return undefined;
  return { name: m[2].trim(), ...(m[1] ? { jersey: Number(m[1]) } : {}) };
}

/** Tacklers in the first "(5-I.Melifonwu; 34-A.Anzalone)" group after the gain. */
function tacklers(s: string): { name: string; jersey?: number }[] {
  const m = /\(([^()]*)\)/.exec(
    s.replace(
      /\((?:shotgun|no huddle[^)]*|punt formation|field goal formation|kick formation|pistol|empty)\)/gi,
      '',
    ),
  );
  if (!m || !m[1] || /\bkick\b|two-point|formation/i.test(m[1])) return [];
  const out: { name: string; jersey?: number }[] = [];
  const r = re(NAME, 'g');
  let n: RegExpExecArray | null;
  while ((n = r.exec(m[1]))) {
    if (n[2]) out.push({ name: n[2].trim(), ...(n[1] ? { jersey: Number(n[1]) } : {}) });
  }
  return out;
}

function detectType(body: string, penalties: ParsedPenalty[]): PlayType {
  if (penalties.some((p) => p.noPlay && (p.accepted || p.offsetting))) return 'penalty';
  const main = body.split(/penalty on /i)[0] ?? body;
  if (/\bkicks (?:onside )?(?:-?\d+ yards? )?from\b|\bkicks onside\b/i.test(main)) return 'kickoff';
  if (/\bkneels?\b/i.test(main)) return 'kneel';
  if (/\bspike[sd]?\b/i.test(main)) return 'spike';
  if (/\bpunts?\b|\bpunt is blocked\b/i.test(main)) return 'punt';
  if (/\bfield goal\b/i.test(main)) return 'fg';
  if (/\bextra point\b/i.test(main)) return 'pat';
  if (/\bsacked\b/i.test(main)) return 'sack';
  if (/\bpass(?:es)?\b|\bintercepted\b/i.test(main)) return 'pass';
  if (
    /\b(?:left|right) (?:end|tackle|guard)\b|\bup the middle\b|\brush(?:es)?\b|\bscrambles?\b|\baborted\b|\bfumbles\b/i.test(
      main,
    ) ||
    re(`${NAME} to ${SPOT} for`).test(main) ||
    re(`${NAME} for (?:-?\\d+ (?:yards?|yds?)|no gain)`).test(main)
  ) {
    return 'run';
  }
  if (penalties.length) return 'penalty';
  return 'other';
}

function passDetail(main: string): { depth?: Depth; direction?: Direction } {
  const m = /\bpass(?: incomplete)? (short|deep)(?: (left|middle|right))?/i.exec(main);
  if (m) {
    return {
      depth: m[1]!.toLowerCase() as Depth,
      ...(m[2] ? { direction: m[2].toLowerCase() as Direction } : {}),
    };
  }
  const d = /\bpass(?: incomplete)?(?: (?:short|deep))? (left|middle|right)\b/i.exec(main);
  return d ? { direction: d[1]!.toLowerCase() as Direction } : {};
}

function runDetail(main: string): { direction?: Direction; gap?: Gap } {
  if (/\bup the middle\b/i.test(main)) return { direction: 'middle', gap: 'middle' };
  const m = /\b(left|right) (end|tackle|guard)\b/i.exec(main);
  if (m) return { direction: m[1]!.toLowerCase() as Direction, gap: m[2]!.toLowerCase() as Gap };
  const s = /\bscrambles? (left|right)\b/i.exec(main);
  if (s) return { direction: s[1]!.toLowerCase() as Direction };
  return {};
}

function fumbleLost(text: string, ctx: Context): boolean {
  if (!/\bfumbles?\b/i.test(text)) return false;
  const recs = [...text.matchAll(/\brecovered by ([A-Z]{2,3})-/gi)];
  const last = recs[recs.length - 1];
  if (!last || !last[1]) return false;
  const team = normalizeAbbr(last[1]);
  if (ctx.offense) return team !== normalizeAbbr(ctx.offense);
  if (ctx.defense) return team === normalizeAbbr(ctx.defense);
  return /RECOVERED by/.test(last[0]);
}

/** Collects the injured players from "X was injured during the play." notes. */
function injuries(text: string): string[] {
  const out: string[] = [];
  const r = re(`${NAME} (?:was )?injured`, 'g');
  let m: RegExpExecArray | null;
  while ((m = r.exec(text))) if (m[2]) out.push(m[2].trim());
  return out;
}

export function parsePlay(input: ParserInput): ParsedPlay {
  const original = collapse(input.text ?? '');
  const offense = input.offense ? normalizeAbbr(input.offense) : undefined;
  const defense = input.defense ? normalizeAbbr(input.defense) : undefined;
  const startYd =
    input.yardsToEndzone !== undefined ? clamp(100 - input.yardsToEndzone, 0, 100) : 25;
  const ctx: Context = {
    startYd,
    ...(offense ? { offense } : {}),
    ...(defense ? { defense } : {}),
  };

  // A reversed review: the play that counts is written after "REVERSED."
  const review = /replay official|challenged|reviewed|review/i.test(original);
  let text = original;
  const reversed = [...original.matchAll(/\bREVERSED\.\s*/g)];
  const lastRev = reversed[reversed.length - 1];
  if (lastRev && lastRev.index !== undefined) {
    const after = original.slice(lastRev.index + lastRev[0].length).trim();
    if (after.length > 8) text = after;
  }

  const t = tags(text);
  const body = mainBody(text);
  const twoPoint = /two-point conversion attempt/i.test(body);
  const work = twoPoint ? body.replace(/^.*?two-point conversion attempt\.\s*/i, '') : body;
  const penalties = parsePenalties(work);
  const penalty = mainPenalty(penalties);
  const main = work.split(/penalty on /i)[0] ?? work;

  const players: PlayPlayer[] = [];
  const add = (
    role: PlayPlayer['role'],
    p: { name: string; jersey?: number } | undefined,
    team: string | undefined,
  ) => {
    if (!p) return;
    if (players.some((x) => x.role === role && x.name === p.name)) return;
    players.push({
      role,
      name: p.name,
      team: team ?? '',
      ...(p.jersey !== undefined ? { jersey: p.jersey } : {}),
    });
  };

  let confidence = 0.95;
  const extras: Partial<ParsedPlay> = {};
  if (t.noHuddle) extras.noHuddle = true;
  if (review) extras.review = true;
  if (twoPoint) extras.twoPoint = true;
  const injured = injuries(original);
  if (injured.length) extras.injured = injured;

  if (NON_PLAY.test(body) || !body) {
    return {
      type: 'other',
      result: 'normal',
      yards: 0,
      startYd,
      endYd: startYd,
      players,
      confidence: 0.9,
      ...extras,
    };
  }

  const type = detectType(work, penalties);
  let result: PlayResult = 'normal';
  let yards = 0;
  let endYd: number | undefined;
  let direction: Direction | undefined;
  let depth: Depth | undefined;
  let gap: Gap | undefined;
  let airYards: number | undefined;
  let formation: Formation | undefined;

  const td = /\bTOUCHDOWN\b(?! NULLIFIED)/i.test(main) && !/touchdown nullified/i.test(main);
  const lostFumble = fumbleLost(main, ctx);

  switch (type) {
    case 'pass': {
      ({ depth, direction } = passDetail(main));
      add('passer', nameBefore(main, 'pass'), offense);
      const intended =
        nameAfter(main, 'intended for') ??
        nameAfter(main, `pass(?: incomplete)?(?: (?:short|deep))?(?: (?:left|middle|right))? to`);
      add('receiver', intended, offense);
      if (/\bINTERCEPTED\b/i.test(main)) {
        result = 'interception';
        extras.possessionChange = true;
        add('returner', nameAfter(main, 'INTERCEPTED by'), defense);
        const after = main.slice(main.search(/INTERCEPTED/i));
        if (/touchback/i.test(after)) endYd = 80;
        else endYd = lastSpotYd(after, ctx) ?? startYd;
        if (/TOUCHDOWN/i.test(after)) endYd = 0;
      } else if (/\bpass incomplete\b|\bincomplete\b/i.test(main)) {
        result = 'incomplete';
        yards = 0;
      } else {
        result = 'complete';
        const g = parseGain(main);
        if (g === undefined && !td) confidence = Math.min(confidence, 0.55);
        yards = g ?? (td ? 100 - startYd : 0);
        if (lostFumble) result = 'fumble';
        else if (td) result = 'td';
      }
      const air = /air yards? (-?\d+)/i.exec(main);
      if (air) airYards = Number(air[1]);
      for (const tk of tacklers(
        main.slice(
          main.search(/\bfor\b|incomplete/i) >= 0 ? main.search(/\bfor\b|incomplete/i) : 0,
        ),
      ))
        add('tackler', tk, defense);
      break;
    }
    case 'run': {
      ({ direction, gap } = runDetail(main));
      if (/\bscrambles?\b/i.test(main)) extras.scramble = true;
      const rusher =
        nameBefore(main, '(?:scrambles? )?(?:left|right) (?:end|tackle|guard)') ??
        nameBefore(main, '(?:scrambles? )?up the middle') ??
        nameBefore(main, 'rush(?:es)?|scrambles?') ??
        nameBefore(main, `to ${SPOT} for`) ??
        nameBefore(main, 'for (?:-?\\d+|no gain)') ??
        nameBefore(main, 'FUMBLES');
      add('rusher', rusher, offense);
      const g = parseGain(main);
      if (g === undefined && !td && !/aborted|fumbles/i.test(main))
        confidence = Math.min(confidence, 0.55);
      yards = g ?? (td ? 100 - startYd : 0);
      if (lostFumble) result = 'fumble';
      else if (td) result = 'td';
      for (const tk of tacklers(main.slice(Math.max(0, main.search(/\bfor\b/i)))))
        add('tackler', tk, defense);
      break;
    }
    case 'sack': {
      add('passer', nameBefore(main, 'sacked'), offense);
      const g = parseGain(main);
      yards = g ?? 0;
      if (g === undefined) confidence = Math.min(confidence, 0.6);
      for (const tk of tacklers(main.slice(Math.max(0, main.search(/sacked/i)))))
        add('tackler', tk, defense);
      if (lostFumble) result = 'fumble';
      break;
    }
    case 'kneel': {
      add('passer', nameBefore(main, 'kneels?'), offense);
      yards = parseGain(main) ?? -1;
      formation = 'victory';
      break;
    }
    case 'spike': {
      add('passer', nameBefore(main, 'spike[sd]?'), offense);
      yards = 0;
      result = 'incomplete';
      break;
    }
    case 'punt': {
      formation = 'punt';
      add('kicker', nameBefore(main, 'punts?'), offense);
      const k = /\bpunts (-?\d+) yards?/i.exec(main);
      if (k) extras.kickYards = Number(k[1]);
      extras.possessionChange = true;
      const ret = re(`${NAME} (?:to|pushed ob at|ran ob at) ${SPOT} for (-?\\d+|no gain)`).exec(
        main,
      );
      if (ret?.[2]) {
        add('returner', { name: ret[2], ...(ret[1] ? { jersey: Number(ret[1]) } : {}) }, defense);
        extras.returnYards = ret[6] === 'no gain' || ret[6] === undefined ? 0 : Number(ret[6]);
      }
      const fc = nameAfter(main, 'fair catch by');
      if (fc) {
        add('returner', fc, defense);
        extras.fairCatch = true;
      }
      if (/\btouchback\b/i.test(main)) {
        result = 'touchback';
        endYd = 80;
      }
      if (/\bblocked\b/i.test(main)) confidence = Math.min(confidence, 0.7);
      if (/TOUCHDOWN/i.test(main)) result = 'td';
      else if (/\bmuffs?\b/i.test(main) && /RECOVERED by/.test(main)) {
        result = 'fumble';
      }
      if (endYd === undefined) endYd = lastSpotYd(main.replace(/Center-\S+/g, ''), ctx);
      break;
    }
    case 'kickoff': {
      formation = 'kickoff';
      const from = re(`kicks (?:onside )?(?:-?\\d+ yards? )?from ${SPOT}`, 'i').exec(main);
      const kickSpot = from ? toSpot(from[1], from[2], from[3]) : undefined;
      const kickingTeam = kickSpot?.side;
      const kickerOnOffense = kickingTeam ? kickingTeam === offense : true;
      const kickTeam = kickerOnOffense ? offense : defense;
      const recvTeam = kickerOnOffense ? defense : offense;
      add('kicker', nameBefore(main, 'kicks'), kickTeam ?? kickingTeam);
      const k = /\bkicks (?:onside )?(-?\d+) yards?/i.exec(main);
      if (k) extras.kickYards = Number(k[1]);
      if (kickerOnOffense) extras.possessionChange = true;
      const ret = re(`${NAME} (?:to|pushed ob at|ran ob at) ${SPOT} for (-?\\d+|no gain)`).exec(
        main,
      );
      if (ret?.[2]) {
        add('returner', { name: ret[2], ...(ret[1] ? { jersey: Number(ret[1]) } : {}) }, recvTeam);
        extras.returnYards = ret[6] === 'no gain' || ret[6] === undefined ? 0 : Number(ret[6]);
      }
      const fc = nameAfter(main, 'fair catch by');
      if (fc) {
        add('returner', fc, recvTeam);
        extras.fairCatch = true;
      }
      if (/\btouchback\b/i.test(main)) result = 'touchback';
      if (/TOUCHDOWN/i.test(main)) result = 'td';
      endYd = lastSpotYd(main, ctx);
      if (kickSpot && input.yardsToEndzone === undefined) {
        const ks = spotToYd(kickSpot, offense, defense);
        if (ks !== undefined) ctx.startYd = ks;
      }
      break;
    }
    case 'fg': {
      formation = 'fg';
      add('kicker', nameBefore(main, '\\d+ yards? field goal'), offense);
      const k = /(\d+) yards? field goal/i.exec(main);
      if (k) extras.kickYards = Number(k[1]);
      result = /field goal is good/i.test(main) ? 'good' : 'no_good';
      if (result === 'good') extras.points = 3;
      else extras.possessionChange = true;
      endYd = startYd;
      break;
    }
    case 'pat': {
      formation = 'fg';
      add('kicker', nameBefore(main, 'extra point'), offense);
      result = /extra point is good/i.test(main) ? 'good' : 'no_good';
      if (result === 'good') extras.points = 1;
      endYd = startYd;
      break;
    }
    case 'penalty': {
      yards = 0;
      break;
    }
    default: {
      confidence = 0.3;
    }
  }

  // Two-point tries: success replaces the TD/complete result.
  if (twoPoint) {
    const ok = /attempt succeeds/i.test(work);
    result = ok ? 'good' : 'no_good';
    if (ok) extras.points = 2;
    yards = 0;
  }

  if (
    td &&
    !twoPoint &&
    (type === 'pass' || type === 'run') &&
    result !== 'interception' &&
    result !== 'fumble'
  ) {
    extras.points = 6;
  }
  if (/\bSAFETY\b/.test(main)) {
    extras.points = 2;
    confidence = Math.min(confidence, 0.8);
  }

  // Formation from text tags when the play type did not decide it.
  if (!formation) {
    if (t.puntFormation) formation = 'punt';
    else if (t.fgFormation) formation = 'fg';
    else if (t.empty) formation = 'empty';
    else if (t.pistol) formation = 'pistol';
    else if (t.shotgun) formation = 'shotgun';
    else formation = 'under_center';
  }

  // Penalty bookkeeping and the resulting ball spot.
  const start = ctx.startYd;
  if (penalty) {
    extras.penalty = {
      name: penalty.name,
      team: penalty.team,
      yards: penalty.yards,
      accepted: penalty.accepted,
      noPlay: penalty.noPlay,
      ...(penalty.offsetting ? { offsetting: true } : {}),
      ...(penalty.player ? { player: penalty.player } : {}),
    };
  }

  // Offensive foul enforced at a spot inside the run (e.g. holding): the gain stops at the spot.
  if (
    penalty?.accepted &&
    !penalty.noPlay &&
    offense &&
    penalty.team === offense &&
    (type === 'run' || (type === 'pass' && result === 'complete'))
  ) {
    const enf = re(`enforced at ${SPOT}`).exec(work);
    const sp = enf ? toSpot(enf[1], enf[2], enf[3]) : undefined;
    const enfYd = sp ? spotToYd(sp, offense, defense) : undefined;
    if (enfYd !== undefined && enfYd >= start && enfYd < start + yards) yards = enfYd - start;
  }

  if (endYd === undefined) endYd = clamp(start + yards, 0, 100);
  if (penalty?.accepted) {
    const against = penalty.team;
    const sign =
      offense && against === offense ? -1 : defense && against === defense ? 1 : offense ? 1 : 0;
    if (!offense && !defense) confidence = Math.min(confidence, 0.7);
    const base = penalty.noPlay ? start : endYd;
    endYd = clamp(base + sign * penalty.yards, 1, 99);
  }

  // First down by gain (penalties that award one are handled by the feed's next state).
  if (
    (type === 'run' || type === 'pass') &&
    input.distance !== undefined &&
    result !== 'interception' &&
    result !== 'fumble'
  ) {
    if (yards >= input.distance) extras.firstDown = true;
  }

  // Cross-check against ESPN's own yardage when we have it.
  if (
    input.statYardage !== undefined &&
    (type === 'run' || (type === 'pass' && result !== 'interception')) &&
    input.statYardage !== yards &&
    !twoPoint
  ) {
    confidence = Math.min(confidence, 0.7);
  }

  if (/\blateral\b/i.test(main)) confidence = Math.min(confidence, 0.7);

  return {
    type,
    result,
    yards,
    startYd: start,
    endYd,
    players,
    formation,
    confidence,
    ...(direction ? { direction } : {}),
    ...(depth ? { depth } : {}),
    ...(gap ? { gap } : {}),
    ...(airYards !== undefined ? { airYards } : {}),
    ...extras,
  };
}
