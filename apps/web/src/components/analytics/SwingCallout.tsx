import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import type { PlayEvent, TeamInfo } from '@gridcast/types';

/** "Steelers 48% to 61%": shown on the field after a play moves win probability 5+ points. */
export function SwingCallout({
  play,
  teams,
}: {
  play: PlayEvent | undefined;
  teams: { home: TeamInfo; away: TeamInfo };
}) {
  const [shown, setShown] = useState<PlayEvent | undefined>();
  useEffect(() => {
    if (!play || play.wpBefore === undefined || play.wpAfter === undefined) return;
    if (Math.abs(play.wpAfter - play.wpBefore) < 0.05) return;
    setShown(play);
    const t = setTimeout(() => setShown(undefined), 4500);
    return () => clearTimeout(t);
  }, [play]);
  const p = shown;
  const team = p ? (p.wpAfter! >= p.wpBefore! ? teams.home : teams.away) : undefined;
  const f = (x: number) => Math.round((team === teams.home ? x : 1 - x) * 100);
  return (
    <AnimatePresence>
      {p && team && (
        <motion.div
          key={p.id}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="pointer-events-none absolute top-3 left-3 rounded-md bg-popover/95 px-3 py-2 backdrop-blur"
        >
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Win probability swing
          </div>
          <div className="display text-2xl leading-tight">
            <span style={{ color: team.color }}>{team.shortName}</span> {f(p.wpBefore!)}%{' '}
            <span className="text-muted-foreground">to</span> {f(p.wpAfter!)}%
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
