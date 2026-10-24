/** Hono app: the only API the web client talks to. */
import { existsSync, readFileSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { EventsResponse, GameDetail } from '@gridcast/types';
import type { Config } from './config.ts';
import type { GameRegistry } from './games/registry.ts';
import { currentWeek, type ScoreboardService } from './games/scoreboard.ts';
import type { OddsService } from './kalshi/poller.ts';
import { adminRoutes } from './routes/admin.ts';
import { ttsRoutes } from './routes/tts.ts';
import { chatRoutes } from './routes/chat.ts';
import { streamGame } from './routes/stream.ts';
import { extractPreview, StorylineWriter, templateStorylines } from './games/preview.ts';

export type AppDeps = {
  config: Config;
  registry: GameRegistry;
  scoreboard: ScoreboardService;
  odds?: OddsService;
  /** Extra routes registered by feature modules (admin, chat, ...). */
  extend?: (app: Hono) => void;
};

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
};

export function createApp(deps: AppDeps): Hono {
  const { config, registry, scoreboard } = deps;
  const app = new Hono();
  const storylines = new StorylineWriter(
    config.flags.preview ? config.anthropicKey : undefined,
    config.chatModel,
  );
  app.use('/api/*', cors());

  app.get('/api/health', (c) => c.json({ ok: true, offline: config.offline }));

  app.get('/api/games', async (c) => {
    const season = Number(c.req.query('season')) || config.season;
    const week = Number(c.req.query('week')) || currentWeek(season);
    const sb = await scoreboard.get(season, week);
    if (!sb) return c.json({ season, week, games: [], dataSource: 'fixture' as const });
    const res = deps.odds ? { ...sb, games: await deps.odds.forCards(sb.games) } : sb;
    // Pin the demo replay game to every week so it is always one click away.
    if (!res.games.some((g) => g.id === config.demoGameId)) {
      const demo = await registry.get(config.demoGameId);
      if (demo) return c.json({ ...res, games: [...res.games, { ...demo.card, demo: true }] });
    }
    return c.json(res);
  });

  app.get('/api/games/:id', async (c) => {
    const s = await registry.get(c.req.param('id'));
    if (!s) return c.json({ error: 'game not found' }, 404);
    s.lastViewed = Date.now();
    const state = s.state;
    const kalshi = deps.odds?.homeProb(s.gameId);
    let preview: GameDetail['preview'];
    if (config.flags.preview && s.status === 'pre') {
      const p = extractPreview(s.summary, s.card);
      const fallback = templateStorylines(s.card, p, kalshi);
      const facts = { game: s.card, preview: p, kalshiHomeWinProb: kalshi };
      preview = { ...p, storylines: storylines.get(s.gameId, facts, fallback) };
    }
    const detail: GameDetail = {
      ...s.card,
      ...(s.gameId === config.featuredGameId ? { featured: true } : {}),
      ...(s.gameId === config.demoGameId ? { demo: true } : {}),
      source: s.source,
      ...(state ? { state } : {}),
      ...(kalshi !== undefined ? { kalshiHomeProb: kalshi } : {}),
      ...(preview ? { preview } : {}),
      rosters: s.rosters,
      depth: s.depth,
      eventCount: s.log.length,
      features: { ...config.flags, ttsServer: !!config.elevenLabsKey && config.flags.tts === true },
    };
    return c.json(detail);
  });

  app.get('/api/games/:id/events', async (c) => {
    const s = await registry.get(c.req.param('id'));
    if (!s) return c.json({ error: 'game not found' }, 404);
    const from = Math.max(0, Number(c.req.query('from')) || 0);
    const events = s.log.from(from);
    const body: EventsResponse = { gameId: s.gameId, events, next: s.log.length };
    return c.json(body);
  });

  app.get('/api/games/:id/stream', async (c) => {
    const s = await registry.get(c.req.param('id'));
    if (!s) return c.json({ error: 'game not found' }, 404);
    return streamGame(c, s);
  });

  adminRoutes(app, deps);
  ttsRoutes(app, config);
  chatRoutes(app, deps);
  deps.extend?.(app);

  // Serve the built web app (single deploy) with SPA fallback.
  app.get('*', (c) => {
    if (c.req.path.startsWith('/api/')) return c.json({ error: 'not found' }, 404);
    const rel = normalize(c.req.path).replace(/^(\.\.[/\\])+/, '');
    let file = join(config.webDist, rel);
    if (
      !file.startsWith(config.webDist) ||
      !existsSync(file) ||
      rel === '/' ||
      !/\.[a-z0-9]+$/i.test(rel)
    ) {
      file = join(config.webDist, 'index.html');
    }
    if (!existsSync(file))
      return c.text('Web app not built. Run `pnpm build` or use `pnpm dev`.', 404);
    const ext = file.slice(file.lastIndexOf('.'));
    return c.body(readFileSync(file), 200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      ...(ext !== '.html' ? { 'cache-control': 'public, max-age=31536000, immutable' } : {}),
    });
  });

  return app;
}
