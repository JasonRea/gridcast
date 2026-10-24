import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type { GameCard as Card } from '@gridcast/types';
import { OddsFooter } from '@/components/OddsFooter';
import { GameCard } from '@/components/home/GameCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

function Section({ title, games }: { title: string; games: Card[] }) {
  if (!games.length) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {games.map((g) => (
          <GameCard key={g.id} g={g} />
        ))}
      </div>
    </section>
  );
}

export function Home() {
  const [week, setWeek] = useState<number | undefined>(undefined);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['scoreboard', week],
    queryFn: () => api.scoreboard(undefined, week),
    refetchInterval: 30_000,
  });
  const current = week ?? data?.week;
  const games = data?.games ?? [];
  const pinned = games.filter((g) => g.featured);
  const rest = games.filter((g) => !g.featured);
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-center gap-4">
        <div>
          <h1 className="display text-4xl leading-none">GRIDCAST</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every NFL play, animated and explained from the live data feed.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1" aria-label="Week picker">
          <Button
            size="icon"
            variant="ghost"
            disabled={!current || current <= 1}
            onClick={() => setWeek((current ?? 2) - 1)}
            aria-label="Previous week"
          >
            <ChevronLeft />
          </Button>
          <span className="w-20 text-center text-sm font-semibold num">Week {current ?? '-'}</span>
          <Button
            size="icon"
            variant="ghost"
            disabled={!current || current >= 18}
            onClick={() => setWeek((current ?? 0) + 1)}
            aria-label="Next week"
          >
            <ChevronRight />
          </Button>
        </div>
      </header>
      {data?.dataSource === 'fixture' && (
        <Badge variant="stale" className="self-start">
          Live feed unavailable: showing saved data
        </Badge>
      )}
      {isLoading && <p className="text-sm text-muted-foreground">Loading scoreboard...</p>}
      {isError && <p className="text-sm text-negative">Could not reach the Gridcast server.</p>}
      <Section title="Featured" games={pinned} />
      <Section title="Live" games={rest.filter((g) => g.status === 'live')} />
      <Section title="Upcoming" games={rest.filter((g) => g.status === 'pre')} />
      <Section title="Final" games={rest.filter((g) => g.status === 'final')} />
      <OddsFooter />
    </main>
  );
}
