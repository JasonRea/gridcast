/**
 * Game page state. Incoming events queue up and are presented one at a time so only one thing
 * moves at once: the field animates a play, then its commentary shows, then odds tick.
 */
import { create } from 'zustand';
import type {
  Clip,
  GameState,
  LoggedEvent,
  OddsTick,
  PlayEvent,
  StoppageEvent,
  StreamControl,
} from '@gridcast/types';

export type Lines = { pbp?: string; color?: string };

export type WpPoint = { seq: number; ts: number; home: number; playId?: string };

export type GameStore = {
  gameId: string | null;
  plays: PlayEvent[];
  /** Plays shown in the feed (already animated). */
  presented: number;
  current: PlayEvent | undefined;
  instant: boolean;
  replayToken: number;
  queue: LoggedEvent[];
  busy: boolean;
  commentary: Record<string, Lines>;
  deltas: Record<string, Lines>;
  stoppages: StoppageEvent[];
  card: StoppageEvent | undefined;
  odds: OddsTick[];
  kalshi: OddsTick | undefined;
  wp: number | undefined;
  wpHistory: WpPoint[];
  clips: Record<string, Clip[]>;
  /** Scorebug state. */
  state: GameState | undefined;
  lastSeq: number;
  source: 'live' | 'replay';
  lastUpdate: number | undefined;
  streamSpeed: number;
  done: boolean;
  connected: boolean;
  paused: boolean;
  animSpeed: number;
  /** Announcers and sound start muted (loud judging room). */
  muted: boolean;

  reset: (gameId: string) => void;
  applyInstant: (entries: LoggedEvent[]) => void;
  receive: (entry: LoggedEvent) => void;
  control: (msg: StreamControl) => void;
  finishPlay: (playId: string) => void;
  showPlay: (index: number) => void;
  setPaused: (p: boolean) => void;
  setAnimSpeed: (s: number) => void;
  setConnected: (c: boolean) => void;
  setStreamSpeed: (s: number) => void;
  setMuted: (m: boolean) => void;
};

const STOPPAGE_HOLD_MS = 2200;
const CARD_TTL_MS = 9000;

let stoppageTimer: ReturnType<typeof setTimeout> | undefined;
let cardTimer: ReturnType<typeof setTimeout> | undefined;

const initial = {
  plays: [] as PlayEvent[],
  presented: 0,
  current: undefined,
  instant: false,
  replayToken: 0,
  queue: [] as LoggedEvent[],
  busy: false,
  commentary: {} as Record<string, Lines>,
  deltas: {} as Record<string, Lines>,
  stoppages: [] as StoppageEvent[],
  card: undefined,
  odds: [] as OddsTick[],
  kalshi: undefined,
  wp: undefined,
  wpHistory: [] as WpPoint[],
  clips: {} as Record<string, Clip[]>,
  state: undefined,
  lastSeq: -1,
  done: false,
};

