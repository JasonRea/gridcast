import { useEffect, useState } from 'react';
import type { GameDetail, TeamInfo } from '@gridcast/types';
import { TeamMark } from '@/components/TeamMark';
import { WpBar } from '@/components/WpBar';
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

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-md bg-card p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function teamOf(abbr: string, d: GameDetail): TeamInfo {
  return abbr === d.home.abbr ? d.home : d.away;
}

/** Upcoming game. The page polls the server and switches to the live view at kickoff. */
export function Preview({ detail }: { detail: GameDetail }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const kickoff = Date.parse(detail.kickoff);
  const p = detail.features.preview ? detail.preview : undefined;
  const pregameWp = detail.kalshiHomeProb ?? p?.predictorHome;
  return (
    <div className="flex flex-col gap-4">
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
        {pregameWp !== undefined && (
          <div className="w-full max-w-md">
            <WpBar
              home={detail.home}
              away={detail.away}
              homeProb={pregameWp}
              {...(detail.kalshiHomeProb !== undefined
                ? { kalshiHome: detail.kalshiHomeProb }
                : {})}
            />
          </div>
        )}
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
      {p && (
        <div className="grid gap-4 md:grid-cols-2">
          {p.storylines.length > 0 && (
            <Panel title="Storylines">
              <ul className="flex flex-col gap-2 text-sm">
                {p.storylines.map((s) => (
                  <li key={s} className="leading-snug">
                    {s}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {p.leaders.length > 0 && (
            <Panel title="Team leaders">
              <ul className="flex flex-col gap-2 text-sm">
                {p.leaders.map((l) => (
                  <li key={`${l.team}${l.category}`} className="flex items-center gap-2">
                    <span
                      className="size-2 rounded-full"
                      style={{ background: teamOf(l.team, detail).color }}
                    />
                    <span className="w-28 shrink-0 text-muted-foreground">{l.category}</span>
                    <span className="font-medium">{l.name}</span>
                    <span className="ml-auto text-muted-foreground num">{l.value}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {p.injuries.some((i) => i.players.length) && (
            <Panel title="Injuries">
              {p.injuries.map((i) => (
                <div key={i.team} className="flex flex-col gap-1 text-sm">
                  <span className="font-semibold">{i.team}</span>
                  {i.players.map((pl) => (
                    <span key={pl.name} className="flex gap-2 text-muted-foreground">
                      <span className="text-foreground">{pl.name}</span>
                      {pl.position && <span>{pl.position}</span>}
                      <span className="ml-auto">{pl.status}</span>
                    </span>
                  ))}
                </div>
              ))}
            </Panel>
          )}
          {p.comparison.length > 0 && (
            <Panel title="Stat comparison">
              <table className="w-full text-sm num">
                <thead>
                  <tr className="text-[11px] uppercase text-muted-foreground">
                    <th className="text-left font-medium">{detail.away.abbr}</th>
                    <th />
                    <th className="text-right font-medium">{detail.home.abbr}</th>
                  </tr>
                </thead>
                <tbody>
                  {p.comparison.map((c) => (
                    <tr key={c.label}>
                      <td className="py-1">{c.away}</td>
                      <td className="py-1 text-center text-muted-foreground">{c.label}</td>
                      <td className="py-1 text-right">{c.home}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}
