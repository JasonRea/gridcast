import type { PlayEvent, TeamInfo } from '@gridcast/types';

/** The current drive as a strip: start spot, each play's gain, where the ball is now. */
export function DriveTracker({
  plays,
  teams,
}: {
  plays: PlayEvent[];
  teams: { home: TeamInfo; away: TeamInfo };
}) {
  const last = plays[plays.length - 1];
  if (!last) return null;
  const driveId = last.driveId;
  const drive = (driveId ? plays.filter((p) => p.driveId === driveId) : plays.slice(-6)).filter(
    (p) => p.parsed.type !== 'kickoff' && p.pre.possession === last.pre.possession,
  );
  const team = last.pre.possession === teams.home.abbr ? teams.home : teams.away;
  const start = drive[0]?.pre.yardLine ?? last.pre.yardLine;
  const end =
    last.state.possession === last.pre.possession ? last.state.yardLine : last.parsed.endYd;
  const yards = drive.reduce((a, p) => a + (p.parsed.type === 'penalty' ? 0 : p.parsed.yards), 0);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground num">
        <span>
          <span className="font-semibold text-foreground">{team.abbr} drive</span> · {drive.length}{' '}
          plays · {yards} yds
        </span>
        <span>
          Own {start} to {end >= 50 ? `opp ${100 - end}` : `own ${end}`}
        </span>
      </div>
      <div className="relative h-3 rounded-full bg-secondary" aria-hidden>
        <div className="absolute inset-y-0 left-1/2 w-px bg-white/20" />
        <div
          className="absolute inset-y-0 rounded-full"
          style={{
            left: `${Math.min(start, end)}%`,
            width: `${Math.max(1, Math.abs(end - start))}%`,
            background: team.color,
            opacity: 0.85,
          }}
        />
        {drive.map((p) => (
          <span
            key={p.id}
            className="absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/70"
            style={{ left: `${p.pre.yardLine}%` }}
          />
        ))}
      </div>
    </div>
  );
}
