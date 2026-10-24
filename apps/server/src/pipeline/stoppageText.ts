/** Deterministic plain-English text for stoppage cards. Facts only, from the feed. */
import { explainPenalty } from '@gridcast/parser';
import type { GameState, PenaltyInfo } from '@gridcast/types';

export type Names = { home: string; away: string; homeAbbr: string; awayAbbr: string };

const ORD = ['', '1st', '2nd', '3rd', '4th'];

export function downText(s: GameState): string {
  if (!s.down) return '';
  const togo =
    s.distance !== undefined && s.yardLine + s.distance >= 100 ? 'Goal' : String(s.distance ?? '');
  return `${ORD[s.down] ?? `${s.down}th`} & ${togo}`;
}

export function spotText(s: GameState, n: Names): string {
  const other = s.possession === n.homeAbbr ? n.awayAbbr : n.homeAbbr;
  if (s.yardLine === 50) return 'midfield';
  return s.yardLine < 50 ? `own ${s.yardLine}` : `${other} ${100 - s.yardLine}`;
}

export function periodName(q: number): string {
  return q <= 4 ? `Q${q}` : q === 5 ? 'OT' : `${q - 4}OT`;
}

export function scoreLine(s: GameState, n: Names): string {
  return `${n.awayAbbr} ${s.away}, ${n.homeAbbr} ${s.home}`;
}

/** What each team needs, from the score margin. */
export function needsText(s: GameState, n: Names): string {
  const diff = s.home - s.away;
  if (diff === 0) return 'Tied. Next score takes the lead.';
  const [lead, trail] = diff > 0 ? [n.home, n.away] : [n.away, n.home];
  const m = Math.abs(diff);
  const need =
    m <= 2
      ? 'a field goal takes the lead'
      : m === 3
        ? 'a field goal ties it, a touchdown wins the lead'
        : m <= 6
          ? 'a touchdown takes the lead'
          : m <= 8
            ? 'a touchdown and two-point try ties it'
            : `they need ${Math.ceil(m / 8)} scores`;
  return `${lead} lead by ${m}. For ${trail}, ${need}.`;
}

export function situation(s: GameState, n: Names): string {
  const who =
    s.possession === n.homeAbbr ? n.home : s.possession === n.awayAbbr ? n.away : s.possession;
  const dd = downText(s);
  const ball = who ? `${who} ball${dd ? `, ${dd}` : ''} at the ${spotText(s, n)}.` : '';
  return `${scoreLine(s, n)}. ${ball} ${needsText(s, n)}`.replace(/\s+/g, ' ').trim();
}

export function timeoutReason(
  s: GameState,
  team: string,
  n: Names,
  injuryJustHappened: boolean,
): string {
  if (injuryJustHappened) return 'Likely injury-related: a player was hurt on the previous play.';
  const [mm] = s.clock.split(':');
  const lateHalf = (s.quarter === 2 || s.quarter >= 4) && Number(mm) < 2;
  const offense = s.possession === team;
  if (lateHalf)
    return offense
      ? 'Saving time: stopping the clock to keep the drive alive.'
      : 'Stopping the clock to get the ball back with time left.';
  if (offense) return 'Likely the play clock running down or a bad look at the line.';
  return `Likely ${team === n.homeAbbr ? n.home : n.away} did not like the matchup or substitution.`;
}

export function penaltyText(p: PenaltyInfo, after: GameState, n: Names): string {
  const who = p.team === n.homeAbbr ? n.home : p.team === n.awayAbbr ? n.away : p.team;
  const explain = explainPenalty(p.name);
  const status = p.offsetting
    ? 'Offsetting penalties: the down is replayed.'
    : p.accepted
      ? `${p.yards} yards, accepted${p.noPlay ? ', no play' : ''}.`
      : 'Declined.';
  const dd = downText(after);
  return `${explain} On ${who}. ${status}${dd ? ` Now ${dd}.` : ''}`;
}
