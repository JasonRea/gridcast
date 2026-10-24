/**
 * Deterministic commentary. Used when ANTHROPIC_API_KEY is missing, when Claude fails, and when a
 * Claude line fails the grounding check. Only restates parsed facts.
 */
import type { CommentaryContext, PlayContext, StoppageContext } from './context.ts';

export type LinePair = { pbp: string; color?: string };

/** "8-A.Rodgers" / "A.Rodgers" -> "Rodgers". */
export function surname(name: string | undefined): string {
  if (!name) return '';
  const parts = name.split('.');
  return (parts[parts.length - 1] ?? name).trim();
}

const role = (c: PlayContext, r: string) => surname(c.play.players.find((p) => p.role === r)?.name);

function yds(n: number): string {
  const a = Math.abs(n);
  return `${a} yard${a === 1 ? '' : 's'}`;
}

function where(c: PlayContext): string {
  const d = c.play.depth ? `${c.play.depth} ` : '';
  const dir = c.play.direction
    ? c.play.direction === 'middle'
      ? 'over the middle'
      : `to the ${c.play.direction}`
    : '';
  return `${d}${dir}`.trim();
}

const ORDINAL = ['', 'First', 'Second', 'Third', 'Fourth'];

/** "Third and six. " on third and fourth down, where the situation is the story. */
function situation(c: PlayContext): string {
  const d = c.before.down;
  if (d !== 3 && d !== 4) return '';
  const dist = c.before.distance;
  return `${ORDINAL[d]} and ${dist !== undefined && dist <= 1 ? 'one' : (dist ?? '')}. `;
}

/**
 * Network play-by-play: who, what, where, then stop. Routine plays are called plainly; big
 * moments get one short, punchy call. No exclamation marks on ordinary plays.
 */
function playLine(c: PlayContext): string {
  const p = c.play;
  const qb = role(c, 'passer');
  const rusher = role(c, 'rusher');
  const rec = role(c, 'receiver');
  const tackler = role(c, 'tackler');
  const kicker = role(c, 'kicker');
  const ret = role(c, 'returner');
  const off = c.names.offense;
  const def = c.names.defense;
  const sit = situation(c);
  switch (p.type) {
    case 'run': {
      const who = rusher || off;
      if (p.result === 'td') return `${who}, in for the score. Touchdown, ${off}.`;
      if (p.result === 'fumble') return `${who} fumbles. ${def} has it.`;
      if (p.yards === 0)
        return `${sit}${who}, stopped for no gain${tackler ? ` by ${tackler}` : ''}.`;
      if (p.yards < 0) return `${sit}${who}, dropped for a loss of ${yds(p.yards)}.`;
      const dir =
        p.direction === 'middle'
          ? ' up the middle'
          : p.direction
            ? ` around the ${p.direction} side`
            : '';
      if (p.yards >= 20) return `${who}${dir}. Breaks free. ${yds(p.yards)}.`;
      return `${sit}${who}${dir}, picks up ${yds(p.yards)}.`;
    }
    case 'pass': {
      const w = where(c);
      const to = rec || 'his receiver';
      if (p.result === 'interception')
        return `${qb || off} throws, and it's picked off${ret ? `. ${ret}` : ''}. ${def} ball.`;
      if (p.result === 'incomplete')
        return `${sit}${qb || off} looking${w ? ` ${w}` : ''}${rec ? ` for ${rec}` : ''}. Incomplete.`;
      if (p.result === 'td') return `${qb || off} to ${to}. Touchdown.`;
      if (p.result === 'fumble') return `${to} with the catch, and he fumbles. ${def} ball.`;
      if (p.depth === 'deep' || p.yards >= 20)
        return `${qb || off} goes deep for ${to}. Caught. ${yds(p.yards)}.`;
      return `${sit}${qb || off} to ${to}${w ? `, ${w}` : ''}, ${yds(p.yards)}.`;
    }
    case 'sack':
      return `${sit}${qb || off}, sacked${tackler ? ` by ${tackler}` : ''}. A loss of ${yds(p.yards)}.`;
    case 'punt':
      return `${kicker || off} punts it away${ret ? `, ${ret} back to receive` : ''}.`;
    case 'kickoff':
      if (p.result === 'td') return `${ret || 'The return man'} takes it all the way. Touchdown.`;
      return p.result === 'touchback'
        ? `${kicker || 'The kick'} sends it deep. Touchback.`
        : `${kicker || off} kicks off${ret ? `, ${ret} brings it out` : ''}.`;
    case 'fg': {
      const from = p.kickYards ? ` from ${p.kickYards}` : '';
      return p.result === 'good'
        ? `${kicker || off}${from}. It's good.`
        : `${kicker || off}${from}. No good.`;
    }
    case 'pat':
      return p.result === 'good' ? 'Extra point is good.' : 'The extra point is no good.';
    case 'penalty':
      return p.penalty
        ? `Flag down. ${p.penalty.name}, on ${p.penalty.team}.`
        : 'Flag on the play.';
    case 'kneel':
      return `${qb || off} takes a knee.`;
    case 'spike':
      return `${qb || off} spikes it. The clock stops.`;
    default:
      return p.text.length > 120 ? `${p.text.slice(0, 117)}...` : p.text;
  }
}

function colorLine(c: PlayContext): string | undefined {
  if (!c.notable) return undefined;
  const p = c.play;
  const wp = c.winProbability;
  if (wp?.before !== undefined && Math.abs(wp.after - wp.before) > 5) {
    return `${wp.team} win probability moves from ${wp.before}% to ${wp.after}%.`;
  }
  if (p.points) {
    const [a, b] = Object.entries(c.score);
    if (a && b) return `That makes it ${a[0]} ${a[1]}, ${b[0]} ${b[1]}.`;
  }
  if (p.result === 'interception' || p.result === 'fumble')
    return `A turnover, and ${c.defense} get the ball back.`;
  if (c.before.down === 3 || c.before.down === 4) {
    const needed = c.before.distance ?? 0;
    const converted =
      ['run', 'pass'].includes(p.type) && p.result !== 'incomplete' && p.yards >= needed;
    if (c.before.down === 4)
      return converted
        ? 'They went for it on fourth down and got it.'
        : 'Stopped on fourth down. Turnover on downs.';
    return converted ? 'Third down converted. The drive stays alive.' : 'Stopped on third down.';
  }
  if (p.yards >= 20) return `A chunk play: ${yds(p.yards)} on one snap.`;
  return undefined;
}

function stoppageColor(c: StoppageContext): string {
  if (c.drive.team && c.drive.plays > 0) {
    return `${c.drive.team} have run ${c.drive.plays} play${c.drive.plays === 1 ? '' : 's'} for ${yds(c.drive.yards)} on this drive.`;
  }
  if (c.winProbability)
    return `${c.winProbability.team} win probability sits at ${c.winProbability.after}%.`;
  const [a, b] = Object.entries(c.score);
  return a && b ? `Score check: ${a[0]} ${a[1]}, ${b[0]} ${b[1]}.` : 'Play is stopped.';
}

export function templateLines(c: CommentaryContext): LinePair {
  if (c.kind === 'stoppage') return { pbp: '', color: stoppageColor(c) };
  const color = colorLine(c);
  return { pbp: playLine(c), ...(color ? { color } : {}) };
}
