/**
 * Phones in the room (A5). The projector page hosts: it posts where its replay starts and how
 * fast it runs. Phones that scan the QR code land on /r, open the game in radio mode and ask
 * where the room is now, so they join on the same play and follow at the same speed. Replay
 * schedules are deterministic, so the same start and speed keep everyone in step. Live games
 * need nothing: every client already follows the same live log.
 *
 * Positions only steer viewers who chose to follow the room; nothing else changes, so the
 * route needs no token.
 */
import type { Hono } from 'hono';
import { RoomRequestSchema, type RoomResponse } from '@gridcast/types';
import type { Config } from '../config.ts';
import type { GameRegistry } from '../games/registry.ts';
import { replaySchedule } from '../replay/clock.ts';

type Room = { from: number; at: number; speed: number };

/** Log seq of the play the room is on, `elapsedMs` (wall clock) after starting at `from`. */
export function roomSeq(
  entries: readonly { seq: number; event: { kind: string } }[],
  elapsedMs: number,
  speed: number,
): number | undefined {
  const sch = replaySchedule(entries as Parameters<typeof replaySchedule>[0]);
  const at = elapsedMs * speed;
  let seq: number | undefined;
  for (let i = 0; i < entries.length; i++) {
    if ((sch[i] ?? 0) > at) break;
    if (entries[i]!.event.kind === 'play') seq = entries[i]!.seq;
  }
  return seq ?? entries[0]?.seq;
}

export function roomRoutes(
  app: Hono,
  deps: { config: Config; registry: GameRegistry; now?: () => number },
) {
  const rooms = new Map<string, Room>();
  let lastGame: string | undefined;
  const now = deps.now ?? Date.now;

  app.post('/api/games/:id/room', async (c) => {
    const s = await deps.registry.get(c.req.param('id'));
    if (!s) return c.json({ error: 'game not found' }, 404);
    const parsed = RoomRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'invalid body' }, 400);
    rooms.set(s.gameId, { ...parsed.data, at: now() });
    lastGame = s.gameId;
    return c.json({ ok: true });
  });

  app.get('/api/games/:id/room', async (c) => {
    const s = await deps.registry.get(c.req.param('id'));
    if (!s) return c.json({ error: 'game not found' }, 404);
    const room = rooms.get(s.gameId);
    if (s.source === 'live' || !room) {
      const body: RoomResponse = { gameId: s.gameId, source: s.source, speed: room?.speed ?? 2 };
      return c.json(body);
    }
    const seq = roomSeq(s.log.from(room.from), now() - room.at, room.speed);
    const body: RoomResponse = {
      gameId: s.gameId,
      source: 'replay',
      ...(seq !== undefined ? { seq } : {}),
      speed: room.speed,
    };
    return c.json(body);
  });

  /** Short link for the QR code: the room's game (else the featured game) in radio mode. */
  app.get('/r', (c) =>
    c.redirect(`/game/${lastGame ?? deps.config.featuredGameId}?mode=radio&room=1`, 302),
  );
}
