/**
 * What a play feels like when it ends. Ported from `outcomeOf` in apps/web/src/lib/access.ts
 * (that module also builds Web Audio graphs at import time, so it isn't imported here).
 */
import type { PlayEvent } from '@gridcast/types';

export type Outcome =
  'td' | 'turnover' | 'first_down' | 'incomplete' | 'tackle' | 'score' | 'miss' | 'flag' | 'none';

export function outcomeOf(play: PlayEvent): Outcome {
  const p = play.parsed;
  if (p.result === 'interception' || p.result === 'fumble') return 'turnover';
  if (p.result === 'td') return 'td';
  if (p.type === 'fg' || p.type === 'pat') return p.result === 'good' ? 'score' : 'miss';
  if (p.type === 'penalty') return 'flag';
  if (p.result === 'incomplete') return p.type === 'spike' ? 'none' : 'incomplete';
  if (p.firstDown && (p.type === 'run' || p.type === 'pass')) return 'first_down';
  if (p.type === 'run' || p.type === 'pass' || p.type === 'sack' || p.type === 'kneel')
    return 'tackle';
  return 'none';
}

/** iOS haptic for an outcome (the web's Android vibration patterns, mapped to Taptic types). */
export type HapticKind = 'success' | 'heavy' | 'medium' | 'light';

export const HAPTIC_FOR: Partial<Record<Outcome, HapticKind>> = {
  td: 'success',
  turnover: 'heavy',
  score: 'medium',
  first_down: 'light',
};
