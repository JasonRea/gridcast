/**
 * Game screen (port of apps/web/src/routes/Game.tsx): scorebug, win probability, animated field,
 * feed / analytics / radio, playback, announcers, haptics, chat, translation, room join.
 * Every P1 feature is hidden when its server flag is off.
 *
 * Portrait: scorebug and field on top, panels scroll below. Landscape: a dedicated full-screen
 * field with a compact scorebug strip (see DECISIONS.md).
 */
import { Feather } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { GameDetail, LoggedEvent } from '@gridcast/types';
import { clockLabel, periodLabel, pct } from '@web/lib/format';
import { firstPlayOfQuarter, startSeq } from '@web/lib/plays';
import { api } from '@/api/client';
import { GameStream, type ConnectionState } from '@/api/stream';
import { Announcer } from '@/audio/announcer';
import { expoSpeakers } from '@/audio/speakers';
import { AnalyticsPanel } from '@/components/Analytics';
import { ChatSheet } from '@/components/ChatSheet';
import { StoppageCard, SwingCallout } from '@/components/Overlays';
import { PlaybackControls, Timeline } from '@/components/Playback';
import { PlayFeed, stripClock } from '@/components/PlayFeed';
import { Preview } from '@/components/Preview';
import { RadioView } from '@/components/RadioView';
import { OddsFooter, Scorebug, WpBar } from '@/components/Scorebug';
import { Button, Display, Section, Segmented, T, TeamDot } from '@/components/ui';
import { FieldView } from '@/field/FieldView';
import { playHaptic } from '@/haptics';
import { findInLog, findPresented } from '@/lib/citations';
import { LANGS, type Lang } from '@/lib/langs';
import { useTranslations } from '@/lib/useTranslations';
import { usePrefs } from '@/prefs';
import { useGame, type Lines } from '@/store/game';
import { colors, radius } from '@/theme';

const DEFAULT_REPLAY_SPEED = 2;
/** SVG viewBox aspect ratio (1212 x 545). */
const FIELD_ASPECT = 1212 / 545;
const ROOM_POLL_MS = 10_000;

type Panel = 'feed' | 'analytics' | 'radio';

function OfflineBanner({ state }: { state: ConnectionState }) {
  if (state !== 'offline') return null;
  return (
    <View style={s.offline} accessibilityLiveRegion="polite" accessibilityRole="alert">
      <Feather name="wifi-off" size={14} color={colors.background} />
      <T size={12} weight="semibold" color={colors.background}>
        Can't reach Gridcast. Reconnecting...
      </T>
    </View>
  );
}

