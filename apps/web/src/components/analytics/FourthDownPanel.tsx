import type { FourthDownCall, PlayEvent, TeamInfo } from '@gridcast/types';
import { playLabel } from '@/lib/plays';
import { cn } from '@/lib/utils';

const NAME = { go: 'Go for it', punt: 'Punt', fg: 'Field goal' } as const;

function Options({ call }: { call: FourthDownCall }) {
  const rows = (['go', 'fg', 'punt'] as const).filter((k) => call.options[k] !== undefined);
  return (
    <div className="mt-2 grid grid-cols-3 gap-2">
      {rows.map((k) => (
        <div
          key={k}
          className={cn('rounded-md bg-secondary p-2', call.recommend === k && 'ring-1 ring-white')}
        >
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{NAME[k]}</div>
          <div className="display text-xl leading-tight">
            {call.options[k]! > 0 ? '+' : ''}
            {call.options[k]!.toFixed(1)}
          </div>
          <div className="text-[11px] text-muted-foreground num">
            {k === 'go'
              ? `${Math.round(call.goProb * 100)}% to convert`
              : k === 'fg' && call.fgProb !== undefined
                ? `${Math.round(call.fgProb * 100)}% make`
                : 'expected pts'}
          </div>
        </div>
      ))}
    </div>
  );
}

/** 4th-down bot: the recommendation before the snap and the grade after it. */
export function FourthDownPanel({
  plays,
  teams,
}: {
  plays: PlayEvent[];
  teams: { home: TeamInfo; away: TeamInfo };
}) {
  const last = plays[plays.length - 1];
  const upcoming = last?.nextFourthDown;
  const graded = [...plays].reverse().find((p) => p.fourthDown?.call);
  const name = (abbr: string) =>
    abbr === teams.home.abbr ? teams.home.shortName : teams.away.shortName;
  if (!upcoming && !graded)
    return <p className="text-sm text-muted-foreground">No fourth down yet.</p>;
  return (
    <div className="flex flex-col gap-4">
      {upcoming && last && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Up next: {name(last.state.possession)} 4th &amp; {last.state.distance}
          </div>
          <p className="mt-1 text-sm">
            Bot says <span className="font-semibold">{NAME[upcoming.recommend]}</span>
          </p>
          <Options call={upcoming} />
        </div>
      )}
      {graded?.fourthDown && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Last 4th down · {playLabel(graded)} · {name(graded.pre.possession)}
          </div>
          <p className="mt-1 text-sm">
            Coach chose <span className="font-semibold">{NAME[graded.fourthDown.call!]}</span>.{' '}
            {graded.fourthDown.call === graded.fourthDown.recommend ||
            (graded.fourthDown.delta ?? 0) < 0.1 ? (
              <span className="text-positive">Agreed.</span>
            ) : (
              <span className="text-negative">
                Bot disagrees: -{graded.fourthDown.delta?.toFixed(1)} expected points.
              </span>
            )}
          </p>
          <Options call={graded.fourthDown} />
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        Values are expected points for the offense, from an nflverse model.
      </p>
    </div>
  );
}
