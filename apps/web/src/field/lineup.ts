/**
 * Puts 22 players on the field for a play: formation slots, filled from each team's depth chart,
 * with the players named in the play text dropped into the slots their role implies.
 */
import type { DepthChart, PlayEvent, PlayPlayer, RosterPlayer } from '@gridcast/types';
import { DEFENSE, defenseFormation, OFFENSE, offenseFormation, type Slot } from './formations';
import { CENTER_Y, rel, type Orientation, type Pt } from './geometry';

export type Side = 'off' | 'def';

export type FieldPlayer = {
  /** Stable key: "off:QB", "def:CB1". */
  key: string;
  slot: string;
  side: Side;
  team: string;
  pos: Pt;
  jersey?: number;
  name: string;
  involved: boolean;
  role?: PlayPlayer['role'];
};

/**
 * Which team lines up in the "offense" slots and where the snap / kick is, in that team's frame.
 * Kickoffs line the kicking team up as "offense" even when the feed lists the receiving team.
 */
export type Frame = {
  offense: string;
  defense: string;
  losYd: number;
  endYd: number;
  /** True when the defense side ends up with the ball. */
  flips: boolean;
};

export function frameOf(play: PlayEvent, teams: { home: string; away: string }): Frame {
  const pos = play.pre.possession;
  const other = pos === teams.home ? teams.away : teams.home;
  const p = play.parsed;
  if (p.type === 'kickoff') {
    const kickerOnPos = !!p.possessionChange;
    const offense = kickerOnPos ? pos : other;
    const flip = (yd: number) => (kickerOnPos ? yd : 100 - yd);
    return {
      offense,
      defense: offense === teams.home ? teams.away : teams.home,
      losYd: flip(p.startYd),
      endYd: flip(p.endYd),
      flips: true,
    };
  }
  return {
    offense: pos,
    defense: other,
    losYd: p.startYd,
    endYd: p.endYd,
    flips: !!p.possessionChange,
  };
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z]/g, '');
}

/** Finds a roster player for a play-text name like "A.Rodgers" (optionally with jersey). */
export function matchRoster(
  p: { name: string; jersey?: number },
  roster: RosterPlayer[],
): RosterPlayer | undefined {
  if (p.jersey !== undefined) {
    const byNum = roster.filter((r) => r.jersey === p.jersey);
    if (byNum.length === 1) return byNum[0];
    const last = p.name.split('.').pop() ?? '';
    const hit = byNum.find((r) => norm(r.lastName) === norm(last));
    if (hit) return hit;
  }
  const short = norm(p.name);
  const exact = roster.find((r) => norm(r.shortName) === short);
  if (exact) return exact;
  const [init, ...rest] = p.name.split('.');
  const last = norm(rest.join('.'));
  const byLast = roster.filter((r) => norm(r.lastName) === last);
  if (byLast.length === 1) return byLast[0];
  return byLast.find((r) => norm(r.name).startsWith(norm(init ?? '')));
}

function lastName(p: { name: string }): string {
  const parts = p.name.split('.');
  return (parts[parts.length - 1] ?? p.name).trim();
}

type Fill = { jersey?: number; name: string; id?: string };

function fromDepth(slot: Slot, depth: DepthChart | undefined, used: Set<string>): Fill {
  for (const key of slot.pos) {
    const list = depth?.[key] ?? [];
    const ordered =
      slot.depth !== undefined ? [...list.slice(slot.depth), ...list.slice(0, slot.depth)] : list;
    const pick = ordered.find((r) => !used.has(r.id));
    if (pick) {
      used.add(pick.id);
      return {
        ...(pick.jersey !== undefined ? { jersey: pick.jersey } : {}),
        name: pick.lastName,
        id: pick.id,
      };
    }
  }
  return { name: '' };
}

