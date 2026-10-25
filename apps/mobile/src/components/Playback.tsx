/**
 * Playback controls and the timeline scrubber (ports of PlaybackControls.tsx and Timeline.tsx).
 * Replay-only controls (game speed, next big play, Q4, scrubber) show only for replays.
 */
import { useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import type { LoggedEvent, PlayEvent, TeamInfo } from '@gridcast/types';
import { headline, playLabel, swing } from '@web/lib/plays';
import { colors, radius } from '@/theme';
import { Button, Label, Segmented, T, TeamDot } from './ui';

export const REPLAY_SPEEDS = [1, 2, 4, 8] as const;

export function PlaybackControls({
  paused,
  onPause,
  onReplay,
  onPrev,
  onNext,
  onBig,
  onFourth,
  replay,
  streamSpeed,
  onStreamSpeed,
}: {
  paused: boolean;
  onPause: () => void;
  onReplay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onBig: () => void;
  onFourth?: () => void;
  replay: boolean;
  streamSpeed: number;
  onStreamSpeed: (s: number) => void;
}) {
  return (
    <View style={{ gap: 8 }}>
      <View style={s.row}>
        <Button icon="skip-back" onPress={onPrev} accessibilityLabel="Previous play" />
        <Button
          icon={paused ? 'play' : 'pause'}
          onPress={onPause}
          accessibilityLabel={paused ? 'Play' : 'Pause'}
          variant={paused ? 'primary' : 'secondary'}
        />
        <Button icon="skip-forward" onPress={onNext} accessibilityLabel="Next play" />
        <Button icon="rotate-ccw" onPress={onReplay} accessibilityLabel="Replay this play" />
        {replay && (
          <Button
            icon="zap"
            label="Big play"
            size="md"
            onPress={onBig}
            accessibilityLabel="Jump to next big play"
          />
        )}
        {replay && onFourth && (
          <Button label="Q4" onPress={onFourth} accessibilityLabel="Jump to the 4th quarter" />
        )}
      </View>
      {replay && (
        <View style={[s.row, { alignItems: 'center' }]}>
          <Label>Game speed</Label>
          <Segmented
            accessibilityLabel="Replay speed"
            options={REPLAY_SPEEDS.map((v) => ({ value: v as number, label: `${v}x` }))}
            value={streamSpeed}
            onChange={onStreamSpeed}
          />
        </View>
      )}
    </View>
  );
}

type PlayEntry = LoggedEvent & { event: PlayEvent };

/**
 * The whole game as a strip (one position per play), quarter breaks, big plays in team colors.
 * Drag or tap to jump; chips jump to the biggest swings.
 */
export function Timeline({
  entries,
  currentSeq,
  teams,
  onJump,
}: {
  entries: LoggedEvent[];
  currentSeq: number;
  teams: { home: TeamInfo; away: TeamInfo };
  onJump: (seq: number) => void;
}) {
  const plays = useMemo(
    () => entries.filter((e): e is PlayEntry => e.event.kind === 'play'),
    [entries],
  );
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<number | undefined>();
  const n = plays.length;
  const ref = useRef({ width, n, plays, onJump });
  ref.current = { width, n, plays, onJump };

  const idxAt = (x: number) => {
    const { width: w, n: count } = ref.current;
    if (!w || count < 2) return 0;
    return Math.max(0, Math.min(count - 1, Math.round((x / w) * (count - 1))));
  };
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 4,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => setDrag(idxAt(e.nativeEvent.locationX)),
        onPanResponderMove: (e) => setDrag(idxAt(e.nativeEvent.locationX)),
        onPanResponderRelease: (e) => {
          const i = idxAt(e.nativeEvent.locationX);
          setDrag(undefined);
          const target = ref.current.plays[i];
          if (target) ref.current.onJump(target.seq);
        },
        onPanResponderTerminate: () => setDrag(undefined),
      }),
    [],
  );

  if (n < 2) return null;
  const pos = (i: number) => (i / (n - 1)) * width;
  let currentIdx = 0;
  for (let i = 0; i < n; i++) if (plays[i]!.seq <= currentSeq) currentIdx = i;
  const shownIdx = drag ?? currentIdx;
  const color = (p: PlayEvent) =>
    p.pre.possession === teams.home.abbr ? teams.home.color : teams.away.color;
  const quarterStarts = plays.flatMap((p, i) =>
    i > 0 && p.event.pre.quarter !== plays[i - 1]!.event.pre.quarter ? [i] : [],
  );
  const big = plays
    .map((p, i) => ({ p, i, sw: Math.abs(swing(p.event)) }))
    .filter(({ p }) => p.event.big)
    .sort((a, b) => b.sw - a.sw)
    .slice(0, 8)
    .sort((a, b) => a.i - b.i);
  const shown = plays[shownIdx]!;

  return (
    <View style={{ gap: 10 }}>
      <View style={s.between}>
        <Label>Timeline</Label>
        <T size={12} muted num>
          {drag !== undefined ? `${playLabel(shown.event)} · ` : ''}Play {shownIdx + 1} of {n}
        </T>
      </View>
      <View
        style={s.track}
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Game timeline"
        accessibilityValue={{ min: 1, max: n, now: currentIdx + 1 }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          const j = e.nativeEvent.actionName === 'increment' ? currentIdx + 1 : currentIdx - 1;
          const t = plays[Math.max(0, Math.min(n - 1, j))];
          if (t) onJump(t.seq);
        }}
        {...pan.panHandlers}
      >
        <View pointerEvents="none" style={[s.fill, { width: pos(shownIdx) }]} />
        {quarterStarts.map((i) => (
          <View key={`q${i}`} pointerEvents="none" style={[s.quarter, { left: pos(i) }]} />
        ))}
        {plays.map((p, i) =>
          p.event.big ? (
            <View
              key={p.seq}
              pointerEvents="none"
              style={[s.tick, { left: pos(i) - 2, backgroundColor: color(p.event) }]}
            />
          ) : null,
        )}
        <View pointerEvents="none" style={[s.head, { left: pos(shownIdx) - 1 }]} />
      </View>
      {big.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
        >
          {big.map(({ p, i }) => (
            <Pressable
              key={p.seq}
              accessibilityRole="button"
              onPress={() => onJump(p.seq)}
              style={[s.chip, i === currentIdx && { borderColor: colors.text, borderWidth: 1 }]}
            >
              <TeamDot color={color(p.event)} />
              <T size={12} muted num>
                {playLabel(p.event)}
              </T>
              <T size={12} weight="medium">
                {headline(p.event)}
              </T>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  track: {
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.raised,
    overflow: 'hidden',
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  quarter: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  tick: { position: 'absolute', top: 10, height: 16, width: 4, borderRadius: 2 },
  head: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: colors.text },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: radius.md,
    backgroundColor: colors.raised,
  },
});
