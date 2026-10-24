/**
 * `pnpm pregen <gameId>`: generates Claude commentary for every play and stoppage of a finished
 * game and saves it to data/assets/commentary/<gameId>.json, which is committed so the demo never
 * depends on Claude at show time.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../config.ts';
import { createServices } from '../services.ts';

const config = loadConfig();
const gameId = process.argv[2] ?? config.demoGameId;
if (!config.anthropicKey) {
  console.error('Set ANTHROPIC_API_KEY to pre-generate Claude commentary.');
  process.exit(1);
}
const { registry, commentary } = createServices(config);
const session = await registry.get(gameId);
if (!session) {
  console.error(`No game ${gameId}.`);
  process.exit(1);
}
const lines = await commentary.pregenerate(session);
const out = join(config.assetsDir, 'commentary', `${gameId}.json`);
mkdirSync(join(config.assetsDir, 'commentary'), { recursive: true });
writeFileSync(out, JSON.stringify(lines, null, 1) + '\n');
await registry.refresh(gameId);
console.log(
  `Saved ${Object.keys(lines).length} lines to ${out} (${commentary.calls} Claude calls).`,
);
