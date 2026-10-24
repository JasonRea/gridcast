/**
 * Grounding post-check: a Claude line is rejected when it names a person (or uses a number) that
 * is not in the context, or speculates about an injury. Rejected lines fall back to the template.
 */
import type { CommentaryContext } from './context.ts';

/** Capitalized words that are fine anywhere in a line. */
const COMMON = new Set(
  `a an and are as at back ball big but by can catch clock down downs drive end extra fair field first flag for from gets go goal good got
  great half he here his how huge in into is it its just kick kickoff knee late line look loss man more no now of off on one onside
  or out over pass play plays point points punt quarter red right left middle run sack safety second short side so still that the
  their them then there they third this three timeout to touchdown touchback turnover two up what wide with yard yards zone fourth
  win probability deep yes wow oh boy big-time incomplete intercepted interception fumble field-goal overtime ot q1 q2 q3 q4 nfl
  halftime two-minute warning replay review challenge penalty false start holding offside pass-interference defense offense
  defensive offensive special teams kalshi market odds model epa what's that's it's he's they've`.split(
    /\s+/,
  ),
);

const SEVERITY =
  /\b(torn|tear|acl|mcl|achilles|concussion|broken|fracture|season[- ]ending|out for the (?:season|game|year)|carted|serious|severe|surgery|mri)\b/i;

export type GroundingResult = { ok: true } | { ok: false; reason: string };

export function checkGrounding(
  line: string,
  ctx: CommentaryContext,
  vocab: Set<string>,
): GroundingResult {
  if (!line.trim()) return { ok: false, reason: 'empty' };
  if (line.split(/\s+/).length > 40) return { ok: false, reason: 'too long' };
  if (SEVERITY.test(line)) return { ok: false, reason: 'injury speculation' };

  // Names: capitalized words that are neither known names nor common words, and runs of
  // capitalized words ("Derrick Henry") that are not a known full name.
  for (const sentence of line.split(/(?<=[.!?])\s+/)) {
    const words = (sentence.match(/[A-Za-z][A-Za-z'.-]*/g) ?? []).map((w) =>
      w.replace(/[.']+$/, ''),
    );
    let run: string[] = [];
    const flush = (): GroundingResult | undefined => {
      const r = run;
      run = [];
      if (r.length < 2) return undefined;
      const full = r.join(' ').toLowerCase();
      return vocab.has(full) ? undefined : { ok: false, reason: `unknown name "${r.join(' ')}"` };
    };
    for (let i = 0; i < words.length; i++) {
      const word = words[i] ?? '';
      const lower = word.toLowerCase().replace(/'s$/, '');
      const capital = /^[A-Z]/.test(word);
      const common = COMMON.has(lower);
      if (capital && !common && !/[.-]/.test(word)) run.push(word.replace(/'s$/, ''));
      else {
        const bad = flush();
        if (bad) return bad;
      }
      if (!capital) continue;
      for (const part of word.split(/[.-]/).filter(Boolean)) {
        if (!/^[A-Z]/.test(part)) continue;
        const pl = part.toLowerCase().replace(/'s$/, '');
        if (vocab.has(pl) || COMMON.has(pl)) continue;
        if (i === 0 && !/[.-]/.test(word)) continue; // sentence-initial ordinary word
        return { ok: false, reason: `unknown name "${part}"` };
      }
    }
    const bad = flush();
    if (bad) return bad;
  }
  return checkNumbers(line, ctx);
}

/** Every number in the line must appear in the context (scores, yards, clock, percentages). */
function checkNumbers(line: string, ctx: CommentaryContext): GroundingResult {
  const facts = JSON.stringify(ctx);
  const nums = facts.match(/\d+/g) ?? [];
  const known = new Set(nums);
  // Derived numbers commentary may state: absolute yards, distance-to-go and point margins.
  if (ctx.kind === 'play') {
    known.add(String(Math.abs(ctx.play.yards)));
    const s = Object.values(ctx.score);
    if (s.length === 2) known.add(String(Math.abs((s[0] ?? 0) - (s[1] ?? 0))));
  }
  for (const n of line.match(/\d+/g) ?? []) {
    if (Number(n) <= 4) continue; // downs, quarters, timeouts
    if (!known.has(n)) return { ok: false, reason: `unknown number ${n}` };
  }
  return { ok: true };
}

/** Alias kept for readability at call sites. */
export const grounded = checkGrounding;
