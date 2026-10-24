import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createEspnClient } from './espn/client.ts';
import { GameRegistry } from './games/registry.ts';
import { ScoreboardService } from './games/scoreboard.ts';
import { log } from './util/logger.ts';

const config = loadConfig();
const espn = createEspnClient({ fixturesDir: config.fixturesDir, offline: config.offline });
const registry = new GameRegistry(config, espn);
const scoreboard = new ScoreboardService(espn, config);

const app = createApp({ config, registry, scoreboard });

// Warm the demo and featured games so the first page load is instant.
void registry.get(config.demoGameId);
void registry.get(config.featuredGameId);

serve({ fetch: app.fetch, port: config.port }, () => {
  log.info(`gridcast server on :${config.port}`, {
    offline: config.offline,
    featured: config.featuredGameId,
    demo: config.demoGameId,
  });
});
