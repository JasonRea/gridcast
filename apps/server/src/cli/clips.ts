/**
 * `pnpm clips:backfill <gameId> [--write]`: finds official X highlight clips for a finished
 * game's big plays (trusted accounts only, see clips/poller.ts) and prints them as JSON.
 * With --write, saves them to data/assets/clips/<gameId>.json so they ship with the app and
 * outlive X's 7-day search window (commit the file). Needs X_BEARER_TOKEN. Uses X credits:
 * up to 3 searches of 100 posts.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PlayEvent } from '@gridcast/types';
import { ClipPoller } from '../clips/poller.ts';
import { loadConfig } from '../config.ts';
import { createServices } from '../services.ts';

const args = process.argv.slice(2);
const config = loadConfig();
const gameId = args.find((a) => !a.startsWith('--')) ?? config.demoGameId;
if (!config.xBearer) {
  console.error('Set X_BEARER_TOKEN to search X.');
  process.exit(1);
}
// Our own poller: the services' automatic backfill stays off so this is the only search.
const { registry } = createServices({ ...config, flags: { ...config.flags, clips: false } });
const session = await registry.get(gameId);
if (!session || session.status !== 'final') {
  console.error(`Game ${gameId} not found or not finished.`);
  process.exit(1);
}
const clips = await new ClipPoller(registry, { bearer: config.xBearer }).findClips(session);
if (!clips) {
  console.error('Search failed, or the game is older than X recent search reaches (7 days).');
  process.exit(1);
}
const plays = new Map(
  session.log
    .all()
    .flatMap((e) => (e.event.kind === 'play' ? [[e.event.id, e.event as PlayEvent]] : [])) as [
    string,
    PlayEvent,
  ][],
);
for (const c of clips) {
  const p = plays.get(c.playId);
  console.error(
    `${p ? `Q${p.pre.quarter} ${p.pre.clock}` : c.playId}  ${c.url}  ${p?.raw.text.slice(0, 70) ?? ''}`,
  );
}
console.error(`${clips.length} clips on big plays.`);
const json = JSON.stringify(clips, null, 1) + '\n';
if (args.includes('--write')) {
  const dir = join(config.assetsDir, 'clips');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${gameId}.json`), json);
  console.error(`Saved data/assets/clips/${gameId}.json (commit it).`);
} else {
  process.stdout.write(json);
}
process.exit(0);
