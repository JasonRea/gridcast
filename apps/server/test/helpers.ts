import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.ts';
import type { Writer } from '../src/commentary/claude.ts';
import { loadConfig, type Config } from '../src/config.ts';
import { createServices } from '../src/services.ts';

export const DEMO = '401873002';
export const FEATURED = '401873011';

/** Offline config with a throwaway data dir: tests only ever read saved fixtures. */
export function testConfig(over: Partial<Config> = {}): Config {
  const dataDir = mkdtempSync(join(tmpdir(), 'gridcast-test-'));
  const base = loadConfig({ GRIDCAST_OFFLINE: '1', DATA_DIR: dataDir, ADMIN_TOKEN: 'secret' });
  return { ...base, ...over };
}

export function testServer(over: Partial<Config> = {}, opts: { writer?: Writer | null } = {}) {
  const config = testConfig(over);
  const services = createServices(config, { writer: opts.writer ?? null });
  const app = createApp(services);
  return { ...services, app };
}