export const useGame = create<GameStore>((set, get) => {
  /** Applies a non-play event's data immediately. */
  function applyData(entry: LoggedEvent) {
    const e = entry.event;
    if (e.kind === 'commentary') {
      set((s) => ({
        commentary: {
          ...s.commentary,
          [e.playId]: { ...s.commentary[e.playId], [e.voice]: e.text },
        },
      }));
    } else if (e.kind === 'odds') {
      set((s) => ({
        odds: [...s.odds, e],
        ...(e.source === 'kalshi' && e.market === 'moneyline' ? { kalshi: e } : {}),
      }));
    } else if (e.kind === 'clip') {
      set((s) => ({ clips: { ...s.clips, [e.playId]: [...(s.clips[e.playId] ?? []), e] } }));
    }
  }

  function showCard(card: StoppageEvent) {
    clearTimeout(cardTimer);
    set({ card });
    cardTimer = setTimeout(
      () => {
        if (get().card === card) set({ card: undefined });
      },
      CARD_TTL_MS / Math.max(0.5, get().animSpeed),
    );
  }

  function pump() {
    const s = get();
    if (s.busy || s.paused || !s.queue.length) return;
    const [next, ...rest] = s.queue;
    if (!next) return;
    set({ queue: rest });
    const e = next.event;
    if (e.kind === 'play') {
      const plays = s.plays.some((p) => p.id === e.id) ? s.plays : [...s.plays, e];
      set({
        plays,
        current: e,
        instant: false,
        busy: true,
        state: e.pre,
        replayToken: s.replayToken + 1,
        ...(e.parsed.type !== 'other' ? { card: undefined } : {}),
      });
      return;
    }
    if (e.kind === 'stoppage') {
      set((st) => ({ stoppages: [...st.stoppages, e], state: e.state, busy: true }));
      showCard(e);
      clearTimeout(stoppageTimer);
      stoppageTimer = setTimeout(
        () => {
          set({ busy: false });
          pump();
        },
        STOPPAGE_HOLD_MS / Math.max(0.5, get().animSpeed),
      );
      return;
    }
    applyData(next);
    pump();
  }

  return {
    gameId: null,
    ...initial,
    source: 'replay',
    lastUpdate: undefined,
    streamSpeed: 1,
    connected: false,
    paused: false,
    animSpeed: 1,
    muted: true,

    reset: (gameId) => {
      clearTimeout(stoppageTimer);
      clearTimeout(cardTimer);
      set({ gameId, ...initial, commentary: {}, deltas: {}, clips: {} });
    },

    applyInstant: (entries) => {
      const s = get();
      const plays = [...s.plays];
      const commentary = { ...s.commentary };
      const stoppages = [...s.stoppages];
      const odds = [...s.odds];
      const wpHistory = [...s.wpHistory];
      const clips = { ...s.clips };
      let { state, wp, kalshi, lastSeq } = s;
      for (const entry of entries) {
        const e = entry.event;
        lastSeq = Math.max(lastSeq, entry.seq);
        if (e.kind === 'play') {
          plays.push(e);
          state = e.state;
          if (e.wpAfter !== undefined) {
            wp = e.wpAfter;
            wpHistory.push({ seq: entry.seq, ts: e.ts, home: e.wpAfter, playId: e.id });
          }
        } else if (e.kind === 'stoppage') {
          stoppages.push(e);
          state = e.state;
        } else if (e.kind === 'commentary') {
          commentary[e.playId] = { ...commentary[e.playId], [e.voice]: e.text };
        } else if (e.kind === 'odds') {
          odds.push(e);
          if (e.source === 'kalshi' && e.market === 'moneyline') kalshi = e;
        } else if (e.kind === 'clip') {
          clips[e.playId] = [...(clips[e.playId] ?? []), e];
        }
      }
      const last = plays[plays.length - 1];
      set({
        plays,
        presented: plays.length,
        commentary,
        stoppages,
        odds,
        wpHistory,
        clips,
        state,
        wp,
        kalshi,
        lastSeq,
        current: last,
        instant: true,
        replayToken: s.replayToken + 1,
        busy: false,
      });
    },

    receive: (entry) => {
      const s = get();
      if (entry.seq <= s.lastSeq) return;
      set({ lastSeq: entry.seq, queue: [...s.queue, entry] });
      // Commentary for a play already on screen shows right away.
      const e = entry.event;
      if (e.kind === 'commentary' && s.plays.slice(0, s.presented).some((p) => p.id === e.playId)) {
        set({ queue: get().queue.filter((q) => q !== entry) });
        applyData(entry);
      }
      pump();
    },

    control: (msg) => {
      if (msg.type === 'status') {
        set({
          source: msg.source,
          ...(msg.lastUpdate !== undefined ? { lastUpdate: msg.lastUpdate } : {}),
          ...(msg.speed !== undefined ? { streamSpeed: msg.speed } : {}),
          done: !!msg.done,
        });
      } else if (msg.type === 'delta') {
        set((s) => ({
          deltas: { ...s.deltas, [msg.playId]: { ...s.deltas[msg.playId], [msg.voice]: msg.text } },
        }));
      } else if (msg.type === 'reset') {
        set({ source: msg.source });
      }
    },

    finishPlay: (playId) => {
      const s = get();
      const idx = s.plays.findIndex((p) => p.id === playId);
      if (idx < 0) return;
      const play = s.plays[idx]!;
      const firstTime = idx >= s.presented;
      set({
        busy: false,
        presented: Math.max(s.presented, idx + 1),
        ...(firstTime || idx === s.plays.length - 1 ? { state: play.state } : {}),
        ...(firstTime && play.wpAfter !== undefined
          ? {
              wp: play.wpAfter,
              wpHistory: [
                ...s.wpHistory,
                { seq: s.lastSeq, ts: play.ts, home: play.wpAfter, playId },
              ],
            }
          : {}),
      });
      pump();
    },

    showPlay: (index) => {
      const s = get();
      const play = s.plays[Math.max(0, Math.min(index, s.presented - 1))];
      if (!play) return;
      set({
        current: play,
        instant: false,
        busy: true,
        replayToken: s.replayToken + 1,
        state: play.pre,
      });
    },

    setPaused: (paused) => {
      set({ paused });
      if (!paused) pump();
    },
    setAnimSpeed: (animSpeed) => set({ animSpeed }),
    setConnected: (connected) => set({ connected }),
    setStreamSpeed: (streamSpeed) => set({ streamSpeed }),
    setMuted: (muted) => set({ muted }),
  };
});
