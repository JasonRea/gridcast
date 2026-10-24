import type { GameDetail, GameState, TeamInfo } from '@gridcast/types';
import { LivePill } from '@/components/LivePill';
import { ballOn, clockLabel, downDistance, periodLabel } from '@/lib/format';
import { cn } from '@/lib/utils';

function Timeouts({ left, color }: { left: number; color: string }) {
  return (
    <span className="flex gap-1" aria-label={`${left} timeouts left`}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1 w-3 rounded-full"
          style={{ background: i < left ? color : '#242424' }}
        />
      ))}
    </span>
  );
}

function Side({
  team,
  score,
  hasBall,
  timeouts,
  align,
}: {
  team: TeamInfo;
  score?: number;
  hasBall: boolean;
  timeouts?: number;
  align: 'left' | 'right';
}) {
  const name = (
    <div
      className={cn(
        'flex min-w-0 items-center gap-3',
        align === 'right' && 'flex-row-reverse text-right',
      )}
    >
      <div className="h-10 w-1.5 shrink-0 rounded-full" style={{ background: team.color }} />
      <div className="min-w-0">
        <div className={cn('flex items-center gap-2', align === 'right' && 'flex-row-reverse')}>
          <span className="display text-2xl leading-none sm:text-3xl">{team.abbr}</span>
          {hasBall && <span className="size-2 rounded-full bg-white" aria-label="Has the ball" />}
        </div>
        <div
          className={cn(
            'mt-1 flex items-center gap-2 text-[11px] text-muted-foreground',
            align === 'right' && 'flex-row-reverse',
          )}
        >
          <span className="hidden truncate sm:inline">{team.record ?? team.shortName}</span>
          {timeouts !== undefined && <Timeouts left={timeouts} color={team.color} />}
        </div>
      </div>
    </div>
  );
  const pts = <span className="display text-5xl leading-none sm:text-6xl">{score ?? 0}</span>;
  return (
    <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
      {align === 'left' ? (
        <>
          {name}
          {pts}
        </>
      ) : (
        <>
          {pts}
          {name}
        </>
      )}
    </div>
  );
}

export function Scorebug({
  detail,
  state,
  source,
  lastUpdate,
  speed,
  clockPulse,
}: {
  detail: GameDetail;
  state: GameState | undefined;
  source: 'live' | 'replay';
  lastUpdate?: number;
  speed?: number;
  clockPulse?: boolean;
}) {
  const { home, away } = detail;
  const homeScore = state?.home ?? detail.home.score;
  const awayScore = state?.away ?? detail.away.score;
  const other = state ? (state.possession === home.abbr ? away.abbr : home.abbr) : '';
  const dd = state ? downDistance(state) : '';
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 sm:gap-6">
        <Side
          team={away}
          score={awayScore}
          hasBall={state?.possession === away.abbr}
          timeouts={state?.timeouts.away}
          align="left"
        />
        <div className="flex w-24 shrink-0 flex-col items-center gap-1 sm:w-32">
          <span
            className={cn(
              'display text-2xl leading-none sm:text-3xl',
              clockPulse && 'text-first-down',
            )}
          >
            {state ? `${periodLabel(state.quarter)} ${clockLabel(state.clock)}` : detail.detail}
          </span>
          <LivePill
            source={source}
            {...(lastUpdate !== undefined ? { lastUpdate } : {})}
            {...(speed !== undefined ? { speed } : {})}
          />
        </div>
        <Side
          team={home}
          score={homeScore}
          hasBall={state?.possession === home.abbr}
          timeouts={state?.timeouts.home}
          align="right"
        />
      </div>
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground num">
        {dd && (
          <span className="text-sm font-semibold text-foreground">
            {dd}{' '}
            <span className="font-normal text-muted-foreground">at {ballOn(state!, other)}</span>
          </span>
        )}
        {detail.spread && <span>Line {detail.spread}</span>}
        {detail.total !== undefined && <span>O/U {detail.total}</span>}
      </div>
    </div>
  );
}
