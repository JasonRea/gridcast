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

function playLine(c: PlayContext): string {
  const p = c.play;
  const qb = role(c, 'passer');
  const rusher = role(c, 'rusher');
  const rec = role(c, 'receiver');
  const tackler = role(c, 'tackler');
  const kicker = role(c, 'kicker');
  const ret = role(c, 'returner');
  const off = c.offense;
  switch (p.type) {
    case 'run': {
      const who = rusher || off;
      if (p.result === 'td')
        return `${who} punches it in from ${yds(p.yards)} out. Touchdown ${off}!`;
      if (p.result === 'fumble') return `${who} fumbles and ${c.defense} recover!`;
      if (p.yards === 0) return `${who} is stopped for no gain${tackler ? ` by ${tackler}` : ''}.`;
      if (p.yards < 0) return `${who} is dropped for a loss of ${yds(p.yards)}.`;
      const dir =
        p.direction === 'middle'
          ? 'up the middle'
          : p.direction
            ? `around the ${p.direction} side`
            : '';
      return `${who} runs ${dir ? `${dir} ` : ''}for ${yds(p.yards)}.`;
    }
    case 'pass': {
      const w = where(c);
      if (p.result === 'interception')
        return `${qb || off} is intercepted${ret ? ` by ${ret}` : ''}! ${c.defense} take over.`;
      if (p.result === 'incomplete')
        return `${qb || off} throws ${w ? `${w} ` : ''}${rec ? `for ${rec}` : ''}, incomplete.`.replace(
          /\s+,/,
          ',',
        );
      if (p.result === 'td')
        return `${qb || off} finds ${rec || 'his receiver'} for a ${yds(p.yards)} touchdown!`;
      if (p.result === 'fumble')
        return `${rec || 'The receiver'} catches it but fumbles, ${c.defense} recover!`;
      return `${qb || off} hits ${rec || 'his receiver'} ${w ? `${w} ` : ''}for ${yds(p.yards)}.`;
    }
    case 'sack':
      return `${qb || off} is sacked${tackler ? ` by ${tackler}` : ''} for a loss of ${yds(p.yards)}.`;
    case 'punt':
      return `${kicker || off} punts it away${ret ? `, ${ret} fields it` : ''}.`;
    case 'kickoff':
      return p.result === 'touchback'
        ? `${kicker || 'The kick'} sends it deep for a touchback.`
        : `${kicker || 'Kickoff'} kicks off${ret ? `, returned by ${ret}` : ''}.`;
    case 'fg':
      return p.result === 'good'
        ? `${kicker || off} drills the field goal. Good!`
        : `${kicker || off} misses the field goal.`;
    case 'pat':
      return p.result === 'good' ? `Extra point is good.` : `Extra point is no good.`;
    case 'penalty':
      return p.penalty
        ? `Flag: ${p.penalty.name} on ${p.penalty.team}, ${yds(p.penalty.yards)}.`
        : 'Flag on the play.';
    case 'kneel':
      return `${qb || off} takes a knee.`;
    case 'spike':
      return `${qb || off} spikes it to stop the clock.`;
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
