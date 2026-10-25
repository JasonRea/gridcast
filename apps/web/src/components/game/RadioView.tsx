import type { GameState, PlayEvent, TeamInfo } from '@gridcast/types';
import type { Lines } from '@/store/game';
import { ballOn, clockLabel, downDistance, pct, periodLabel } from '@/lib/format';

/**
 * Radio mode: high-contrast, large-text view of the game for low vision, small phones and
 * across-the-room reading. Same data as the field; no animation.
 */
export function RadioView({
  teams,
  state,
  play,
  lines,
  homeWp,
}: {
  teams: { home: TeamInfo; away: TeamInfo };
  state: GameState | undefined;
  play: PlayEvent | undefined;
  lines: Lines | undefined;
  homeWp: number | undefined;
}) {
  const { home, away } = teams;
  const other = state ? (state.possession === home.abbr ? away.abbr : home.abbr) : '';
  const raw = play?.raw.text.replace(/^\(\s*\d{0,2}:\d{2}\s*\)\s*/, '');
  return (
    <section
      className="flex flex-col gap-6 rounded-md bg-black p-5 text-white outline outline-2 outline-white sm:p-8"
      aria-label="Radio mode"
    >
      <div className="flex items-end justify-between gap-4">
        {[away, home].map((t) => (
          <div key={t.abbr} className={t === home ? 'text-right' : ''}>
            <div className="display text-3xl sm:text-5xl" style={{ color: t.color }}>
              {t.abbr}
            </div>
            <div className="display text-6xl leading-none num sm:text-8xl">
              {state ? (t === home ? state.home : state.away) : 0}
            </div>
          </div>
        ))}
      </div>
      {state && (
        <p className="text-2xl font-semibold num sm:text-4xl">
          {periodLabel(state.quarter)} {clockLabel(state.clock)}
          {state.down ? ` · ${downDistance(state)} at ${ballOn(state, other)}` : ''}
          {state.down ? ` · ${state.possession} ball` : ''}
        </p>
      )}
      <div className="flex flex-col gap-3">
        <p className="text-3xl leading-tight font-semibold sm:text-5xl">
          {lines?.pbp ?? raw ?? 'Waiting for the first play.'}
        </p>
        {lines?.color && <p className="text-2xl leading-snug sm:text-3xl">{lines.color}</p>}
        {lines?.pbp && raw && <p className="text-lg leading-snug sm:text-xl">{raw}</p>}
      </div>
      {homeWp !== undefined && (
        <p className="text-xl num sm:text-2xl">
          Win probability: {away.abbr} {pct(1 - homeWp)}, {home.abbr} {pct(homeWp)}
        </p>
      )}
    </section>
  );
}
