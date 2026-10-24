import { Link } from '@tanstack/react-router';
import type { GameCard as Card } from '@gridcast/types';
import { Badge } from '@/components/ui/badge';
import { kickoffLabel, pct } from '@/lib/format';
import { cn } from '@/lib/utils';

function Row({
  team,
  score,
  ball,
  winner,
}: {
  team: Card['home'];
  score?: number;
  ball?: boolean;
  winner?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="h-6 w-1 rounded-full" style={{ background: team.color }} />
      <span className={cn('font-semibold', winner === false && 'text-muted-foreground')}>
        {team.abbr}
      </span>
      <span className="truncate text-sm text-muted-foreground">{team.shortName}</span>
      {ball && <span className="size-1.5 rounded-full bg-white" aria-label="Has the ball" />}
      <span
        className={cn(
          'display ml-auto text-2xl leading-none',
          winner === false && 'text-muted-foreground',
        )}
      >
        {score ?? ''}
      </span>
    </div>
  );
}

export function GameCard({ g }: { g: Card }) {
  const final = g.status === 'final';
  const hs = g.home.score ?? 0;
  const as = g.away.score ?? 0;
  const prob = g.homeWinProb ?? g.kalshiHomeProb;
  return (
    <Link
      to="/game/$id"
      params={{ id: g.id }}
      className={cn(
        'group flex flex-col gap-3 rounded-md bg-card p-4 transition-colors hover:bg-secondary',
        g.featured && 'sm:col-span-2',
      )}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground num">
        {g.status === 'live' && <Badge variant="live">Live</Badge>}
        {g.featured && <Badge>Featured</Badge>}
        {g.demo && <Badge>Demo replay</Badge>}
        <span className="truncate">{g.status === 'pre' ? kickoffLabel(g.kickoff) : g.detail}</span>
        {g.tv && <span className="ml-auto shrink-0">{g.tv}</span>}
      </div>
      <Row
        team={g.away}
        {...(g.status !== 'pre' ? { score: as } : {})}
        ball={g.possession === g.away.abbr}
        {...(final ? { winner: as > hs } : {})}
      />
      <Row
        team={g.home}
        {...(g.status !== 'pre' ? { score: hs } : {})}
        ball={g.possession === g.home.abbr}
        {...(final ? { winner: hs > as } : {})}
      />
      {g.status === 'live' && g.downDistance && (
        <div className="text-xs text-muted-foreground">{g.downDistance}</div>
      )}
      {g.status === 'live' && prob !== undefined && (
        <div className="flex h-1.5 overflow-hidden rounded-full bg-secondary">
          <div style={{ width: `${(1 - prob) * 100}%`, background: g.away.color }} />
          <div className="flex-1" style={{ background: g.home.color }} />
        </div>
      )}
      <div className="flex items-center gap-3 text-xs text-muted-foreground num">
        {g.status === 'pre' && g.spread && <span>{g.spread}</span>}
        {g.status === 'pre' && g.total !== undefined && <span>O/U {g.total}</span>}
        {g.kalshiHomeProb !== undefined && (
          <span>
            Kalshi {g.home.abbr} {pct(g.kalshiHomeProb)}
          </span>
        )}
        {final && g.topPerformer && <span className="truncate">{g.topPerformer}</span>}
        {final && (
          <span className="ml-auto font-medium text-foreground group-hover:underline">
            Watch replay
          </span>
        )}
      </div>
    </Link>
  );
}
