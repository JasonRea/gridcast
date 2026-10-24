/**
 * GET /api/games/:id/stream: SSE of logged GameEvents. The connection survives a kill-switch flip:
 * the current clock is aborted, a `reset` control message is sent, and the other clock starts.
 */
import type { Context } from 'hono';
import { streamSSE, type SSEStreamingApi } from 'hono/streaming';
import type { StreamControl } from '@gridcast/types';
import type { GameSession, SourceChange } from '../games/session.ts';
import { liveClock, replayClock } from '../replay/clock.ts';

const HEARTBEAT_MS = 5_000;

async function control(stream: SSEStreamingApi, msg: StreamControl) {
  await stream.writeSSE({ event: 'control', data: JSON.stringify(msg) });
}

export function streamGame(c: Context, session: GameSession) {
  const q = c.req.query();
  const lastId = c.req.header('last-event-id');
  let from =
    lastId !== undefined && /^\d+$/.test(lastId) ? Number(lastId) + 1 : Number(q.from ?? 0) || 0;
  const clientSpeed = q.speed ? Math.min(16, Math.max(0.25, Number(q.speed) || 1)) : undefined;

  return streamSSE(c, async (stream) => {
    let closed = false;
    const client = new AbortController();
    stream.onAbort(() => {
      closed = true;
      client.abort();
    });
    session.lastViewed = Date.now();

    let pending: SourceChange | undefined;
    let current = new AbortController();
    const onSource = (ch: SourceChange) => {
      pending = ch;
      current.abort();
    };
    session.on('source', onSource);

    let lastEmit: number | undefined;
    let done = false;
    const speedNow = () => clientSpeed ?? session.replaySpeed;
    const heartbeat = setInterval(() => {
      session.lastViewed = Date.now();
      void control(stream, {
        type: 'status',
        source: session.source,
        ...(session.source === 'live'
          ? session.lastUpdate !== undefined
            ? { lastUpdate: session.lastUpdate }
            : {}
          : lastEmit !== undefined
            ? { lastUpdate: lastEmit }
            : {}),
        ...(session.source === 'replay' ? { speed: speedNow(), done } : {}),
      }).catch(() => client.abort());
    }, HEARTBEAT_MS);

    const onDelta = (msg: StreamControl) => void control(stream, msg).catch(() => client.abort());
    session.on('delta', onDelta);

    try {
      await control(stream, {
        type: 'status',
        source: session.source,
        ...(session.lastUpdate !== undefined ? { lastUpdate: session.lastUpdate } : {}),
        ...(session.source === 'replay' ? { speed: speedNow() } : {}),
      });
      while (!closed) {
        current = new AbortController();
        const signal = AbortSignal.any([current.signal, client.signal]);
        done = false;
        const clock =
          session.source === 'live'
            ? liveClock(session.log, { from, signal })
            : replayClock(session.log, { from, speed: speedNow(), signal });
        for await (const msg of clock) {
          if (msg.type === 'done') {
            done = true;
            await control(stream, {
              type: 'status',
              source: session.source,
              speed: speedNow(),
              done: true,
            });
            continue;
          }
          await stream.writeSSE({
            event: 'game',
            id: String(msg.entry.seq),
            data: JSON.stringify(msg.entry),
          });
          lastEmit = Date.now();
          from = msg.entry.seq + 1;
        }
        // Replay finished: hold the connection open until the client leaves or the source flips.
        if (!signal.aborted) {
          await new Promise<void>((r) =>
            signal.addEventListener('abort', () => r(), { once: true }),
          );
        }
        if (closed) break;
        if (pending) {
          from = pending.from;
          await control(stream, { type: 'reset', source: pending.source, from });
          pending = undefined;
        }
      }
    } finally {
      clearInterval(heartbeat);
      session.off('source', onSource);
      session.off('delta', onDelta);
    }
  });
}