/** Slot that a named player's role implies. */
function slotForRole(
  role: PlayPlayer['role'],
  play: PlayEvent,
  rosterPos: string | undefined,
  isQb: boolean,
): { side: Side; slot: string } | undefined {
  const p = play.parsed;
  switch (role) {
    case 'passer':
      return { side: 'off', slot: 'QB' };
    case 'rusher':
      return { side: 'off', slot: isQb || p.scramble || rosterPos === 'QB' ? 'QB' : 'RB' };
    case 'receiver': {
      if (rosterPos === 'TE') return { side: 'off', slot: 'TE' };
      if (rosterPos === 'RB' || rosterPos === 'FB') return { side: 'off', slot: 'RB' };
      if (p.direction === 'right') return { side: 'off', slot: 'WR2' };
      if (p.direction === 'middle') return { side: 'off', slot: 'WR3' };
      return { side: 'off', slot: p.depth === 'short' && p.direction !== 'left' ? 'WR3' : 'WR1' };
    }
    case 'kicker':
      if (p.type === 'kickoff') return { side: 'off', slot: 'C' };
      return { side: 'off', slot: 'QB' };
    case 'returner':
      if (p.type === 'punt' || p.type === 'kickoff') return { side: 'def', slot: 'S2' };
      if (p.result === 'interception') {
        if (p.depth === 'deep' || p.direction === 'middle')
          return { side: 'def', slot: p.direction === 'right' ? 'S2' : 'S1' };
        return { side: 'def', slot: p.direction === 'right' ? 'CB2' : 'CB1' };
      }
      return { side: 'def', slot: 'LB2' };
    default:
      return undefined;
  }
}

export type LineupInput = {
  play: PlayEvent;
  teams: { home: string; away: string };
  depth: Record<string, DepthChart>;
  rosters: Record<string, RosterPlayer[]>;
};

export function buildLineup({ play, teams, depth, rosters }: LineupInput): {
  players: FieldPlayer[];
  frame: Frame;
} {
  const frame = frameOf(play, teams);
  const o: Orientation = { homeAbbr: teams.home };
  const offSlots = OFFENSE[offenseFormation(play.parsed)];
  const defSlots = DEFENSE[defenseFormation(play.parsed, frame.losYd)];

  const players: FieldPlayer[] = [];
  const used: Record<string, Set<string>> = {
    [frame.offense]: new Set(),
    [frame.defense]: new Set(),
  };

  // Named players first, so the depth chart doesn't hand their slot to someone else.
  const named = new Map<string, { fill: Fill; role: PlayPlayer['role'] }>();
  const qbName = play.parsed.players.find((x) => x.role === 'passer')?.name;
  for (const pp of play.parsed.players) {
    if (pp.role === 'tackler') continue;
    const isOffTeam = pp.team ? pp.team === frame.offense : pp.role !== 'returner';
    const team = isOffTeam ? frame.offense : frame.defense;
    const r = matchRoster(pp, rosters[team] ?? []);
    const target = slotForRole(pp.role, play, r?.position, pp.name === qbName);
    if (!target) continue;
    const key = `${target.side}:${target.slot}`;
    if (named.has(key)) continue;
    if (r) used[team]?.add(r.id);
    const jersey = pp.jersey ?? r?.jersey;
    named.set(key, {
      fill: { ...(jersey !== undefined ? { jersey } : {}), name: r?.lastName ?? lastName(pp) },
      role: pp.role,
    });
  }

  const place = (side: Side, slots: Slot[], team: string) => {
    // The defense frame mirrors the offense: dx > 0 is downfield for the offense.
    for (const s of slots) {
      const key = `${side}:${s.key}`;
      const n = named.get(key);
      const fill = n?.fill ?? fromDepth(s, depth[team], used[team] ?? new Set());
      players.push({
        key,
        slot: s.key,
        side,
        team,
        pos: rel(frame.offense, frame.losYd, s.dx, s.dy, o, CENTER_Y),
        ...(fill.jersey !== undefined ? { jersey: fill.jersey } : {}),
        name: fill.name,
        involved: !!n,
        ...(n ? { role: n.role } : {}),
      });
    }
  };
  place('off', offSlots, frame.offense);
  place('def', defSlots, frame.defense);

  // Tacklers: the defenders closest to where the play ended.
  const tacklers = play.parsed.players.filter((x) => x.role === 'tackler');
  if (tacklers.length) {
    const end = rel(frame.offense, frame.endYd, 0, 0, o);
    const free = players
      .filter((p) => p.side === 'def' && !p.involved)
      .sort(
        (a, b) =>
          Math.hypot(a.pos.x - end.x, a.pos.y - end.y) -
          Math.hypot(b.pos.x - end.x, b.pos.y - end.y),
      );
    tacklers.forEach((t, i) => {
      const target = free[i];
      if (!target) return;
      const r = matchRoster(t, rosters[frame.defense] ?? []);
      const jersey = t.jersey ?? r?.jersey;
      target.name = r?.lastName ?? lastName(t);
      if (jersey !== undefined) target.jersey = jersey;
      else delete target.jersey;
      target.involved = true;
      target.role = 'tackler';
    });
  }
  return { players, frame };
}
