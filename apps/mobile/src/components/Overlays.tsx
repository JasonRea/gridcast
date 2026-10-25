/** Cards that float over the field: why play stopped, and big win-probability swings. */
import { Feather } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import type { PlayEvent, StoppageEvent, TeamInfo } from '@gridcast/types';
import type { Lines } from '@/store/game';
import { colors, radius } from '@/theme';
import { Display, T, type IconName } from './ui';

const ICON: Record<StoppageEvent['reason'], IconName> = {
  timeout: 'clock',
  injury: 'activity',
  review: 'video',
  penalty: 'flag',
  quarter_end: 'bell',
  two_minute: 'clock',
  halftime: 'bell',
};

function useFade(key: string | undefined) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!key) return;
    a.setValue(0);
    Animated.timing(a, { toValue: 1, duration: 250, useNativeDriver: true }).start();
  }, [a, key]);
  return {
    opacity: a,
    transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
  };
}

/** Timing (hold and TTL) lives in the shared store; this only draws `card`. */
export function StoppageCard({
  card,
  teams,
  lines,
}: {
  card: StoppageEvent | undefined;
  teams: { home: TeamInfo; away: TeamInfo };
  lines?: Lines | undefined;
}) {
  const style = useFade(card?.id);
  if (!card) return null;
  const team =
    card.team === teams.home.abbr
      ? teams.home
      : card.team === teams.away.abbr
        ? teams.away
        : undefined;
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={[s.card, s.bottom, style]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Feather
          name={ICON[card.reason]}
          size={14}
          color={team?.color ?? (card.reason === 'penalty' ? colors.firstDown : colors.text)}
        />
        <T size={11} weight="semibold" upper>
          {card.title ?? card.reason.replace('_', ' ')}
        </T>
      </View>
      <T size={13} style={{ marginTop: 4 }}>
        {card.detail}
      </T>
      {lines?.color ? (
        <T size={13} muted style={{ marginTop: 4 }}>
          {lines.color}
        </T>
      ) : null}
    </Animated.View>
  );
}

/** "Steelers 48% to 61%": shown after a play moves win probability 5+ points. */
export function SwingCallout({
  play,
  teams,
}: {
  play: PlayEvent | undefined;
  teams: { home: TeamInfo; away: TeamInfo };
}) {
  const [shown, setShown] = useState<PlayEvent | undefined>();
  useEffect(() => {
    if (!play || play.wpBefore === undefined || play.wpAfter === undefined) return;
    if (Math.abs(play.wpAfter - play.wpBefore) < 0.05) return;
    setShown(play);
    const t = setTimeout(() => setShown(undefined), 4500);
    return () => clearTimeout(t);
  }, [play]);
  const style = useFade(shown?.id);
  const p = shown;
  if (!p || p.wpBefore === undefined || p.wpAfter === undefined) return null;
  const team = p.wpAfter >= p.wpBefore ? teams.home : teams.away;
  const f = (x: number) => Math.round((team === teams.home ? x : 1 - x) * 100);
  return (
    <Animated.View pointerEvents="none" style={[s.card, s.top, style]}>
      <T size={10} muted upper>
        Win probability swing
      </T>
      <Display size={20}>
        <Display size={20} color={team.color}>
          {team.shortName}
        </Display>{' '}
        {f(p.wpBefore)}%{' '}
        <Display size={20} color={colors.muted}>
          to
        </Display>{' '}
        {f(p.wpAfter)}%
      </Display>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  card: {
    position: 'absolute',
    backgroundColor: 'rgba(26,26,26,0.95)',
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    maxWidth: 420,
  },
  bottom: { left: 8, right: 8, bottom: 8, alignSelf: 'center' },
  top: { left: 8, top: 8 },
});
