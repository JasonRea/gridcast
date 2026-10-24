import { AnimatePresence, motion } from 'motion/react';
import { Flag, HeartPulse, Timer, Video, Whistle } from './icons';
import type { StoppageEvent, TeamInfo } from '@gridcast/types';
import type { Lines } from '@/store/game';

const ICON = {
  timeout: Timer,
  injury: HeartPulse,
  review: Video,
  penalty: Flag,
  quarter_end: Whistle,
  two_minute: Timer,
  halftime: Whistle,
} as const;

/** Floating card explaining why play stopped. */
export function StoppageCard({
  card,
  teams,
  lines,
}: {
  card: StoppageEvent | undefined;
  teams: { home: TeamInfo; away: TeamInfo };
  lines?: Lines;
}) {
  const team =
    card?.team === teams.home.abbr
      ? teams.home
      : card?.team === teams.away.abbr
        ? teams.away
        : undefined;
  const Icon = card ? ICON[card.reason] : Timer;
  return (
    <AnimatePresence>
      {card && (
        <motion.div
          key={card.id}
          role="status"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.25 }}
          className="pointer-events-none absolute inset-x-3 bottom-3 mx-auto max-w-md rounded-md bg-popover/95 p-4 backdrop-blur sm:inset-x-auto sm:right-4 sm:bottom-4"
        >
          <div className="flex items-center gap-2">
            <Icon
              className="size-4"
              style={{ color: team?.color ?? (card.reason === 'penalty' ? '#FFD60A' : '#fff') }}
            />
            <span className="text-xs font-semibold uppercase tracking-wider">
              {card.title ?? card.reason}
            </span>
          </div>
          <p className="mt-2 text-sm leading-snug">{card.detail}</p>
          {lines?.color && (
            <p className="mt-2 text-sm leading-snug text-muted-foreground">{lines.color}</p>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
