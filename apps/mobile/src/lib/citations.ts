/**
 * Chat citations like "[Q3 4:12]": split an answer into text and citation chips, and find the
 * play a citation points at. Label format comes from `playLabel` (apps/web/src/lib/plays.ts).
 */
import type { LoggedEvent, PlayEvent } from '@gridcast/types';
import { playLabel } from '@web/lib/plays';

export { firstCitation, speakableAnswer } from '@web/lib/booth';

const CITE = /\[((?:Q[1-4]|OT) \d{1,2}:\d{2})\]/g;

export type AnswerPart = { kind: 'text'; text: string } | { kind: 'cite'; label: string };

export function splitCitations(text: string): AnswerPart[] {
  return text
    .split(CITE)
    .map((part, i): AnswerPart =>
      i % 2 === 1 ? { kind: 'cite', label: part } : { kind: 'text', text: part },
    )
    .filter((p) => p.kind === 'cite' || p.text.length > 0);
}

/** Index of the presented play with this label, or -1. */
export function findPresented(
  plays: readonly PlayEvent[],
  presented: number,
  label: string,
): number {
  return plays.findIndex((p, k) => k < presented && playLabel(p) === label);
}

/** Log seq of the play with this label in the full log (replays jump there). */
export function findInLog(log: readonly LoggedEvent[], label: string): number | undefined {
  return log.find((e) => e.event.kind === 'play' && playLabel(e.event) === label)?.seq;
}
