/**
 * GET /api/sfx/:name: short sound effects for Access mode, generated once with the ElevenLabs
 * sound-effects API and cached on disk. Without ELEVENLABS_API_KEY (or on an upstream failure) it
 * returns 204 No Content and the web app synthesizes the sound itself; 204 keeps the browser
 * console clean. Only the named effects below exist; prompts never come
 * from the browser.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Hono } from 'hono';
import type { Config } from '../config.ts';
import type { Fetcher } from '../util/fetchJson.ts';
import { log } from '../util/logger.ts';

export const SFX: Record<string, { text: string; seconds: number }> = {
  touchdown: {
    text: 'Huge American football stadium crowd erupting in a roar and cheering after a touchdown, no music, no announcer',
    seconds: 4,
  },
};

export function sfxRoutes(app: Hono, config: Config, fetcher: Fetcher = fetch) {
  const inflight = new Map<string, Promise<Buffer | undefined>>();

  async function render(name: string): Promise<Buffer | undefined> {
    const spec = SFX[name]!;
    const file = join(config.cacheDir, 'sfx', `${name}.mp3`);
    if (existsSync(file)) return readFileSync(file);
    if (!config.elevenLabsKey) return undefined;
    try {
      const res = await fetcher('https://api.elevenlabs.io/v1/sound-generation', {
        method: 'POST',
        headers: {
          'xi-api-key': config.elevenLabsKey,
          'content-type': 'application/json',
          accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text: spec.text,
          duration_seconds: spec.seconds,
          prompt_influence: 0.5,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        log.warn('sfx upstream error', { status: res.status, name });
        return undefined;
      }
      const audio = Buffer.from(await res.arrayBuffer());
      mkdirSync(join(config.cacheDir, 'sfx'), { recursive: true });
      writeFileSync(file, audio);
      return audio;
    } catch (e) {
      log.warn('sfx failed', { error: (e as Error).message, name });
      return undefined;
    }
  }

  app.get('/api/sfx/:name', async (c) => {
    const name = c.req.param('name');
    if (!SFX[name]) return c.json({ error: 'unknown effect' }, 404);
    let p = inflight.get(name);
    if (!p) {
      p = render(name).finally(() => inflight.delete(name));
      inflight.set(name, p);
    }
    const audio = await p;
    if (!audio) return c.body(null, 204);
    return c.body(new Uint8Array(audio), 200, {
      'content-type': 'audio/mpeg',
      'cache-control': 'public, max-age=86400',
    });
  });
}
