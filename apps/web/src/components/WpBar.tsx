import { motion } from 'motion/react';
import type { TeamInfo } from '@gridcast/types';
import { pct } from '@/lib/format';

/**
 * Win probability bar: away share on the left, home on the right, in team colors.
 * Fed by ESPN win probability; the prediction market's win probability (Kalshi) shown beside it
 * when available. Information only, not betting advice.
 */
export function WpBar({
  home,
  away,
  homeProb,
  kalshiHome,
}: {
  home: TeamInfo;
  away: TeamInfo;
  homeProb?: number;
  kalshiHome?: number;
}) {
  const h = homeProb ?? kalshiHome;
  const awayShare = h === undefined ? 0.5 : 1 - h;
  return (
    <div className="flex flex-col gap-1.5" aria-label="Win probability">
      <div className="flex items-center justify-between text-xs text-muted-foreground num">
        <span>
          <span className="text-foreground">{away.abbr}</span>{' '}
          {pct(h === undefined ? undefined : 1 - h)}
        </span>
        <span className="uppercase tracking-wider">
          Win probability{homeProb === undefined && kalshiHome !== undefined ? ' (market)' : ''}
        </span>
        <span>
          {pct(h)} <span className="text-foreground">{home.abbr}</span>
        </span>
      </div>
      <div className="relative flex h-2 overflow-hidden rounded-full bg-secondary">
        <motion.div
          className="h-full"
          style={{ background: away.color }}
          initial={false}
          animate={{ width: `${awayShare * 100}%` }}
          transition={{ type: 'spring', stiffness: 80, damping: 20 }}
        />
        <div className="h-full flex-1" style={{ background: home.color }} />
        <div className="absolute inset-y-0 left-1/2 w-px bg-black/60" />
      </div>
      {kalshiHome !== undefined && (
        <div className="flex justify-between text-[11px] text-muted-foreground num">
          <span>
            Market {away.abbr} {pct(1 - kalshiHome)}
          </span>
          <span className="hidden sm:inline">Market win probability · Kalshi</span>
          <span>
            {home.abbr} {pct(kalshiHome)}
          </span>
        </div>
      )}
    </div>
  );
}
