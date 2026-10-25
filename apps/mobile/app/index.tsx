/**
 * Scoreboard: the week's games. Pinned demo and featured cards on top, then live, upcoming and
 * final. Pull to refresh; refreshes every 30 s while any game is live. Long-press the logo for
 * the hidden settings screen (API base override).
 */
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { GameCard as Card } from '@gridcast/types';
import { api } from '@/api/client';
import { apiBase } from '@/api/base';
import { GameCard } from '@/components/GameCard';
import { OddsFooter } from '@/components/Scorebug';
import { Badge, Button, Display, Label, T } from '@/components/ui';
import { usePrefs } from '@/prefs';
import { colors } from '@/theme';

const LIVE_REFRESH_MS = 30_000;

function Group({ title, games }: { title: string; games: Card[] }) {
  if (!games.length) return null;
  return (
    <View style={{ gap: 10 }}>
      <Label>{title}</Label>
      {games.map((g) => (
        <GameCard key={g.id} g={g} />
      ))}
    </View>
  );
}

export default function Scoreboard() {
  const insets = useSafeAreaInsets();
  const [week, setWeek] = useState<number | undefined>(undefined);
  // Re-query when the server override changes in settings.
  const base = usePrefs((p) => p.apiBase);
  const q = useQuery({
    queryKey: ['scoreboard', week, base],
    queryFn: () => api.scoreboard(undefined, week),
    refetchInterval: (query) =>
      query.state.data?.games.some((g) => g.status === 'live') ? LIVE_REFRESH_MS : false,
  });
  const data = q.data;
  const current = week ?? data?.week;
  const games = data?.games ?? [];
  const pinned = games
    .filter((g) => g.demo || g.featured)
    .sort((a, b) => Number(!!b.demo) - Number(!!a.demo));
  const rest = games.filter((g) => !g.demo && !g.featured);
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{
        paddingTop: insets.top + 12,
        paddingBottom: insets.bottom + 12,
        paddingLeft: insets.left + 16,
        paddingRight: insets.right + 16,
        gap: 22,
      }}
      refreshControl={
        <RefreshControl
          refreshing={q.isRefetching}
          onRefresh={() => void q.refetch()}
          tintColor={colors.text}
        />
      }
    >
      <View style={s.header}>
        <Pressable
          onLongPress={() => router.push('/settings')}
          delayLongPress={600}
          accessibilityRole="header"
          accessibilityHint="Long press for settings"
        >
          <Display size={44}>GRIDCAST</Display>
          <T size={13} muted>
            Every NFL play, animated and explained.
          </T>
        </Pressable>
      </View>
      <View style={s.week} accessibilityLabel="Week picker">
        <Button
          icon="chevron-left"
          variant="ghost"
          disabled={!current || current <= 1}
          onPress={() => setWeek((current ?? 2) - 1)}
          accessibilityLabel="Previous week"
        />
        <T size={15} weight="semibold" num style={{ minWidth: 80, textAlign: 'center' }}>
          Week {current ?? '-'}
        </T>
        <Button
          icon="chevron-right"
          variant="ghost"
          disabled={!current || current >= 18}
          onPress={() => setWeek((current ?? 0) + 1)}
          accessibilityLabel="Next week"
        />
        {week !== undefined && (
          <Button label="This week" size="sm" variant="ghost" onPress={() => setWeek(undefined)} />
        )}
      </View>
      {data?.dataSource === 'fixture' && (
        <Badge label="Live feed unavailable: showing saved data" tone="stale" />
      )}
      {q.isLoading && <T muted>Loading scoreboard...</T>}
      {q.isError && (
        <View style={{ gap: 10 }}>
          <T color={colors.negative}>Could not reach the Gridcast server.</T>
          <T size={12} muted>
            {apiBase()}
          </T>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button label="Retry" icon="refresh-cw" onPress={() => void q.refetch()} />
            <Button
              label="Server settings"
              icon="settings"
              onPress={() => router.push('/settings')}
            />
          </View>
        </View>
      )}
      <Group title="Featured" games={pinned} />
      <Group title="Live" games={rest.filter((g) => g.status === 'live')} />
      <Group title="Upcoming" games={rest.filter((g) => g.status === 'pre')} />
      <Group title="Final" games={rest.filter((g) => g.status === 'final')} />
      {data && !games.length && <T muted>No games this week.</T>}
      <OddsFooter />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  week: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