function LiveGame({ detail, from, room }: { detail: GameDetail; from?: string; room: boolean }) {
  const g = useGame();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const prefs = usePrefs();
  const features = detail.features;
  const streamRef = useRef<GameStream | null>(null);
  const [replaySpeed, setReplaySpeed] = useState(DEFAULT_REPLAY_SPEED);
  const [conn, setConn] = useState<ConnectionState>('connecting');
  const [joined, setJoined] = useState(room);
  const [panel, setPanel] = useState<Panel>(prefs.radio ? 'radio' : 'feed');
  const [chatOpen, setChatOpen] = useState(false);

  const joinRoom = useCallback(async (): Promise<boolean> => {
    const s = streamRef.current;
    if (!s) return false;
    const r = await api.room(detail.id).catch(() => undefined);
    if (r?.seq === undefined) return false;
    setReplaySpeed(r.speed);
    useGame.getState().setStreamSpeed(r.speed);
    await s.start({ from: r.seq, speed: r.speed, source: 'replay' });
    return true;
  }, [detail.id]);

  // Catch up, then follow. Restart only when the game changes; source flips arrive in-stream.
  useEffect(() => {
    const s = new GameStream(detail.id, detail.source);
    streamRef.current = s;
    s.onConnection = setConn;
    let retry: ReturnType<typeof setInterval> | undefined;
    void (async () => {
      try {
        if (detail.source === 'replay') {
          if (room && (await joinRoom())) return;
          const seq = from ? startSeq(await s.events(), from) : undefined;
          await s.start({
            speed: DEFAULT_REPLAY_SPEED,
            ...(seq !== undefined ? { from: seq } : {}),
          });
        } else {
          await s.start({});
        }
      } catch {
        setConn('offline');
        // The log fetch failed: retry once the network is back.
        retry = setInterval(() => {
          void s
            .start(detail.source === 'replay' ? { speed: DEFAULT_REPLAY_SPEED } : {})
            .then(() => clearInterval(retry))
            .catch(() => undefined);
        }, 5_000);
      }
    })();
    // Background: close the socket. Foreground: resume from lastSeq + 1 (no duplicates).
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') s.wake();
      else if (st === 'background') s.sleep();
    });
    return () => {
      clearInterval(retry);
      sub.remove();
      s.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.id]);

  // A phone in the room re-joins when the room jumps (more than 2 plays apart).
  useEffect(() => {
    if (!joined) return;
    const t = setInterval(() => {
      void (async () => {
        const s = streamRef.current;
        if (!s || useGame.getState().source !== 'replay') return;
        const r = await api.room(detail.id).catch(() => undefined);
        if (r?.seq === undefined) return;
        const all = await s.events();
        const plays = all.filter((e) => e.event.kind === 'play');
        const cur = useGame.getState().current;
        const mine = plays.findIndex((e) => e.event.kind === 'play' && e.event.id === cur?.id);
        const theirs = plays.findIndex((e) => e.seq === r.seq);
        if (theirs >= 0 && Math.abs(theirs - mine) > 2) await joinRoom();
      })();
    }, ROOM_POLL_MS);
    return () => clearInterval(t);
  }, [joined, detail.id, joinRoom]);

  const teams = useMemo(
    () => ({ home: detail.home, away: detail.away }),
    [detail.home, detail.away],
  );
  const isReplay = g.source === 'replay';

  // Whole-game log for the replay timeline (live games scrub what has been shown).
  const [fullLog, setFullLog] = useState<LoggedEvent[]>([]);
  useEffect(() => {
    if (!isReplay || !features.timeline) return;
    let alive = true;
    void streamRef.current
      ?.events()
      .then((e) => alive && setFullLog(e))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [isReplay, features.timeline, g.gameId]);

  const presentedPlays = useMemo(() => g.plays.slice(0, g.presented), [g.plays, g.presented]);
  const currentIndex = g.current ? g.plays.findIndex((p) => p.id === g.current?.id) : -1;
  const queuedPlays = g.queue.filter((q) => q.event.kind === 'play').length;
  // Keep animation pace with the feed: faster replays and a backed-up live queue speed it up.
  const effSpeed =
    g.animSpeed * (isReplay ? Math.max(1, g.streamSpeed / 2) : 1) * (queuedPlays > 2 ? 2 : 1);
  const onDone = useCallback((id: string) => useGame.getState().finishPlay(id), []);

  // Haptics on outcomes, only for plays that animated (not catch-up).
  const lastHaptic = useRef(-1);
  useEffect(() => {
    if (g.instant) {
      lastHaptic.current = g.presented;
      return;
    }
    if (g.presented > lastHaptic.current && lastHaptic.current >= 0) {
      const p = g.plays[g.presented - 1];
      if (p && prefs.haptics) playHaptic(p);
    }
    lastHaptic.current = g.presented;
  }, [g.presented, g.instant, g.plays, prefs.haptics]);

  // Commentary language.
  const lang: Lang = features.translate ? prefs.lang : 'en';
  const recentTexts = useMemo(() => {
    if (lang === 'en') return [];
    const ids = g.plays.slice(Math.max(0, g.presented - 8), g.presented + 1).map((p) => p.id);
    if (g.card) ids.push(g.card.id);
    return ids.flatMap((id) => {
      const l = g.commentary[id];
      return [l?.pbp, l?.color].filter((t): t is string => !!t);
    });
  }, [lang, g.plays, g.presented, g.card, g.commentary]);
  const tr = useTranslations(lang, recentTexts);
  const lines = useMemo<Record<string, Lines>>(() => {
    if (lang === 'en') return g.commentary;
    const out: Record<string, Lines> = {};
    for (const [id, l] of Object.entries(g.commentary)) {
      out[id] = {
        ...(l.pbp ? { pbp: tr[l.pbp] ?? l.pbp } : {}),
        ...(l.color ? { color: tr[l.color] ?? l.color } : {}),
      };
    }
    return out;
  }, [lang, g.commentary, tr]);
  const speakable = useCallback(
    (text: string | undefined) => (!text ? undefined : lang === 'en' ? text : tr[text]),
    [lang, tr],
  );

  // Two-voice announcers: speak each presented play's lines once, play-by-play first.
  const announcer = useRef<Announcer | null>(null);
  const spoken = useRef(new Set<string>());
  if (!announcer.current && features.tts)
    announcer.current = new Announcer(!!features.ttsServer, expoSpeakers);
  useEffect(() => {
    announcer.current?.setMuted(g.muted);
  }, [g.muted]);
  useEffect(
    () => () => {
      announcer.current?.stop();
      useGame.getState().setMuted(true);
    },
    [],
  );
  useEffect(() => {
    const a = announcer.current;
    if (!a || g.muted) return;
    a.setLatest(g.presented - 1);
    for (let i = Math.max(0, g.presented - 2); i < g.presented; i++) {
      const p = g.plays[i];
      if (!p) continue;
      for (const voice of ['pbp', 'color'] as const) {
        const text = speakable(g.commentary[p.id]?.[voice]);
        const key = `${p.id}:${voice}`;
        if (text && !spoken.current.has(key)) {
          spoken.current.add(key);
          a.say({ text, voice, playIndex: i, lang });
        }
      }
    }
    const card = g.card;
    const cardLine = card ? speakable(g.commentary[card.id]?.color) : undefined;
    if (card && cardLine && !spoken.current.has(`${card.id}:color`)) {
      spoken.current.add(`${card.id}:color`);
      a.say({ text: cardLine, voice: 'color', playIndex: g.presented - 1, lang });
    }
  }, [g.presented, g.commentary, g.card, g.plays, g.muted, speakable, lang]);

  // VoiceOver: one announcement per finished play and per stoppage card.
  const lastPresented = presentedPlays[presentedPlays.length - 1];
  useEffect(() => {
    if (!lastPresented || g.instant) return;
    const t = setTimeout(() => {
      const line =
        useGame.getState().commentary[lastPresented.id]?.pbp ?? stripClock(lastPresented.raw.text);
      AccessibilityInfo.announceForAccessibility(line);
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastPresented?.id]);

  const timelineEntries: LoggedEvent[] = isReplay
    ? fullLog
    : presentedPlays.map((p, i) => ({ seq: i, event: p }));
  const currentSeq = isReplay
    ? (fullLog.find((e) => e.event.kind === 'play' && e.event.id === g.current?.id)?.seq ?? -1)
    : currentIndex;

  const jump = useCallback(
    (seq: number) => {
      if (useGame.getState().source === 'replay')
        void streamRef.current?.start({ from: seq, speed: replaySpeed, source: 'replay' });
      else useGame.getState().showPlay(seq);
    },
    [replaySpeed],
  );
  const cite = useCallback(
    async (label: string) => {
      const st = useGame.getState();
      const i = findPresented(st.plays, st.presented, label);
      if (i >= 0) return st.showPlay(i);
      if (st.source === 'replay' && streamRef.current) {
        const seq = findInLog(await streamRef.current.events(), label);
        if (seq !== undefined)
          await streamRef.current.start({ from: seq, speed: replaySpeed, source: 'replay' });
      }
    },
    [replaySpeed],
  );
  const prev = useCallback(() => {
    const st = useGame.getState();
    const i = st.current ? st.plays.findIndex((p) => p.id === st.current?.id) : st.presented;
    st.showPlay(Math.max(0, i - 1));
  }, []);
  const next = useCallback(() => {
    const st = useGame.getState();
    const i = st.current ? st.plays.findIndex((p) => p.id === st.current?.id) : -1;
    if (i < st.presented - 1) st.showPlay(i + 1);
    else if (st.paused) st.setPaused(false);
  }, []);
  const nextBig = useCallback(async () => {
    const st = useGame.getState();
    if (st.source === 'replay' && streamRef.current) {
      const all = await streamRef.current.events();
      const curSeq =
        all.find((e) => e.event.kind === 'play' && e.event.id === st.current?.id)?.seq ?? -1;
      const target = all.find((e) => e.seq > curSeq && e.event.kind === 'play' && e.event.big);
      if (target)
        await streamRef.current.start({ from: target.seq, speed: replaySpeed, source: 'replay' });
      return;
    }
    const i = st.current ? st.plays.findIndex((p) => p.id === st.current?.id) : -1;
    const j = st.plays.findIndex((p, k) => k > i && k < st.presented && p.big);
    if (j >= 0) st.showPlay(j);
  }, [replaySpeed]);
  const fourthQuarter = useCallback(async () => {
    if (!streamRef.current) return;
    const seq = firstPlayOfQuarter(await streamRef.current.events(), 4);
    if (seq !== undefined)
      await streamRef.current.start({ from: seq, speed: replaySpeed, source: 'replay' });
  }, [replaySpeed]);
  const changeReplaySpeed = useCallback((sp: number) => {
    setReplaySpeed(sp);
    useGame.getState().setStreamSpeed(sp);
    streamRef.current?.resume(sp);
  }, []);
  const onJoin = useCallback(async () => {
    if (await joinRoom()) setJoined(true);
  }, [joinRoom]);

  const clockPulse = g.current?.parsed.type === 'kneel' || g.current?.parsed.type === 'spike';
  const cardLines = g.card ? lines[g.card.id] : undefined;
  const radio = panel === 'radio';
  const hasAnalytics = !!(features.oddsChart || features.epa || features.fourthDown);
  const kalshi = g.kalshi ? g.kalshi.homeProb : detail.kalshiHomeProb;
  const state = g.state ?? detail.state;

  const fieldBox = (w: number, h: number) => {
    const fw = Math.min(w, h * FIELD_ASPECT);
    return { width: fw, height: fw / FIELD_ASPECT };
  };

  const field = (
    box: { width: number; height: number },
    labels: 'all' | 'involved',
    hidden = false,
  ) => (
    <View
      style={[{ width: box.width, height: box.height, alignSelf: 'center' }, hidden && s.hidden]}
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
    >
      <FieldView
        home={detail.home}
        away={detail.away}
        depth={detail.depth ?? {}}
        rosters={detail.rosters ?? {}}
        play={g.current}
        state={state}
        replayToken={g.replayToken}
        speed={effSpeed}
        paused={g.paused}
        instant={g.instant}
        onDone={onDone}
        labels={labels}
        headless={hidden}
      />
      {!hidden && <StoppageCard card={g.card} teams={teams} lines={cardLines} />}
      {!hidden && features.oddsChart && <SwingCallout play={lastPresented} teams={teams} />}
    </View>
  );

  const muteButton = features.tts ? (
    <Button
      icon={g.muted ? 'volume-x' : 'volume-2'}
      {...(g.muted ? {} : { label: 'On air' })}
      variant={g.muted ? 'secondary' : 'primary'}
      onPress={() => g.setMuted(!g.muted)}
      accessibilityLabel={g.muted ? 'Unmute announcers' : 'Mute announcers'}
    />
  ) : null;

  if (landscape) {
    const box = fieldBox(
      width - insets.left - insets.right - 16,
      height - insets.top - insets.bottom - 56,
    );
    return (
      <View
        style={[
          s.screen,
          {
            paddingLeft: insets.left + 8,
            paddingRight: insets.right + 8,
            paddingTop: insets.top + 4,
          },
        ]}
      >
        <View style={s.strip}>
          <Button
            icon="chevron-left"
            variant="ghost"
            onPress={() => router.back()}
            accessibilityLabel="Back"
          />
          <TeamDot color={detail.away.color} />
          <Display size={22}>
            {detail.away.abbr} {state?.away ?? detail.away.score ?? 0}
          </Display>
          <Display size={22} color={colors.muted}>
            {state ? `${periodLabel(state.quarter)} ${clockLabel(state.clock)}` : detail.detail}
          </Display>
          <Display size={22}>
            {state?.home ?? detail.home.score ?? 0} {detail.home.abbr}
          </Display>
          <TeamDot color={detail.home.color} />
          <T size={12} muted num style={{ marginLeft: 8 }}>
            {g.wp !== undefined ? `${detail.home.abbr} ${pct(g.wp)}` : ''}
          </T>
          <View style={{ flex: 1 }} />
          <Button
            icon={g.paused ? 'play' : 'pause'}
            onPress={() => g.setPaused(!g.paused)}
            accessibilityLabel={g.paused ? 'Play' : 'Pause'}
          />
          {muteButton}
        </View>
        <OfflineBanner state={conn} />
        {field(box, 'all')}
      </View>
    );
  }

  const box = fieldBox(width - insets.left - insets.right, height * 0.45);
  return (
    <View style={[s.screen, { paddingTop: insets.top }]}>
      <View style={[s.top, { paddingLeft: insets.left + 12, paddingRight: insets.right + 12 }]}>
        <View style={s.nav}>
          <Button
            icon="chevron-left"
            variant="ghost"
            onPress={() => router.back()}
            accessibilityLabel="Back to scoreboard"
          />
          <View style={{ flex: 1 }} />
          {muteButton}
          {features.chat && (
            <Button
              icon="message-circle"
              label="Ask"
              onPress={() => setChatOpen(true)}
              accessibilityLabel="Ask the game"
            />
          )}
        </View>
        <Scorebug
          detail={detail}
          state={state}
          source={g.source}
          {...(g.lastUpdate !== undefined ? { lastUpdate: g.lastUpdate } : {})}
          {...(isReplay ? { speed: g.streamSpeed } : {})}
          clockPulse={clockPulse}
        />
        <WpBar
          home={detail.home}
          away={detail.away}
          {...(g.wp !== undefined ? { homeProb: g.wp } : {})}
          {...(kalshi !== undefined ? { kalshiHome: kalshi } : {})}
        />
      </View>
      <OfflineBanner state={conn} />
      {field(box, 'involved', radio)}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingLeft: insets.left + 12,
          paddingRight: insets.right + 12,
          paddingTop: 10,
          paddingBottom: insets.bottom + 24,
          gap: 12,
        }}
      >
        {g.current && !radio ? (
          <T size={13} muted style={{ minHeight: 36 }}>
            {stripClock(g.current.raw.text)}
          </T>
        ) : null}
        <PlaybackControls
          paused={g.paused}
          onPause={() => g.setPaused(!g.paused)}
          onReplay={() => currentIndex >= 0 && g.showPlay(currentIndex)}
          onPrev={prev}
          onNext={next}
          onBig={() => void nextBig()}
          onFourth={() => void fourthQuarter()}
          replay={isReplay}
          streamSpeed={replaySpeed}
          onStreamSpeed={changeReplaySpeed}
        />
        <View style={s.rowWrap}>
          {isReplay && !joined && (
            <Button icon="users" label="Join the room" size="sm" onPress={() => void onJoin()} />
          )}
          {joined && (
            <T size={12} muted>
              Following the room
            </T>
          )}
          {features.translate && (
            <Segmented
              accessibilityLabel="Commentary language"
              options={LANGS.map((l) => ({ value: l.code, label: l.label }))}
              value={prefs.lang}
              onChange={(v) => prefs.set({ lang: v })}
            />
          )}
          {isReplay && g.done && !g.queue.length && (
            <T size={12} muted>
              End of game
            </T>
          )}
        </View>
        {features.timeline && (
          <Section>
            <Timeline
              entries={timelineEntries}
              currentSeq={currentSeq}
              teams={teams}
              onJump={jump}
            />
          </Section>
        )}
        <Segmented
          accessibilityLabel="Panels"
          options={[
            { value: 'feed' as Panel, label: 'Feed' },
            ...(hasAnalytics ? [{ value: 'analytics' as Panel, label: 'Analytics' }] : []),
            { value: 'radio' as Panel, label: 'Radio' },
          ]}
          value={panel}
          onChange={(v) => {
            setPanel(v);
            prefs.set({ radio: v === 'radio' });
          }}
          style={{ alignSelf: 'flex-start' }}
        />
        {panel === 'radio' && (
          <RadioView
            teams={teams}
            state={state}
            play={lastPresented ?? g.current}
            lines={lastPresented ? lines[lastPresented.id] : undefined}
            homeWp={g.wp}
          />
        )}
        {panel === 'analytics' && (
          <AnalyticsPanel
            plays={presentedPlays}
            odds={g.odds}
            teams={teams}
            features={features}
            onSelect={(i) => g.showPlay(i)}
          />
        )}
        {panel === 'feed' && (
          <PlayFeed
            plays={presentedPlays}
            commentary={lines}
            deltas={g.deltas}
            teams={teams}
            currentId={g.current?.id}
            onSelect={(i) => g.showPlay(i)}
            showEpa={!!features.epa}
            clips={g.clips}
            showClips={!!features.clips}
          />
        )}
        <OddsFooter />
      </ScrollView>
      {features.chat && (
        <ChatSheet
          gameId={detail.id}
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          onCite={(l) => void cite(l)}
          ttsServer={!!features.ttsServer}
        />
      )}
    </View>
  );
}

