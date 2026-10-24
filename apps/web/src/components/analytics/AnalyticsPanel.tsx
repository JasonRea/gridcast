import { useState } from 'react';
import type { OddsTick, PlayEvent, TeamInfo } from '@gridcast/types';
import { cn } from '@/lib/utils';
import { FourthDownPanel } from './FourthDownPanel';
import { OddsChart } from './OddsChart';
import { TeamEpa } from './TeamEpa';

type Tab = 'odds' | 'fourth' | 'epa';

/** Odds and analytics sheet: odds vs model chart, 4th-down bot, team EPA (each behind a flag). */
export function AnalyticsPanel({
  plays,
  odds,
  teams,
  features,
  onSelect,
}: {
  plays: PlayEvent[];
  odds: OddsTick[];
  teams: { home: TeamInfo; away: TeamInfo };
  features: Record<string, boolean>;
  onSelect: (index: number) => void;
}) {
  const tabs = (
    [
      ['odds', 'Odds vs model', features.oddsChart],
      ['fourth', '4th-down bot', features.fourthDown],
      ['epa', 'Team EPA', features.epa],
    ] as [Tab, string, boolean | undefined][]
  ).filter(([, , on]) => on);
  const [tab, setTab] = useState<Tab>(tabs[0]?.[0] ?? 'odds');
  if (!tabs.length) return null;
  return (
    <section className="flex flex-col gap-3 rounded-md bg-card p-4" aria-label="Odds and analytics">
      <div className="flex gap-1" role="tablist">
        {tabs.map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cn(
              'h-8 rounded-md px-3 text-xs font-semibold',
              tab === k
                ? 'bg-white text-black'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'odds' && <OddsChart plays={plays} odds={odds} teams={teams} onSelect={onSelect} />}
      {tab === 'fourth' && <FourthDownPanel plays={plays} teams={teams} />}
      {tab === 'epa' && <TeamEpa plays={plays} teams={teams} />}
    </section>
  );
}
