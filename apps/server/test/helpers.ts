import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.ts';
import { loadConfig, type Config } from '../src/config.ts';
import { createEspnClient } from '../src/espn/client.ts';
import { GameRegistry } from '../src/games/registry.ts';
import { ScoreboardService } from '../src/games/scoreboard.ts';

export const DEMO = '401873002';
export const FEATURED = '401873011';

/** Offline config with a throwaway data dir: tests only ever read saved fixtures. */
export function testConfig(over: Partial<Config> = {}): Config {
  const dataDir = mkdtempSync(join(tmpdir(), 'gridcast-test-'));
  const base = loadConfig({ GRIDCAST_OFFLINE: '1', DATA_DIR: dataDir, ADMIN_TOKEN: 'secret' });
  return { ...base, ...over };
}

export function testServer(over: Partial<Config> = {}) {
  const config = testConfig(over);
  const espn = createEspnClient({ fixturesDir: config.fixturesDir, offline: true });
  const registry = new GameRegistry(config, espn);
  const scoreboard = new ScoreboardService(espn, config);
  const app = createApp({ config, registry, scoreboard });
  return { config, espn, registry, scoreboard, app };
}
