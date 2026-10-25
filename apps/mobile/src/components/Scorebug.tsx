import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import type { GameDetail, GameState, TeamInfo } from '@gridcast/types';
import { ballOn, clockLabel, downDistance, pct, periodLabel } from '@web/lib/format';
import { colors } from '@/theme';
import { Badge, Display, T } from './ui';

/** Feed freshness is stale after this long without an upstream update. */
export const STALE_AFTER_S = 60;

/** "LIVE · 12s": seconds since the last upstream update; amber when over 60 s stale. */
export function LivePill({
  source,
  lastUpdate,
  speed,
}: {
  source: 'live' | 'replay';
  lastUpdate?: number;
  speed?: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (source === 'replay')
    return <Badge label={`Replay${speed ? ` ${speed}x` : ''}`} tone="muted" />;
  const age = lastUpdate ? Math.max(0, Math.round((now - lastUpdate) / 1000)) : undefined;
  const stale = age === undefined || age > STALE_AFTER_S;
  const ageLabel =
    age === undefined ? '' : ` · ${age < 100 ? `${age}s` : `${Math.round(age / 60)}m`}`;
  return <Badge label={`Live${ageLabel}`} tone={stale ? 'stale' : 'live'} dot />;
}

/** Required on every screen that shows odds. */
export function OddsFooter() {
  return (
    <T size={11} muted style={{ textAlign: 'center', paddingVertical: 20 }}>
      Odds shown for information only. Not betting advice.
    </T>
  );
}

/**
 * Win probability bar: away share on the left, home on the right, in team colors. The market
 * win probability (Kalshi) shows beside it when available. Information only.
 */
export function WpBar({
  home,
  away,
  homeProb,
  kalshiHome,
}: {
  home: TeamInfo;
  away: TeamInfo;
  homeProb?: number;
  kalshiHome?: number;
}) {
  const h = homeProb ?? kalshiHome;
  const awayShare = h === undefined ? 0.5 : 1 - h;
  const anim = useRef(new Animated.Value(awayShare)).current;
  useEffect(() => {
    Animated.spring(anim, {
      toValue: awayShare,
      useNativeDriver: false,
      stiffness: 80,
      damping: 20,
    }).start();
  }, [anim, awayShare]);
  const width = anim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  return (
    <View
      style={{ gap: 6 }}
      accessible
      accessibilityLabel={`Win probability: ${away.abbr} ${pct(h === undefined ? undefined : 1 - h)}, ${home.abbr} ${pct(h)}`}
    >
      <View style={s.row}>
        <T size={12} muted num>
          <T size={12}>{away.abbr}</T> {pct(h === undefined ? undefined : 1 - h)}
        </T>
        <T size={10} muted upper>
          Win probability{homeProb === undefined && kalshiHome !== undefined ? ' (market)' : ''}
        </T>
        <T size={12} muted num>
          {pct(h)} <T size={12}>{home.abbr}</T>
        </T>
      </View>
      <View style={s.bar}>
        <Animated.View style={{ width, backgroundColor: away.color }} />
        <View style={{ flex: 1, backgroundColor: home.color }} />
        <View style={s.mid} />
      </View>
      {kalshiHome !== undefined && (
        <View style={s.row}>
          <T size={11} muted num>
            Market {away.abbr} {pct(1 - kalshiHome)}
          </T>
          <T size={11} muted>
            Kalshi
          </T>
          <T size={11} muted num>
            {home.abbr} {pct(kalshiHome)}
          </T>
        </View>
      )}
    </View>
  );
}

function Timeouts({ left, color }: { left: number; color: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 3 }} accessibilityLabel={`${left} timeouts left`}>
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={{
            height: 3,
            width: 10,
            borderRadius: 2,
            backgroundColor: i < left ? color : colors.border,
          }}
        />
      ))}
    </View>
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
  const right = align === 'right';
  return (
    <View style={[s.side, right && { flexDirection: 'row-reverse' }]}>
      <View style={[s.teamName, right && { flexDirection: 'row-reverse' }]}>
        <View style={{ width: 5, height: 38, borderRadius: 3, backgroundColor: team.color }} />
        <View style={{ gap: 4, alignItems: right ? 'flex-end' : 'flex-start' }}>
          <View
            style={{ flexDirection: right ? 'row-reverse' : 'row', alignItems: 'center', gap: 6 }}
          >
            <Display size={24}>{team.abbr}</Display>
            {hasBall && <View style={s.ball} accessibilityLabel="Has the ball" />}
          </View>
          {timeouts !== undefined && <Timeouts left={timeouts} color={team.color} />}
        </View>
      </View>
      <Display size={44}>{score ?? 0}</Display>
    </View>
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
  const other = state ? (state.possession === home.abbr ? away.abbr : home.abbr) : '';
  const dd = state ? downDistance(state) : '';
  const clock = state ? `${periodLabel(state.quarter)} ${clockLabel(state.clock)}` : detail.detail;
  return (
    <View style={{ gap: 8 }}>
      <View style={s.top}>
        <Side
          team={away}
          score={state?.away ?? away.score}
          hasBall={state?.possession === away.abbr}
          {...(state ? { timeouts: state.timeouts.away } : {})}
          align="left"
        />
        <View style={s.center}>
          <Display
            size={22}
            color={clockPulse ? colors.firstDown : colors.text}
            accessibilityLabel={`Clock ${clock}`}
          >
            {clock}
          </Display>
          <LivePill
            source={source}
            {...(lastUpdate !== undefined ? { lastUpdate } : {})}
            {...(speed !== undefined ? { speed } : {})}
          />
        </View>
        <Side
          team={home}
          score={state?.home ?? home.score}
          hasBall={state?.possession === home.abbr}
          {...(state ? { timeouts: state.timeouts.home } : {})}
          align="right"
        />
      </View>
      {(dd || detail.spread || detail.total !== undefined) && (
        <View style={s.meta}>
          {dd ? (
            <T size={13} weight="semibold" num>
              {dd}{' '}
              <T size={13} muted num>
                at {state ? ballOn(state, other) : ''}
              </T>
            </T>
          ) : null}
          {detail.spread ? (
            <T size={12} muted num>
              Line {detail.spread}
            </T>
          ) : null}
          {detail.total !== undefined ? (
            <T size={12} muted num>
              O/U {detail.total}
            </T>
          ) : null}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bar: {
    flexDirection: 'row',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: colors.raised,
  },
  mid: {
    position: 'absolute',
    left: '50%',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  side: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  teamName: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ball: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.text },
  center: { width: 96, alignItems: 'center', gap: 4 },
  meta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    columnGap: 14,
    rowGap: 2,
  },
});
