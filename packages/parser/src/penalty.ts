import { normalizeAbbr, type PenaltyInfo } from '@gridcast/types';

const SEGMENT = /penalty on ([A-Z]{2,3})\b(?:-(\d{1,2}))?(?:-([^,]+))?,\s*([^,]+?)\s*,/gi;

export type ParsedPenalty = PenaltyInfo & { declined: boolean };

/**
 * Reads every "PENALTY on TEAM-##-Name, Foul, N yards, enforced at X - No Play." clause.
 * Returns the penalty that matters (first accepted one, else the first one).
 */
export function parsePenalties(text: string): ParsedPenalty[] {
  const out: ParsedPenalty[] = [];
  const starts: number[] = [];
  const re = /penalty on /gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) starts.push(m.index);
  for (let i = 0; i < starts.length; i++) {
    const seg = text.slice(starts[i], starts[i + 1] ?? text.length);
    SEGMENT.lastIndex = 0;
    const s = SEGMENT.exec(seg + ',');
    if (!s) continue;
    const team = normalizeAbbr(s[1] ?? '');
    const name = (s[4] ?? '').trim();
    const after = seg.slice((s.index ?? 0) + s[0].length);
    const declined = /\bdeclined\b/i.test(after.slice(0, 40)) || /,\s*declined/i.test(seg);
    const offsetting = /\boffsetting\b/i.test(seg) || /penalties offset/i.test(text);
    const yardsM = /(\d+) yards?/.exec(after);
    const noPlay = /no play/i.test(seg);
    out.push({
      name,
      team,
      yards: yardsM ? Number(yardsM[1]) : 0,
      accepted: !declined && !offsetting,
      noPlay,
      offsetting,
      declined,
      ...(s[3] ? { player: s[3].trim() } : {}),
    });
  }
  return out;
}

export function mainPenalty(list: ParsedPenalty[]): ParsedPenalty | undefined {
  return list.find((p) => p.accepted) ?? list[0];
}

/** Plain-English one-liners for common fouls, used by stoppage cards. */
export const PENALTY_GLOSSARY: Record<string, string> = {
  'false start': 'An offensive player moved before the snap.',
  'offensive holding': 'A blocker illegally grabbed a defender to stop him.',
  'defensive holding': 'A defender illegally grabbed a receiver before the ball was thrown.',
  holding: 'A player illegally grabbed an opponent.',
  'defensive pass interference':
    'A defender illegally blocked the receiver from catching the ball. The ball goes to the spot of the foul.',
  'offensive pass interference':
    'The receiver illegally pushed off or blocked a defender while the pass was in the air.',
  'roughing the passer': 'A defender hit the quarterback late or illegally after the throw.',
  'unnecessary roughness': 'A player made an illegal, dangerous hit.',
  'neutral zone infraction':
    'A defender crossed the line before the snap and caused an offensive player to move.',
  encroachment: 'A defender crossed the line and touched an offensive player before the snap.',
  'defensive offside': 'A defender was across the line of scrimmage at the snap.',
  offside: 'A player was across the line of scrimmage at the snap.',
  'delay of game': 'The offense did not snap the ball before the play clock hit zero.',
  'illegal formation': 'The offense did not have enough players on the line of scrimmage.',
  'illegal shift': 'More than one offensive player was moving at the snap.',
  'illegal motion': 'A player was moving toward the line at the snap.',
  'illegal use of hands': 'A player hit an opponent in the face or neck area with his hands.',
  'face mask': "A player grabbed and twisted an opponent's face mask.",
  'intentional grounding':
    'The quarterback threw the ball away to avoid a sack with no receiver nearby.',
  'illegal contact': 'A defender made contact with a receiver more than five yards downfield.',
  'unsportsmanlike conduct':
    'A player was penalized for taunting or other unsportsmanlike behavior.',
  taunting: 'A player taunted an opponent.',
  'illegal block above the waist':
    'A player blocked an opponent from behind, above the waist, on a kick return.',
  'ineligible downfield pass':
    'An offensive lineman was too far downfield when the pass was thrown.',
  'roughing the kicker': 'A defender ran into the kicker after the kick.',
  'running into the kicker': 'A defender bumped the kicker after the kick.',
  'too many men on the field': 'A team had more than 11 players on the field.',
  'horse collar tackle': 'A defender tackled the ball carrier by pulling the back of his collar.',
  tripping: 'A player tripped an opponent.',
  clipping: 'A player blocked an opponent from behind at or below the waist.',
  'chop block': 'Two offensive players blocked one defender high and low at the same time.',
  'illegal forward pass':
    'A pass was thrown from beyond the line of scrimmage, or was the second forward pass.',
  'lowering the head to initiate contact':
    'A player lowered his helmet to make contact with an opponent.',
};

export function explainPenalty(name: string): string {
  const key = name.toLowerCase().trim();
  if (PENALTY_GLOSSARY[key]) return PENALTY_GLOSSARY[key];
  const hit = Object.keys(PENALTY_GLOSSARY).find((k) => key.includes(k));
  return hit ? (PENALTY_GLOSSARY[hit] ?? '') : `Flag for ${name.toLowerCase()}.`;
}
