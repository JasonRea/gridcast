import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import type { GameCard as Card } from '@gridcast/types';
import { kickoffLabel, pct } from '@web/lib/format';
import { colors, radius } from '@/theme';
import { Badge, Display, T } from './ui';

function Row({
  team,
  score,
  ball,
  winner,
}: {
  team: Card['home'];
  score?: number;
  ball?: boolean;
  winner?: boolean;
}) {
  const dim = winner === false;
  return (
    <View style={s.row}>
      <View style={{ width: 4, height: 22, borderRadius: 2, backgroundColor: team.color }} />
      <T size={15} weight="semibold" muted={dim}>
        {team.abbr}
      </T>
      <T size={13} muted numberOfLines={1} style={{ flexShrink: 1 }}>
        {team.shortName}
      </T>
      {ball && <View style={s.ball} accessibilityLabel="Has the ball" />}
      <Display size={24} color={dim ? colors.muted : colors.text} style={{ marginLeft: 'auto' }}>
        {score ?? ''}
      </Display>
    </View>
  );
}

export function GameCard({ g }: { g: Card }) {
  const final = g.status === 'final';
  const hs = g.home.score ?? 0;
  const as = g.away.score ?? 0;
  const prob = g.homeWinProb ?? g.kalshiHomeProb;
  const label = `${g.away.shortName} at ${g.home.shortName}, ${g.status === 'pre' ? kickoffLabel(g.kickoff) : g.detail}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => router.push({ pathname: '/game/[id]', params: { id: g.id } })}
      style={({ pressed }) => [s.card, pressed && { backgroundColor: colors.raised }]}
    >
      <View style={s.head}>
        {g.status === 'live' && <Badge label="Live" tone="live" dot />}
        {g.featured && <Badge label="Featured" />}
        {g.demo && <Badge label="Demo replay" />}
        <T size={12} muted num numberOfLines={1} style={{ flexShrink: 1 }}>
          {g.status === 'pre' ? kickoffLabel(g.kickoff) : g.detail}
        </T>
        {g.tv ? (
          <T size={12} muted style={{ marginLeft: 'auto' }}>
            {g.tv}
          </T>
        ) : null}
      </View>
      <Row
        team={g.away}
        {...(g.status !== 'pre' ? { score: as } : {})}
        ball={g.possession === g.away.abbr}
        {...(final ? { winner: as > hs } : {})}
      />
      <Row
        team={g.home}
        {...(g.status !== 'pre' ? { score: hs } : {})}
        ball={g.possession === g.home.abbr}
        {...(final ? { winner: hs > as } : {})}
      />
      {g.status === 'live' && g.downDistance ? (
        <T size={12} muted>
          {g.downDistance}
        </T>
      ) : null}
      {g.status === 'live' && prob !== undefined && (
        <View style={s.wp}>
          <View style={{ width: `${(1 - prob) * 100}%`, backgroundColor: g.away.color }} />
          <View style={{ flex: 1, backgroundColor: g.home.color }} />
        </View>
      )}
      <View style={s.foot}>
        {g.status === 'pre' && g.spread ? (
          <T size={12} muted num>
            {g.spread}
          </T>
        ) : null}
        {g.status === 'pre' && g.total !== undefined ? (
          <T size={12} muted num>
            O/U {g.total}
          </T>
        ) : null}
        {g.status === 'live' && prob !== undefined ? (
          <T size={12} muted num>
            {g.homeWinProb !== undefined ? 'Win prob' : 'Market'} {g.home.abbr} {pct(prob)}
          </T>
        ) : g.kalshiHomeProb !== undefined ? (
          <T size={12} muted num>
            Market {g.home.abbr} {pct(g.kalshiHomeProb)}
          </T>
        ) : null}
        {final && g.topPerformer ? (
          <T size={12} muted numberOfLines={1} style={{ flexShrink: 1 }}>
            {g.topPerformer}
          </T>
        ) : null}
        {final && (
          <T size={12} weight="semibold" style={{ marginLeft: 'auto' }}>
            Watch replay
          </T>
        )}
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: 14, gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ball: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.text },
  wp: {
    flexDirection: 'row',
    height: 5,
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: colors.raised,
  },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