export default function GameScreen() {
  const params = useLocalSearchParams<{ id: string; from?: string; room?: string }>();
  const id = String(params.id);
  const insets = useSafeAreaInsets();
  const q = useQuery({
    queryKey: ['game', id],
    queryFn: () => api.game(id),
    refetchInterval: (query) => (query.state.data?.status === 'pre' ? 30_000 : false),
  });
  const detail = q.data;
  if (!detail || (detail.status === 'pre' && !detail.state)) {
    return (
      <ScrollView
        style={s.screen}
        contentContainerStyle={{
          paddingTop: insets.top + 4,
          paddingBottom: insets.bottom + 24,
          paddingLeft: insets.left + 12,
          paddingRight: insets.right + 12,
          gap: 12,
        }}
      >
        <Pressable onPress={() => router.back()} accessibilityRole="button" style={s.back}>
          <Feather name="chevron-left" size={20} color={colors.muted} />
          <T muted>Scoreboard</T>
        </Pressable>
        {q.isLoading && <T muted>Loading game...</T>}
        {q.isError && (
          <View style={{ gap: 10 }}>
            <T color={colors.negative}>Game not found or the server is unreachable.</T>
            <Button
              label="Retry"
              icon="refresh-cw"
              onPress={() => void q.refetch()}
              style={{ alignSelf: 'flex-start' }}
            />
          </View>
        )}
        {detail && <Preview detail={detail} />}
        {detail && <OddsFooter />}
      </ScrollView>
    );
  }
  return (
    <LiveGame
      key={detail.id}
      detail={detail}
      {...(typeof params.from === 'string' ? { from: params.from } : {})}
      room={params.room === '1'}
    />
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  top: { gap: 10, paddingBottom: 10 },
  nav: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: -8 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 40 },
  strip: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 48 },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' },
  offline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    justifyContent: 'center',
    backgroundColor: colors.stale,
    paddingVertical: 6,
    borderRadius: radius.sm,
    marginHorizontal: 12,
    marginBottom: 6,
  },
});
