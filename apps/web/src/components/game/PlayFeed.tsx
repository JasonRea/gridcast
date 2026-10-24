import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import type { Clip, PlayEvent, TeamInfo } from '@gridcast/types';
import { ClipEmbed } from './ClipEmbed';
import type { Lines } from '@/store/game';
import { clockLabel, periodLabel } from '@/lib/format';
import { cn } from '@/lib/utils';

function stripClock(text: string) {
  return text.replace(/^\(\s*\d{0,2}:\d{2}\s*\)\s*/, '');
}

export type FeedFilter = 'all' | 'scoring' | 'big' | 'turnovers' | 'penalties';

const FILTERS: { key: FeedFilter; label: string; test: (p: PlayEvent) => boolean }[] = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'scoring', label: 'Scoring', test: (p) => !!p.parsed.points },
  { key: 'big', label: 'Big plays', test: (p) => !!p.big },
  {
    key: 'turnovers',
    label: 'Turnovers',
    test: (p) => p.parsed.result === 'interception' || p.parsed.result === 'fumble',
  },
  {
    key: 'penalties',
    label: 'Penalties',
    test: (p) => p.parsed.type === 'penalty' || !!p.parsed.penalty?.accepted,
  },
];

export function filterPlays(plays: PlayEvent[], filter: FeedFilter, team?: string) {
  const f = FILTERS.find((x) => x.key === filter) ?? FILTERS[0]!;
  return plays
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => f.test(p) && (!team || p.pre.possession === team));
}

/** Right rail: newest play first, raw text always visible, commentary under it. */
export function PlayFeed({
  plays,
  commentary,
  deltas,
  teams,
  currentId,
  onSelect,
  showEpa = false,
  clips = {},
}: {
  plays: PlayEvent[];
  commentary: Record<string, Lines>;
  deltas: Record<string, Lines>;
  teams: { home: TeamInfo; away: TeamInfo };
  currentId?: string;
  onSelect: (index: number) => void;
  showEpa?: boolean;
  clips?: Record<string, Clip[]>;
}) {
  const [filter, setFilter] = useState<FeedFilter>('all');
  const [team, setTeam] = useState<string | undefined>();
  const rows = filterPlays(plays, filter, team).reverse();
  const chip = (active: boolean) =>
    cn(
      'h-7 shrink-0 rounded-md px-2.5 text-xs font-semibold num',
      active ? 'bg-white text-black' : 'bg-secondary text-muted-foreground hover:text-foreground',
    );
  return (
    <div className="flex flex-col gap-2">
      <div
        className="sticky top-0 z-10 flex flex-col gap-2 bg-background pb-2"
        aria-label="Filter plays"
      >
        <div className="flex gap-1.5 overflow-x-auto" role="tablist">
          {FILTERS.map((f) => {
            const count = filterPlays(plays, f.key, team).length;
            return (
              <button
                key={f.key}
                role="tab"
                aria-selected={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={chip(filter === f.key)}
              >
                {f.label}
                {f.key !== 'all' && <span className="ml-1 opacity-60">{count}</span>}
              </button>
            );
          })}
        </div>
        <div className="flex gap-1.5" role="group" aria-label="Filter by team">
          <button onClick={() => setTeam(undefined)} className={chip(!team)}>
            Both teams
          </button>
          {[teams.away, teams.home].map((t) => (
            <button
              key={t.abbr}
              onClick={() => setTeam(team === t.abbr ? undefined : t.abbr)}
              className={cn(chip(team === t.abbr), 'inline-flex items-center gap-1.5')}
            >
              <span className="size-2 rounded-full" style={{ background: t.color }} />
              {t.abbr}
            </button>
          ))}
        </div>
      </div>
      <ol className="flex flex-col gap-2" aria-label="Play by play">
        <AnimatePresence initial={false}>
          {rows.slice(0, 120).map(({ p, i }) => {
            const team = p.pre.possession === teams.home.abbr ? teams.home : teams.away;
            const lines = { ...deltas[p.id], ...commentary[p.id] };
            const chipTone = p.parsed.points
              ? 'text-positive'
              : p.parsed.result === 'interception' || p.parsed.result === 'fumble'
                ? 'text-negative'
                : 'text-muted-foreground';
            return (
              <motion.li
                key={p.id}
                layout="position"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
              >
                <button
                  onClick={() => onSelect(i)}
                  className={cn(
                    'w-full rounded-md bg-card p-3 text-left transition-colors hover:bg-secondary',
                    p.id === currentId && 'bg-secondary',
                  )}
                >
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground num">
                    <span className="size-2 rounded-full" style={{ background: team.color }} />
                    <span>
                      {periodLabel(p.pre.quarter)} {clockLabel(p.pre.clock)}
                    </span>
                    {showEpa && p.epa !== undefined && (
                      <span
                        className={cn(
                          'rounded-sm px-1 font-semibold',
                          p.epa >= 0
                            ? 'bg-positive/15 text-positive'
                            : 'bg-negative/15 text-negative',
                        )}
                        title="Expected points added"
                      >
                        EPA {p.epa > 0 ? '+' : ''}
                        {p.epa.toFixed(1)}
                      </span>
                    )}
                    {p.fourthDown?.call && (
                      <span
                        className={cn(
                          'rounded-sm px-1 font-semibold',
                          (p.fourthDown.delta ?? 0) < 0.1 ? 'text-positive' : 'text-negative',
                        )}
                      >
                        {(p.fourthDown.delta ?? 0) < 0.1
                          ? 'Bot agrees'
                          : `Bot: -${p.fourthDown.delta?.toFixed(1)} EP`}
                      </span>
                    )}
                    {p.big && (
                      <span className="font-semibold uppercase tracking-wide text-foreground">
                        Big play
                      </span>
                    )}
                    <span className={cn('ml-auto font-semibold uppercase', chipTone)}>
                      {p.parsed.points
                        ? `+${p.parsed.points}`
                        : p.parsed.type === 'penalty'
                          ? 'Flag'
                          : `${p.parsed.yards > 0 ? '+' : ''}${p.parsed.yards} yds`}
                    </span>
                  </div>
                  {lines.pbp && (
                    <p className="mt-1.5 text-sm font-medium leading-snug">{lines.pbp}</p>
                  )}
                  {lines.color && (
                    <p className="mt-1 text-sm leading-snug text-muted-foreground">{lines.color}</p>
                  )}
                  <p
                    className={cn(
                      'mt-1.5 text-xs leading-snug text-muted-foreground',
                      !lines.pbp && 'text-sm text-foreground',
                    )}
                  >
                    {stripClock(p.raw.text)}
                  </p>
                </button>
                {clips[p.id]?.[0] && <ClipEmbed clip={clips[p.id]![0]!} />}
              </motion.li>
            );
          })}
        </AnimatePresence>
        {plays.length > 0 && !rows.length && (
          <li className="rounded-md bg-card p-4 text-sm text-muted-foreground">
            No plays match this filter yet.
          </li>
        )}
        {!plays.length && (
          <li className="rounded-md bg-card p-4 text-sm text-muted-foreground">
            Waiting for the first play.
          </li>
        )}
      </ol>
    </div>
  );
}
