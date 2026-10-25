/**
 * Radio mode (port of RadioView.tsx): high-contrast, large-text view with no animation. Good for
 * low battery, low vision and across-the-room reading. Text scales with Dynamic Type.
 */
import { StyleSheet, View } from 'react-native';
import type { GameState, PlayEvent, TeamInfo } from '@gridcast/types';
import { ballOn, clockLabel, downDistance, pct, periodLabel } from '@web/lib/format';
import type { Lines } from '@/store/game';
import { colors, fonts, radius, tabular } from '@/theme';
import { stripClock } from './PlayFeed';
import { Text } from 'react-native';

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
  const raw = play ? stripClock(play.raw.text) : undefined;
  const situation = state
    ? `${periodLabel(state.quarter)} ${clockLabel(state.clock)}${
        state.down
          ? ` · ${downDistance(state)} at ${ballOn(state, other)} · ${state.possession} ball`
          : ''
      }`
    : '';
  return (
    <View style={s.box} accessibilityLabel="Radio mode">
      <View style={s.scores}>
        {[away, home].map((t) => (
          <View key={t.abbr} style={{ alignItems: t === home ? 'flex-end' : 'flex-start' }}>
            <Text style={[s.abbr, { color: t.color }]}>{t.abbr}</Text>
            <Text
              style={s.score}
              accessibilityLabel={`${t.shortName} ${state ? (t === home ? state.home : state.away) : 0}`}
            >
              {state ? (t === home ? state.home : state.away) : 0}
            </Text>
          </View>
        ))}
      </View>
      {situation ? <Text style={s.situation}>{situation}</Text> : null}
      <View style={{ gap: 12 }} accessibilityLiveRegion="polite">
        <Text style={s.call}>{lines?.pbp ?? raw ?? 'Waiting for the first play.'}</Text>
        {lines?.color ? <Text style={s.color}>{lines.color}</Text> : null}
        {lines?.pbp && raw ? <Text style={s.raw}>{raw}</Text> : null}
      </View>
      {homeWp !== undefined && (
        <Text style={s.wp}>
          Win probability: {away.abbr} {pct(1 - homeWp)}, {home.abbr} {pct(homeWp)}
        </Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  box: {
    backgroundColor: colors.background,
    borderColor: colors.text,
    borderWidth: 2,
    borderRadius: radius.md,
    padding: 18,
    gap: 20,
  },
  scores: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  abbr: { fontFamily: fonts.display, fontSize: 32 },
  score: {
    fontFamily: fonts.display,
    fontSize: 72,
    lineHeight: 74,
    color: colors.text,
    ...tabular,
  },
  situation: { fontFamily: fonts.semibold, fontSize: 22, color: colors.text, ...tabular },
  call: { fontFamily: fonts.semibold, fontSize: 28, lineHeight: 34, color: colors.text },
  color: { fontFamily: fonts.regular, fontSize: 22, lineHeight: 29, color: colors.text },
  raw: { fontFamily: fonts.regular, fontSize: 17, lineHeight: 23, color: colors.text },
  wp: { fontFamily: fonts.regular, fontSize: 19, color: colors.text, ...tabular },
});
