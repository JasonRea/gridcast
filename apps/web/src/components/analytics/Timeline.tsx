import type { LoggedEvent, PlayEvent, TeamInfo } from '@gridcast/types';
import { headline, playLabel, swing } from '@/lib/plays';
import { cn } from '@/lib/utils';

/**
 * Timeline scrubber: the whole game as a strip (one tick per play), quarter breaks, big plays
 * marked in team colors. Click anywhere to jump there; chips jump straight to the biggest swings.
 */
export function Timeline({
  entries,
  currentSeq,
  teams,
  onJump,
}: {
  entries: LoggedEvent[];
  currentSeq: number;
  teams: { home: TeamInfo; away: TeamInfo };
  onJump: (seq: number) => void;
}) {
  const plays = entries.filter(
    (e): e is LoggedEvent & { event: PlayEvent } => e.event.kind === 'play',
  );
  if (plays.length < 2) return null;
  const n = plays.length;
  const pos = (i: number) => `${(i / (n - 1)) * 100}%`;
  const currentIdx = Math.max(
    0,
    plays.findLastIndex((p) => p.seq <= currentSeq),
  );
  const quarterStarts = plays.flatMap((p, i) =>
    i > 0 && p.event.pre.quarter !== plays[i - 1]!.event.pre.quarter ? [i] : [],
  );
  const color = (p: PlayEvent) =>
    p.pre.possession === teams.home.abbr ? teams.home.color : teams.away.color;
  const big = plays
    .map((p, i) => ({ p, i, s: Math.abs(swing(p.event)) }))
    .filter(({ p }) => p.event.big)
    .sort((a, b) => b.s - a.s)
    .slice(0, 8)
    .sort((a, b) => a.i - b.i);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-semibold uppercase tracking-wider">Timeline</span>
        <span className="num">
          Play {currentIdx + 1} of {n}
        </span>
      </div>
      <div
        className="relative h-8 cursor-pointer rounded-md bg-secondary"
        role="slider"
        aria-label="Game timeline"
        aria-valuemin={1}
        aria-valuemax={n}
        aria-valuenow={currentIdx + 1}
        tabIndex={0}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const i = Math.round(((e.clientX - r.left) / r.width) * (n - 1));
          const target = plays[Math.max(0, Math.min(n - 1, i))];
          if (target) onJump(target.seq);
        }}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-l-md bg-white/10"
          style={{ width: pos(currentIdx) }}
        />
        {quarterStarts.map((i) => (
          <span
            key={`q${i}`}
            className="absolute inset-y-0 w-px bg-white/25"
            style={{ left: pos(i) }}
          />
        ))}
        {plays.map((p, i) =>
          p.event.big ? (
            <span
              key={p.seq}
              className="absolute top-1/2 h-4 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{ left: pos(i), background: color(p.event) }}
              title={`${playLabel(p.event)} ${headline(p.event)}`}
            />
          ) : null,
        )}
        <span
          className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white"
          style={{ left: pos(currentIdx) }}
        />
      </div>
      {big.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Big plays">
          {big.map(({ p, i }) => (
            <button
              key={p.seq}
              onClick={() => onJump(p.seq)}
              className={cn(
                'flex shrink-0 items-center gap-2 rounded-md bg-secondary px-2.5 py-1.5 text-xs hover:bg-[#242424]',
                i === currentIdx && 'ring-1 ring-white',
              )}
            >
              <span className="size-2 rounded-full" style={{ background: color(p.event) }} />
              <span className="text-muted-foreground num">{playLabel(p.event)}</span>
              <span className="font-medium">{headline(p.event)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
