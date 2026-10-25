import * as Haptics from 'expo-haptics';
import type { PlayEvent } from '@gridcast/types';
import { HAPTIC_FOR, outcomeOf } from '@/lib/outcome';

/** Fires the play's haptic (touchdown, turnover, score, first down). Never throws. */
export function playHaptic(play: PlayEvent): void {
  const kind = HAPTIC_FOR[outcomeOf(play)];
  if (!kind) return;
  const run =
    kind === 'success'
      ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      : Haptics.impactAsync(
          kind === 'heavy'
            ? Haptics.ImpactFeedbackStyle.Heavy
            : kind === 'medium'
              ? Haptics.ImpactFeedbackStyle.Medium
              : Haptics.ImpactFeedbackStyle.Light,
        );
  run.catch(() => undefined);
}
