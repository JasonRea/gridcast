/**
 * Demo kill switch. POST /api/admin/source flips a game (the featured game by default) between
 * the live feed and the recorded replay. Connected clients switch without a page reload.
 * Protected by ADMIN_TOKEN; with no token configured, the route refuses every request.
 */
import { timingSafeEqual } from 'node:crypto';
import type { Hono } from 'hono';
import { AdminSourceRequestSchema } from '@gridcast/types';
import type { Config } from '../config.ts';
import type { GameRegistry } from '../games/registry.ts';

function authorized(header: string | undefined, token: string | undefined): boolean {
  if (!token || !header) return false;
  const given = header.replace(/^Bearer\s+/i, '').trim();
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function adminRoutes(app: Hono, deps: { config: Config; registry: GameRegistry }) {
  app.use('/api/admin/*', async (c, next) => {
    if (!deps.config.adminToken) return c.json({ error: 'admin disabled: set ADMIN_TOKEN' }, 503);
    const header = c.req.header('authorization') ?? c.req.header('x-admin-token');
    if (!authorized(header, deps.config.adminToken)) return c.json({ error: 'unauthorized' }, 401);
    await next();
  });

  app.get('/api/admin/source', async (c) => {
    const id = c.req.query('gameId') ?? deps.config.featuredGameId;
    const s = await deps.registry.get(id);
    if (!s) return c.json({ error: 'game not found' }, 404);
    return c.json({
      gameId: s.gameId,
      source: s.source,
      status: s.status,
      speed: s.replaySpeed,
      events: s.log.length,
      lastUpdate: s.lastUpdate ?? null,
    });
  });

  app.post('/api/admin/source', async (c) => {
    const parsed = AdminSourceRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'invalid body', issues: parsed.error.issues }, 400);
    const { gameId, source, speed, from } = parsed.data;
    const s = await deps.registry.get(gameId ?? deps.config.featuredGameId);
    if (!s) return c.json({ error: 'game not found' }, 404);
    if (source === 'replay' && s.log.length === 0)
      return c.json({ error: 'nothing recorded yet' }, 409);
    const change = s.setSource(source, {
      ...(speed !== undefined ? { speed } : {}),
      ...(from !== undefined ? { from } : {}),
    });
    return c.json({ gameId: s.gameId, ...change });
  });
}
