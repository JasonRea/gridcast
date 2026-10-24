/**
 * Playback clocks. Live and replay share the whole pipeline; the only difference is how events
 * are released from the log:
 * - live: everything already logged at once, then each new event the moment it is appended
 * - replay: logged events released on a compressed schedule, scaled by `speed`
 */
import type { GameEvent, LoggedEvent } from '@gridcast/types';
import type { EventLog } from '../log/eventLog.ts';

/** At 1x, how far apart plays and stoppages are released (ms). Real gaps are clamped to this. */
export const PLAY_GAP_MIN = 5_000;
export const PLAY_GAP_MAX = 9_000;
/** Commentary, odds and clips follow their play by at most this much (ms at 1x). */
export const FOLLOW_GAP_MAX = 2_500;

const isAnchor = (e: GameEvent) => e.kind === 'play' || e.kind === 'stoppage';

/**
 * Replay offsets (ms at 1x, relative to the first event) for a run of logged events. Real game
 * time is compressed so a 3-hour game replays in about 25 minutes at 1x and 3 at 8x.
 */
export function replaySchedule(events: readonly LoggedEvent[]): number[] {
  const out: number[] = [];
  let anchorReal: number | undefined;
  let anchorReplay = 0;
  let prev = 0;
  for (const { event } of events) {
    let t: number;
    if (anchorReal === undefined) {
      t = 0;
      if (isAnchor(event)) anchorReal = event.ts;
    } else if (isAnchor(event)) {
      const gap = Math.min(PLAY_GAP_MAX, Math.max(PLAY_GAP_MIN, event.ts - anchorReal));
      t = Math.max(prev, anchorReplay + gap);
      anchorReal = event.ts;
      anchorReplay = t;
    } else {
      t = Math.max(
        prev,
        anchorReplay + Math.min(FOLLOW_GAP_MAX, Math.max(0, event.ts - anchorReal)),
      );
    }
    out.push(t);
    prev = t;
  }
  return out;
}

export type ClockMessage = { type: 'event'; entry: LoggedEvent } | { type: 'done' };

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted || ms <= 0) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });

/** Replay clock: releases log entries from `from` on the compressed schedule. */
export async function* replayClock(
  log: EventLog,
  opts: { from: number; speed: number; signal: AbortSignal },
): AsyncGenerator<ClockMessage> {
  const entries = log.from(opts.from);
  const schedule = replaySchedule(entries);
  const speed = Math.max(0.25, opts.speed);
  const start = Date.now();
  for (let i = 0; i < entries.length; i++) {
    const due = start + (schedule[i] ?? 0) / speed;
    await sleep(due - Date.now(), opts.signal);
    if (opts.signal.aborted) return;
    yield { type: 'event', entry: entries[i]! };
  }
  yield { type: 'done' };
}

/** Live clock: backlog from `from` immediately, then follows the log as it grows. */
export async function* liveClock(
  log: EventLog,
  opts: { from: number; signal: AbortSignal },
): AsyncGenerator<ClockMessage> {
  const queue: LoggedEvent[] = [];
  let wake: (() => void) | undefined;
  const onAppend = (e: LoggedEvent) => {
    queue.push(e);
    wake?.();
  };
  log.on('append', onAppend);
  const onAbort = () => wake?.();
  opts.signal.addEventListener('abort', onAbort);
  try {
    let next = Math.max(0, opts.from);
    for (const entry of log.from(next)) {
      yield { type: 'event', entry };
      next = entry.seq + 1;
    }
    while (!opts.signal.aborted) {
      while (queue.length) {
        const entry = queue.shift()!;
        if (entry.seq < next) continue;
        next = entry.seq + 1;
        yield { type: 'event', entry };
      }
      if (queue.length || opts.signal.aborted) continue;
      await new Promise<void>((r) => (wake = r));
      wake = undefined;
    }
  } finally {
    log.off('append', onAppend);
    opts.signal.removeEventListener('abort', onAbort);
  }
}
