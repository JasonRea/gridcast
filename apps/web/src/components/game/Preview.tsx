import { useEffect, useState } from 'react';
import type { GameDetail } from '@gridcast/types';
import { TeamMark } from '@/components/TeamMark';
import { kickoffLabel } from '@/lib/format';

function countdown(ms: number): string {
  if (ms <= 0) return 'Kickoff';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return h > 24
    ? `${Math.floor(h / 24)}d ${h % 24}h`
    : `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Upcoming game. The page polls the server and switches to the live view at kickoff. */
export function Preview({ detail }: { detail: GameDetail }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const kickoff = Date.parse(detail.kickoff);
  return (
    <section className="flex flex-col items-center gap-6 rounded-md bg-card px-4 py-10 text-center">
      <div className="flex items-center gap-6 text-2xl sm:text-4xl">
        <TeamMark team={detail.away} size="lg" />
        <span className="text-muted-foreground">at</span>
        <TeamMark team={detail.home} size="lg" />
      </div>
      <div className="display text-6xl leading-none sm:text-7xl">{countdown(kickoff - now)}</div>
      <div className="flex flex-wrap justify-center gap-x-6 gap-y-1 text-sm text-muted-foreground num">
        <span>{kickoffLabel(detail.kickoff)}</span>
        {detail.venue && <span>{detail.venue}</span>}
        {detail.tv && <span>{detail.tv}</span>}
        {detail.spread && <span>Line {detail.spread}</span>}
        {detail.total !== undefined && <span>O/U {detail.total}</span>}
      </div>
      <div className="flex gap-8 text-sm text-muted-foreground">
        {detail.away.record && (
          <span>
            {detail.away.abbr} {detail.away.record}
          </span>
        )}
        {detail.home.record && (
          <span>
            {detail.home.abbr} {detail.home.record}
          </span>
        )}
      </div>
      <p className="max-w-md text-sm text-muted-foreground">
        This page switches to the live field at kickoff. No reload needed.
      </p>
    </section>
  );
}
