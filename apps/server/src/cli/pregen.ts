/**
 * `pnpm pregen <gameId>`: prepares a finished game so the demo never waits on an API.
 * 1. With ANTHROPIC_API_KEY: generates Claude commentary for every play and stoppage and saves it
 *    to data/assets/commentary/<gameId>.json (commit it).
 * 2. With ELEVENLABS_API_KEY: renders every announcer line with the higher-quality model into the
 *    TTS cache, which /api/tts serves before falling back to the live model.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Commentary } from '@gridcast/types';
import { loadConfig } from '../config.ts';
import { synthesize, ttsSettings } from '../routes/tts.ts';
import { createServices } from '../services.ts';

const config = loadConfig();
const gameId = process.argv[2] ?? config.demoGameId;
if (!config.anthropicKey && !config.elevenLabsKey) {
  console.error(
    'Set ANTHROPIC_API_KEY (commentary) and/or ELEVENLABS_API_KEY (audio) to pre-generate.',
  );
  process.exit(1);
}
const { registry, commentary } = createServices(config);
const session = await registry.get(gameId);
if (!session) {
  console.error(`No game ${gameId}.`);
  process.exit(1);
}

if (config.anthropicKey) {
  const lines = await commentary.pregenerate(session);
  const out = join(config.assetsDir, 'commentary', `${gameId}.json`);
  mkdirSync(join(config.assetsDir, 'commentary'), { recursive: true });
  writeFileSync(out, JSON.stringify(lines, null, 1) + '\n');
  await registry.refresh(gameId);
  console.log(
    `Saved ${Object.keys(lines).length} lines to ${out} (${commentary.calls} Claude calls).`,
  );
} else {
  console.log('No ANTHROPIC_API_KEY: skipping Claude commentary, rendering the template lines.');
}

if (config.elevenLabsKey) {
  const settings = ttsSettings();
  const lines = session.log
    .all()
    .flatMap((e) => (e.event.kind === 'commentary' ? [e.event as Commentary] : []))
    .filter((c) => c.text.trim());
  let ok = 0;
  for (const [i, line] of lines.entries()) {
    const audio = await synthesize({
      apiKey: config.elevenLabsKey,
      cacheDir: config.cacheDir,
      settings,
      voice: line.voice,
      text: line.text,
      model: settings.pregenModel,
    });
    if (audio) ok++;
    if ((i + 1) % 25 === 0) console.log(`  audio ${i + 1}/${lines.length}`);
  }
  console.log(
    `Rendered ${ok}/${lines.length} lines with ${settings.pregenModel} into ${join(config.cacheDir, 'tts')}.`,
  );
} else {
  console.log('No ELEVENLABS_API_KEY: skipping audio.');
}
