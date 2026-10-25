/**
 * Play feed (port of apps/web/src/components/game/PlayFeed.tsx): newest first, commentary under
 * each play (live `delta` text while it streams), big-play badge, EPA chip, 4th-down bot verdict,
 * filters. Tap a play to replay its animation.
 */
import { Feather } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { memo, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { Clip, PlayEvent, TeamInfo } from '@gridcast/types';
import { clockLabel, periodLabel } from '@web/lib/format';
import type { Lines } from '@/store/game';
import { colors, radius } from '@/theme';
import { T, TeamDot } from './ui';

export function stripClock(text: string) {
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

/** Scores go to the team whose score went up (a pick-six counts for the defense). */
function playTeam(p: PlayEvent, teams: { home: string; away: string }): string {
  if (p.parsed.points) {
    if (p.state.home > p.pre.home) return teams.home;
    if (p.state.away > p.pre.away) return teams.away;
  }
  return p.pre.possession;
}

const MAX_ROWS = 120;

type RowProps = {
  p: PlayEvent;
  team: TeamInfo;
  lines: Lines;
  current: boolean;
  showEpa: boolean;
  clip: Clip | undefined;
  onPress: () => void;
};

/** Rows re-render only when their own text changes (deltas stream several times a second). */
function sameRow(a: RowProps, b: RowProps): boolean {
  return (
    a.p === b.p &&
    a.team === b.team &&
    a.lines.pbp === b.lines.pbp &&
    a.lines.color === b.lines.color &&
    a.current === b.current &&
    a.showEpa === b.showEpa &&
    a.clip === b.clip
  );
}

const Row = memo(function Row({ p, team, lines, current, showEpa, clip, onPress }: RowProps) {
  const result = p.parsed.points
    ? `+${p.parsed.points}`
    : p.parsed.type === 'penalty'
      ? 'Flag'
      : `${p.parsed.yards > 0 ? '+' : ''}${p.parsed.yards} yds`;
  const tone = p.parsed.points
    ? colors.positive
    : p.parsed.result === 'interception' || p.parsed.result === 'fumble'
      ? colors.negative
      : colors.muted;
  const fd = p.fourthDown;
  const agrees = (fd?.delta ?? 0) < 0.1;
  return (
    <View>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityHint="Replays this play on the field"
        style={({ pressed }) => [s.row, (current || pressed) && { backgroundColor: colors.raised }]}
      >
        <View style={s.meta}>
          <TeamDot color={team.color} />
          <T size={11} muted num>
            {periodLabel(p.pre.quarter)} {clockLabel(p.pre.clock)}
          </T>
          {showEpa && p.epa !== undefined && (
            <View
              style={[
                s.chip,
                { backgroundColor: `${p.epa >= 0 ? colors.positive : colors.negative}26` },
              ]}
            >
              <T
                size={11}
                weight="semibold"
                num
                color={p.epa >= 0 ? colors.positive : colors.negative}
              >
                EPA {p.epa > 0 ? '+' : ''}
                {p.epa.toFixed(1)}
              </T>
            </View>
          )}
          {fd?.call && (
            <T size={11} weight="semibold" color={agrees ? colors.positive : colors.negative}>
              {agrees ? 'Bot agrees' : `Bot: -${fd.delta?.toFixed(1)} EP`}
            </T>
          )}
          {p.big && (
            <T size={11} weight="semibold" upper>
              Big play
            </T>
          )}
          <T size={11} weight="semibold" upper num color={tone} style={{ marginLeft: 'auto' }}>
            {result}
          </T>
        </View>
        {lines.pbp ? (
          <T size={14} weight="medium" style={{ marginTop: 6 }}>
            {lines.pbp}
          </T>
        ) : null}
        {lines.color ? (
          <T size={14} muted style={{ marginTop: 4 }}>
            {lines.color}
          </T>
        ) : null}
        <T size={lines.pbp ? 12 : 14} muted={!!lines.pbp} style={{ marginTop: 6 }}>
          {stripClock(p.raw.text)}
        </T>
      </Pressable>
      {clip && (
        <Pressable
          accessibilityRole="link"
          onPress={() => void WebBrowser.openBrowserAsync(clip.url)}
          style={s.clip}
        >
          <Feather name="play-circle" size={14} color={colors.text} />
          <T size={12} weight="semibold">
            Watch the clip on X
          </T>
        </Pressable>
      )}
    </View>
  );
}, sameRow);

export function PlayFeed({
  plays,
  commentary,
  deltas,
  teams,
  currentId,
  onSelect,
  showEpa = false,
  clips = {},
  showClips = false,
}: {
  plays: PlayEvent[];
  commentary: Record<string, Lines>;
  deltas: Record<string, Lines>;
  teams: { home: TeamInfo; away: TeamInfo };
  currentId?: string | undefined;
  onSelect: (index: number) => void;
  showEpa?: boolean;
  clips?: Record<string, Clip[]>;
  showClips?: boolean;
}) {
  const [filter, setFilter] = useState<FeedFilter>('all');
  const [team, setTeam] = useState<string | undefined>();
  const abbrs = useMemo(
    () => ({ home: teams.home.abbr, away: teams.away.abbr }),
    [teams.home.abbr, teams.away.abbr],
  );
  const rows = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter) ?? FILTERS[0]!;
    return plays
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => f.test(p) && (!team || playTeam(p, abbrs) === team))
      .reverse()
      .slice(0, MAX_ROWS);
  }, [plays, filter, team, abbrs]);
  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.key, plays.filter((p) => f.test(p)).length])),
    [plays],
  );
  const chip = (on: boolean) => [s.filter, on && { backgroundColor: colors.text }];
  return (
    <View style={{ gap: 8 }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 6 }}
      >
        {FILTERS.map((f) => (
          <Pressable
            key={f.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: filter === f.key }}
            onPress={() => setFilter(f.key)}
            style={chip(filter === f.key)}
          >
            <T
              size={12}
              weight="semibold"
              num
              color={filter === f.key ? colors.background : colors.muted}
            >
              {f.label}
              {f.key !== 'all' ? `  ${counts[f.key] ?? 0}` : ''}
            </T>
          </Pressable>
        ))}
        {[teams.away, teams.home].map((t) => (
          <Pressable
            key={t.abbr}
            accessibilityRole="button"
            accessibilityState={{ selected: team === t.abbr }}
            accessibilityLabel={`Only ${t.shortName} plays`}
            onPress={() => setTeam(team === t.abbr ? undefined : t.abbr)}
            style={[chip(team === t.abbr), { flexDirection: 'row', alignItems: 'center', gap: 6 }]}
          >
            <TeamDot color={t.color} />
            <T
              size={12}
              weight="semibold"
              color={team === t.abbr ? colors.background : colors.muted}
            >
              {t.abbr}
            </T>
          </Pressable>
        ))}
      </ScrollView>
      {rows.map(({ p, i }) => (
        <Row
          key={p.id}
          p={p}
          team={p.pre.possession === teams.home.abbr ? teams.home : teams.away}
          lines={{ ...deltas[p.id], ...commentary[p.id] }}
          current={p.id === currentId}
          showEpa={showEpa}
          clip={showClips ? clips[p.id]?.[0] : undefined}
          onPress={() => onSelect(i)}
        />
      ))}
      {plays.length > 0 && !rows.length && (
        <View style={s.row}>
          <T size={14} muted>
            No plays match this filter yet.
          </T>
        </View>
      )}
      {!plays.length && (
        <View style={s.row}>
          <T size={14} muted>
            Waiting for the first play.
          </T>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  row: { backgroundColor: colors.surface, borderRadius: radius.md, padding: 12 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  chip: { paddingHorizontal: 4, borderRadius: radius.sm },
  filter: {
    height: 30,
    paddingHorizontal: 11,
    borderRadius: radius.md,
    backgroundColor: colors.raised,
    justifyContent: 'center',
  },
  clip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: colors.raised,
    alignSelf: 'flex-start',
  },
});
