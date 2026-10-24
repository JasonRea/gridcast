import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createServices } from './services.ts';
import { log } from './util/logger.ts';

const config = loadConfig();
const services = createServices(config);
const app = createApp(services);

// Warm the demo and featured games so the first page load is instant.
void services.registry.get(config.demoGameId);
void services.registry.get(config.featuredGameId);

services.odds.start();
if (!config.offline) {
  services.live.start();
  services.clips?.start();
}

serve({ fetch: app.fetch, port: config.port }, () => {
  log.info(`gridcast server on :${config.port}`, {
    offline: config.offline,
    featured: config.featuredGameId,
    demo: config.demoGameId,
    commentary: services.commentary.usesClaude ? config.commentaryModel : 'templates',
  });
});
