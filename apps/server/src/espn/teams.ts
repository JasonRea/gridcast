import {
  matchupColors,
  normalizeAbbr,
  teamColors,
  type EspnCompetition,
  type EspnCompetitor,
  type TeamInfo,
} from '@gridcast/types';

function record(c: EspnCompetitor): string | undefined {
  if (typeof c.record === 'string') return c.record;
  const list = Array.isArray(c.record) ? c.record : c.records;
  return list?.find((r) => !r.type || r.type === 'total')?.summary ?? list?.[0]?.summary;
}

export function teamInfo(c: EspnCompetitor): TeamInfo {
  const abbr = normalizeAbbr(c.team.abbreviation ?? c.team.id);
  const colors = teamColors(abbr, {
    ...(c.team.color ? { color: c.team.color } : {}),
    ...(c.team.alternateColor ? { alternateColor: c.team.alternateColor } : {}),
  });
  const logo = c.team.logo ?? c.team.logos?.[0]?.href;
  const rec = record(c);
  return {
    id: c.team.id,
    abbr,
    name: c.team.displayName ?? abbr,
    shortName: c.team.shortDisplayName ?? c.team.name ?? abbr,
    color: colors.display,
    numberColor: colors.number,
    ...(logo ? { logo } : {}),
    ...(rec ? { record: rec } : {}),
  };
}

/** Home and away TeamInfo for a competition, with display colors de-clashed. */
export function matchupTeams(
  comp: EspnCompetition,
): { home: TeamInfo; away: TeamInfo } | undefined {
  const h = comp.competitors.find((c) => c.homeAway === 'home');
  const a = comp.competitors.find((c) => c.homeAway === 'away');
  if (!h || !a) return undefined;
  const home = teamInfo(h);
  const away = teamInfo(a);
  const m = matchupColors(
    { official: [home.color], display: home.color, number: home.numberColor },
    { ...teamColors(away.abbr), display: away.color, number: away.numberColor },
  );
  return { home, away: { ...away, color: m.away.display, numberColor: m.away.number } };
}
