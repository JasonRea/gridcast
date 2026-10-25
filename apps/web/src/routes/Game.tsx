import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameDetail, LoggedEvent } from '@gridcast/types';
import { AnalyticsPanel } from '@/components/analytics/AnalyticsPanel';
import { SwingCallout } from '@/components/analytics/SwingCallout';
import { Timeline } from '@/components/analytics/Timeline';
import { Field } from '@/field/Field';
import { OddsFooter } from '@/components/OddsFooter';
import { WpBar } from '@/components/WpBar';
import { ChatDrawer } from '@/components/game/ChatDrawer';
import { DriveTracker } from '@/components/game/DriveTracker';
import { PlayFeed } from '@/components/game/PlayFeed';
import { PlaybackControls } from '@/components/game/PlaybackControls';
import { Preview } from '@/components/game/Preview';
import { Scorebug } from '@/components/game/Scorebug';
import { StoppageCard } from '@/components/game/StoppageCard';
import { api } from '@/lib/api';
import { Announcer } from '@/lib/announcer';
import { firstPlayOfQuarter, playLabel, startSeq } from '@/lib/plays';
import { GameStream } from '@/lib/stream';
import { useGame } from '@/store/game';

const DEFAULT_REPLAY_SPEED = 2;

function LiveGame({ detail }: { detail: GameDetail }) {
  const g = useGame();
  const streamRef = useRef<GameStream | null>(null);
  const [replaySpeed, setReplaySpeed] = useState(DEFAULT_REPLAY_SPEED);

  useEffect(() => {
    const s = new GameStream(detail.id, detail.source);
    streamRef.current = s;
    if (detail.source === 'replay') {
      // `?from=120` (play index) or `?from=q4` / `?from=ot` opens the replay mid-game.
      const from = new URLSearchParams(window.location.search).get('from');
      void (async () => {
        const seq = from ? startSeq(await s.events(), from) : undefined;
        await s.start({ speed: DEFAULT_REPLAY_SPEED, ...(seq !== undefined ? { from: seq } : {}) });
      })();
    } else {
      void s.start({});
    }
    return () => s.close();
    // Restart only when the game changes; source flips arrive over the stream itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.id]);

  const teams = { home: detail.home, away: detail.away };
  const isReplay = g.source === 'replay';
  const features = detail.features;

  // Whole-game log for the replay timeline (live games scrub what has already been shown).
  const [fullLog, setFullLog] = useState<LoggedEvent[]>([]);
  useEffect(() => {
    if (!isReplay || !features.timeline) return;
    let alive = true;
    void streamRef.current?.events().then((e) => alive && setFullLog(e));
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

  // Two-voice announcers (P1): speak each presented play's lines once, play-by-play first.
  const announcer = useRef<Announcer | null>(null);
  const spoken = useRef(new Set<string>());
  if (!announcer.current && features.tts) announcer.current = new Announcer(!!features.ttsServer);
  useEffect(() => {
    announcer.current?.setMuted(g.muted);
  }, [g.muted]);
  useEffect(() => () => announcer.current?.stop(), []);
  useEffect(() => {
    const a = announcer.current;
    if (!a || g.muted) return;
    a.setLatest(g.presented - 1);
    for (let i = Math.max(0, g.presented - 2); i < g.presented; i++) {
      const p = g.plays[i];
      if (!p) continue;
      for (const voice of ['pbp', 'color'] as const) {
        const text = g.commentary[p.id]?.[voice];
        const key = `${p.id}:${voice}`;
        if (text && !spoken.current.has(key)) {
          spoken.current.add(key);
          a.say({ text, voice, playIndex: i });
        }
      }
    }
    const card = g.card;
    const cardLine = card ? g.commentary[card.id]?.color : undefined;
    if (card && cardLine && !spoken.current.has(`${card.id}:color`)) {
      spoken.current.add(`${card.id}:color`);
      a.say({ text: cardLine, voice: 'color', playIndex: g.presented - 1 });
    }
  }, [g.presented, g.commentary, g.card, g.plays, g.muted]);

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
  const lastPresented = presentedPlays[presentedPlays.length - 1];

  // Chat citations like [Q3 4:12] replay that play on the field.
  const cite = useCallback(
    async (label: string) => {
      const s = useGame.getState();
      const i = s.plays.findIndex((p, k) => k < s.presented && playLabel(p) === label);
      if (i >= 0) return s.showPlay(i);
      if (s.source === 'replay' && streamRef.current) {
        const all = await streamRef.current.events();
        const hit = all.find((e) => e.event.kind === 'play' && playLabel(e.event) === label);
        if (hit)
          await streamRef.current.start({ from: hit.seq, speed: replaySpeed, source: 'replay' });
      }
    },
    [replaySpeed],
  );

  const prev = useCallback(() => {
    const s = useGame.getState();
    const i = s.current ? s.plays.findIndex((p) => p.id === s.current?.id) : s.presented;
    s.showPlay(Math.max(0, i - 1));
  }, []);
  const next = useCallback(() => {
    const s = useGame.getState();
    const i = s.current ? s.plays.findIndex((p) => p.id === s.current?.id) : -1;
    if (i < s.presented - 1) s.showPlay(i + 1);
    else if (s.paused) s.setPaused(false);
  }, []);
  const nextBig = useCallback(async () => {
    const s = useGame.getState();
    if (s.source === 'replay' && streamRef.current) {
      const all = await streamRef.current.events();
      // From the play on screen, not the last event received (the stream runs ahead).
      const curSeq =
        all.find((e) => e.event.kind === 'play' && e.event.id === s.current?.id)?.seq ?? -1;
      const target = all.find((e) => e.seq > curSeq && e.event.kind === 'play' && e.event.big);
      if (target)
        await streamRef.current.start({ from: target.seq, speed: replaySpeed, source: 'replay' });
      return;
    }
    const i = s.current ? s.plays.findIndex((p) => p.id === s.current?.id) : -1;
    const j = s.plays.findIndex((p, k) => k > i && k < s.presented && p.big);
    if (j >= 0) s.showPlay(j);
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

  // Keyboard: space pause/play, arrows prev/next, B next big play.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const s = useGame.getState();
      if (e.code === 'Space') {
        e.preventDefault();
        s.setPaused(!s.paused);
      } else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'b' || e.key === 'B') void nextBig();
      else if (e.key === 'm' || e.key === 'M') s.setMuted(!s.muted);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next, nextBig]);

  const clockPulse = g.current?.parsed.type === 'kneel' || g.current?.parsed.type === 'spike';
  const cardLines = g.card ? g.commentary[g.card.id] : undefined;

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-3 rounded-md bg-card p-4">
        <Scorebug
          detail={detail}
          state={g.state ?? detail.state}
          source={g.source}
          {...(g.lastUpdate !== undefined ? { lastUpdate: g.lastUpdate } : {})}
          {...(isReplay ? { speed: g.streamSpeed } : {})}
          clockPulse={clockPulse}
        />
        <WpBar
          home={detail.home}
          away={detail.away}
          {...(g.wp !== undefined ? { homeProb: g.wp } : {})}
          {...(g.kalshi
            ? { kalshiHome: g.kalshi.homeProb }
            : detail.kalshiHomeProb !== undefined
              ? { kalshiHome: detail.kalshiHomeProb }
              : {})}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="relative overflow-hidden rounded-md bg-black">
            <div className="aspect-[1212/545] w-full">
              <Field
                home={detail.home}
                away={detail.away}
                depth={detail.depth ?? {}}
                rosters={detail.rosters ?? {}}
                play={g.current}
                state={g.state ?? detail.state}
                replayToken={g.replayToken}
                speed={effSpeed}
                paused={g.paused}
                instant={g.instant}
                onDone={onDone}
              />
            </div>
            <StoppageCard
              card={g.card}
              teams={teams}
              {...(cardLines ? { lines: cardLines } : {})}
            />
            {features.oddsChart && <SwingCallout play={lastPresented} teams={teams} />}
          </div>
          {g.current && (
            <p className="min-h-10 text-sm leading-snug text-muted-foreground" aria-live="polite">
              {g.current.raw.text.replace(/^\(\s*\d{0,2}:\d{2}\s*\)\s*/, '')}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <PlaybackControls
              paused={g.paused}
              onPause={() => g.setPaused(!g.paused)}
              animSpeed={g.animSpeed}
              onAnimSpeed={g.setAnimSpeed}
              onReplay={() => currentIndex >= 0 && g.showPlay(currentIndex)}
              onPrev={prev}
              onNext={next}
              onBig={() => void nextBig()}
              onFourth={() => void fourthQuarter()}
              replay={isReplay}
              streamSpeed={replaySpeed}
              onStreamSpeed={changeReplaySpeed}
              {...(features.tts ? { muted: g.muted, onMute: () => g.setMuted(!g.muted) } : {})}
            />
            {isReplay && g.done && !g.queue.length && (
              <span className="text-xs text-muted-foreground">End of game</span>
            )}
          </div>
          <div className="flex flex-col gap-4 rounded-md bg-card p-4">
            <DriveTracker plays={presentedPlays} teams={teams} />
            {features.timeline && (
              <Timeline
                entries={timelineEntries}
                currentSeq={currentSeq}
                teams={teams}
                onJump={jump}
              />
            )}
          </div>
          <AnalyticsPanel
            plays={presentedPlays}
            odds={g.odds}
            teams={teams}
            features={features}
            onSelect={(i) => g.showPlay(i)}
          />
        </div>
        <aside className="min-w-0 lg:max-h-[calc(100dvh-220px)] lg:overflow-y-auto lg:pr-1">
          <PlayFeed
            plays={presentedPlays}
            commentary={g.commentary}
            deltas={g.deltas}
            teams={teams}
            {...(g.current ? { currentId: g.current.id } : {})}
            onSelect={(i) => g.showPlay(i)}
            showEpa={!!features.epa}
            clips={g.clips}
          />
        </aside>
      </div>
      {features.chat && <ChatDrawer gameId={detail.id} onCite={(l) => void cite(l)} />}
    </div>
  );
}

export function GamePage() {
  const { id } = useParams({ from: '/game/$id' });
  const {
    data: detail,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['game', id],
    queryFn: () => api.game(id),
    refetchInterval: (q) => (q.state.data?.status === 'pre' ? 30_000 : false),
  });
  return (
    <main className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 px-4 py-4 sm:px-6">
      <nav className="flex items-center gap-3">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Scoreboard
        </Link>
        <span className="display ml-auto text-lg leading-none text-muted-foreground">GRIDCAST</span>
      </nav>
      {isLoading && <p className="text-sm text-muted-foreground">Loading game...</p>}
      {isError && <p className="text-sm text-negative">Game not found.</p>}
      {detail &&
        (detail.status === 'pre' && !detail.state ? (
          <Preview detail={detail} />
        ) : (
          <LiveGame key={detail.id} detail={detail} />
        ))}
      <OddsFooter />
    </main>
  );
}
