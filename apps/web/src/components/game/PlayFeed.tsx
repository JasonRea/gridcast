import { AnimatePresence, motion } from 'motion/react';
import type { PlayEvent, TeamInfo } from '@gridcast/types';
import type { Lines } from '@/store/game';
import { clockLabel, periodLabel } from '@/lib/format';
import { cn } from '@/lib/utils';

function stripClock(text: string) {
  return text.replace(/^\(\s*\d{0,2}:\d{2}\s*\)\s*/, '');
}

/** Right rail: newest play first, raw text always visible, commentary under it. */
export function PlayFeed({
  plays,
  commentary,
  deltas,
  teams,
  currentId,
  onSelect,
}: {
  plays: PlayEvent[];
  commentary: Record<string, Lines>;
  deltas: Record<string, Lines>;
  teams: { home: TeamInfo; away: TeamInfo };
  currentId?: string;
  onSelect: (index: number) => void;
}) {
  const rows = plays.map((p, i) => ({ p, i })).reverse();
  return (
    <ol className="flex flex-col gap-2" aria-label="Play by play">
      <AnimatePresence initial={false}>
        {rows.slice(0, 120).map(({ p, i }) => {
          const team = p.pre.possession === teams.home.abbr ? teams.home : teams.away;
          const lines = { ...deltas[p.id], ...commentary[p.id] };
          const chipTone = p.parsed.points
            ? 'text-positive'
            : p.parsed.result === 'interception' || p.parsed.result === 'fumble'
              ? 'text-negative'
              : 'text-muted-foreground';
          return (
            <motion.li
              key={p.id}
              layout="position"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
            >
              <button
                onClick={() => onSelect(i)}
                className={cn(
                  'w-full rounded-md bg-card p-3 text-left transition-colors hover:bg-secondary',
                  p.id === currentId && 'bg-secondary',
                )}
              >
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground num">
                  <span className="size-2 rounded-full" style={{ background: team.color }} />
                  <span>
                    {periodLabel(p.pre.quarter)} {clockLabel(p.pre.clock)}
                  </span>
                  {p.big && (
                    <span className="font-semibold uppercase tracking-wide text-foreground">
                      Big play
                    </span>
                  )}
                  <span className={cn('ml-auto font-semibold uppercase', chipTone)}>
                    {p.parsed.points
                      ? `+${p.parsed.points}`
                      : p.parsed.type === 'penalty'
                        ? 'Flag'
                        : `${p.parsed.yards > 0 ? '+' : ''}${p.parsed.yards} yds`}
                  </span>
                </div>
                {lines.pbp && (
                  <p className="mt-1.5 text-sm font-medium leading-snug">{lines.pbp}</p>
                )}
                {lines.color && (
                  <p className="mt-1 text-sm leading-snug text-muted-foreground">{lines.color}</p>
                )}
                <p
                  className={cn(
                    'mt-1.5 text-xs leading-snug text-muted-foreground',
                    !lines.pbp && 'text-sm text-foreground',
                  )}
                >
                  {stripClock(p.raw.text)}
                </p>
              </button>
            </motion.li>
          );
        })}
      </AnimatePresence>
      {!plays.length && (
        <li className="rounded-md bg-card p-4 text-sm text-muted-foreground">
          Waiting for the first play.
        </li>
      )}
    </ol>
  );
}
