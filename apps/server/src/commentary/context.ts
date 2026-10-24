/**
 * The facts a commentary line may use. Built only from the event log and rosters; the grounding
 * check later rejects anything not traceable to this object.
 */
import type { GameEvent, PlayEvent, RosterPlayer, StoppageEvent } from '@gridcast/types';

export type TeamNames = { abbr: string; name: string; location?: string };

export type PlayContext = {
  kind: 'play';
  play: {
    id: string;
    text: string;
    type: string;
    result: string;
    yards: number;
    direction?: string;
    depth?: string;
    players: { role: string; name: string; team: string }[];
    penalty?: { name: string; team: string; yards: number; accepted: boolean };
    points?: number;
  };
  offense: string;
  defense: string;
  before: { quarter: number; clock: string; down?: number; distance?: number; ballOn: string };
  score: { [abbr: string]: number };
  last5: string[];
  drive: { plays: number; yards: number };
  winProbability?: { team: string; before?: number; after: number };
  odds?: { team: string; cents: number };
  epa?: number;
  notable: boolean;
};

export type StoppageContext = {
  kind: 'stoppage';
  stoppage: { id: string; reason: string; title?: string; detail: string };
  score: { [abbr: string]: number };
  quarter: number;
  clock: string;
  drive: { team?: string; plays: number; yards: number };
  winProbability?: { team: string; after: number };
};

export type CommentaryContext = PlayContext | StoppageContext;

function ballOn(yardLine: number, team: string, other: string): string {
  if (yardLine === 50) return 'midfield';
  return yardLine < 50 ? `${team} ${yardLine}` : `${other} ${100 - yardLine}`;
}

function stripClock(t: string) {
  return t.replace(/^\(\s*\d{0,2}:\d{2}\s*\)\s*/, '');
}

/** Notable by the PRD rule. */
export function isNotable(p: PlayEvent, oddsSwing = 0): boolean {
  const pp = p.parsed;
  const lateDown =
    (p.pre.down === 3 || p.pre.down === 4) && ['run', 'pass', 'sack'].includes(pp.type);
  const wpSwing =
    p.wpBefore !== undefined && p.wpAfter !== undefined && Math.abs(p.wpAfter - p.wpBefore) > 0.05;
  return (
    !!pp.points ||
    pp.result === 'interception' ||
    pp.result === 'fumble' ||
    pp.yards >= 20 ||
    lateDown ||
    wpSwing ||
    Math.abs(oddsSwing) > 0.05
  );
}

export function buildPlayContext(
  play: PlayEvent,
  history: readonly GameEvent[],
  teams: { home: TeamNames; away: TeamNames },
): PlayContext {
  const idx = history.indexOf(play);
  const before = (idx >= 0 ? history.slice(0, idx) : history).filter(
    (e): e is PlayEvent => e.kind === 'play',
  );
  const offense = play.pre.possession;
  const defense = offense === teams.home.abbr ? teams.away.abbr : teams.home.abbr;
  const drive = play.driveId ? [...before.filter((p) => p.driveId === play.driveId), play] : [play];
  const lastOdds = [...history.slice(0, idx >= 0 ? idx + 1 : history.length)]
    .reverse()
    .find((e) => e.kind === 'odds' && e.market === 'moneyline');
  const wpTeam = offense;
  const toTeam = (homeP: number) =>
    Math.round((wpTeam === teams.home.abbr ? homeP : 1 - homeP) * 100);
  const pp = play.parsed;
  return {
    kind: 'play',
    play: {
      id: play.id,
      text: stripClock(play.raw.text),
      type: pp.type,
      result: pp.result,
      yards: pp.yards,
      ...(pp.direction ? { direction: pp.direction } : {}),
      ...(pp.depth ? { depth: pp.depth } : {}),
      players: pp.players.map((x) => ({ role: x.role, name: x.name, team: x.team })),
      ...(pp.penalty
        ? {
            penalty: {
              name: pp.penalty.name,
              team: pp.penalty.team,
              yards: pp.penalty.yards,
              accepted: pp.penalty.accepted,
            },
          }
        : {}),
      ...(pp.points ? { points: pp.points } : {}),
    },
    offense,
    defense,
    before: {
      quarter: play.pre.quarter,
      clock: play.pre.clock,
      ...(play.pre.down ? { down: play.pre.down } : {}),
      ...(play.pre.distance !== undefined ? { distance: play.pre.distance } : {}),
      ballOn: ballOn(play.pre.yardLine, offense, defense),
    },
    score: { [teams.away.abbr]: play.state.away, [teams.home.abbr]: play.state.home },
    last5: before.slice(-5).map((p) => stripClock(p.raw.text)),
    drive: {
      plays: drive.filter((p) => !['kickoff', 'pat'].includes(p.parsed.type)).length,
      yards: drive.reduce(
        (a, p) => a + (['run', 'pass', 'sack'].includes(p.parsed.type) ? p.parsed.yards : 0),
        0,
      ),
    },
    ...(play.wpAfter !== undefined
      ? {
          winProbability: {
            team: wpTeam,
            ...(play.wpBefore !== undefined ? { before: toTeam(play.wpBefore) } : {}),
            after: toTeam(play.wpAfter),
          },
        }
      : {}),
    ...(lastOdds && lastOdds.kind === 'odds'
      ? { odds: { team: teams.home.abbr, cents: Math.round(lastOdds.homeProb * 100) } }
      : {}),
    ...(play.epa !== undefined ? { epa: Math.round(play.epa * 10) / 10 } : {}),
    notable: isNotable(play),
  };
}

