import type { PlayEvent, TeamInfo } from '@gridcast/types';

function stats(plays: PlayEvent[], team: string) {
  const mine = plays.filter(
    (p) =>
      p.pre.possession === team &&
      p.epa !== undefined &&
      ['run', 'pass', 'sack'].includes(p.parsed.type),
  );
  const sum = (xs: PlayEvent[]) => xs.reduce((a, p) => a + (p.epa ?? 0), 0);
  const pass = mine.filter((p) => p.parsed.type !== 'run');
  const run = mine.filter((p) => p.parsed.type === 'run');
  const per = (xs: PlayEvent[]) => (xs.length ? sum(xs) / xs.length : undefined);
  return {
    plays: mine.length,
    total: sum(mine),
    perPlay: per(mine),
    pass: per(pass),
    run: per(run),
    success: mine.length ? mine.filter((p) => (p.epa ?? 0) > 0).length / mine.length : undefined,
  };
}

const fmt = (n: number | undefined) =>
  n === undefined ? '--' : `${n > 0 ? '+' : ''}${n.toFixed(2)}`;
const tone = (n: number | undefined) =>
  n === undefined ? '' : n > 0 ? 'text-positive' : n < 0 ? 'text-negative' : '';

/** Running team EPA per play (scrimmage plays only). */
export function TeamEpa({
  plays,
  teams,
}: {
  plays: PlayEvent[];
  teams: { home: TeamInfo; away: TeamInfo };
}) {
  const rows = [teams.away, teams.home].map((t) => ({ t, s: stats(plays, t.abbr) }));
  return (
    <table className="w-full text-sm num">
      <thead>
        <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
          <th className="py-1 font-medium">Team</th>
          <th className="py-1 font-medium">Plays</th>
          <th className="py-1 font-medium">EPA/play</th>
          <th className="py-1 font-medium">Pass</th>
          <th className="py-1 font-medium">Run</th>
          <th className="py-1 font-medium">Success</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ t, s }) => (
          <tr key={t.abbr}>
            <td className="py-1.5">
              <span className="inline-flex items-center gap-2 font-semibold">
                <span className="size-2 rounded-full" style={{ background: t.color }} />
                {t.abbr}
              </span>
            </td>
            <td>{s.plays}</td>
            <td className={tone(s.perPlay)}>{fmt(s.perPlay)}</td>
            <td className={tone(s.pass)}>{fmt(s.pass)}</td>
            <td className={tone(s.run)}>{fmt(s.run)}</td>
            <td>{s.success === undefined ? '--' : `${Math.round(s.success * 100)}%`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