export function buildStoppageContext(
  s: StoppageEvent,
  history: readonly GameEvent[],
  teams: { home: TeamNames; away: TeamNames },
): StoppageContext {
  const plays = history.filter((e): e is PlayEvent => e.kind === 'play');
  const last = plays[plays.length - 1];
  const drive = last?.driveId ? plays.filter((p) => p.driveId === last.driveId) : [];
  const wp = [...plays].reverse().find((p) => p.wpAfter !== undefined)?.wpAfter;
  const team = s.state.possession;
  return {
    kind: 'stoppage',
    stoppage: {
      id: s.id,
      reason: s.reason,
      ...(s.title ? { title: s.title } : {}),
      detail: s.detail,
    },
    score: { [teams.away.abbr]: s.state.away, [teams.home.abbr]: s.state.home },
    quarter: s.state.quarter,
    clock: s.state.clock,
    drive: {
      ...(last ? { team: last.pre.possession } : {}),
      plays: drive.filter((p) => !['kickoff', 'pat'].includes(p.parsed.type)).length,
      yards: drive.reduce(
        (a, p) => a + (['run', 'pass', 'sack'].includes(p.parsed.type) ? p.parsed.yards : 0),
        0,
      ),
    },
    ...(wp !== undefined
      ? {
          winProbability: {
            team,
            after: Math.round((team === teams.home.abbr ? wp : 1 - wp) * 100),
          },
        }
      : {}),
  };
}

/** Names and words a line may contain without being flagged as an invented person. */
export function allowedVocabulary(
  ctx: CommentaryContext,
  rosters: Record<string, RosterPlayer[]>,
  teams: { home: TeamNames; away: TeamNames },
): Set<string> {
  const words = new Set<string>();
  const add = (s: string | undefined) => {
    for (const w of (s ?? '').split(/[^A-Za-z']+/)) if (w.length > 1) words.add(w.toLowerCase());
  };
  // Multi-word names must match as a whole ("Derrick Henry" is not "Derrick X" + "Y Henry").
  const phrase = (s: string | undefined) => {
    const p = (s ?? '')
      .toLowerCase()
      .replace(/[^a-z' ]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
    if (p.includes(' ')) words.add(p);
  };
  for (const t of [teams.home, teams.away]) {
    add(t.abbr);
    add(t.name);
    add(t.location);
    phrase(t.location);
    phrase(`${t.location ?? ''} ${t.name}`);
  }
  for (const list of Object.values(rosters)) {
    for (const p of list) {
      add(p.name);
      phrase(p.name);
    }
  }
  if (ctx.kind === 'play') {
    for (const p of ctx.play.players) add(p.name);
    add(ctx.play.text);
    for (const l of ctx.last5) add(l);
    add(ctx.play.penalty?.name);
  } else {
    add(ctx.stoppage.title);
    add(ctx.stoppage.detail);
  }
  return words;
}
