/**
 * POST /api/tts: announcer audio from ElevenLabs, proxied so the key never reaches the browser.
 * Cached on disk by voice + text. Without ELEVENLABS_API_KEY the route returns 404 and the web
 * app uses the browser's speechSynthesis instead.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { TtsRequestSchema } from '@gridcast/types';
import type { Config } from '../config.ts';
import type { Fetcher } from '../util/fetchJson.ts';
import { log } from '../util/logger.ts';

/** ElevenLabs premade voices; override with ELEVENLABS_PBP_VOICE / ELEVENLABS_COLOR_VOICE. */
const DEFAULT_VOICES = { pbp: 'pNInz6obpgDQGcFmaJgB', color: 'ErXwobaYiN019PkySvjV' };

export function ttsRoutes(app: Hono, config: Config, fetcher: Fetcher = fetch) {
  const voices = {
    pbp: process.env.ELEVENLABS_PBP_VOICE ?? DEFAULT_VOICES.pbp,
    color: process.env.ELEVENLABS_COLOR_VOICE ?? DEFAULT_VOICES.color,
  };
  const dir = join(config.cacheDir, 'tts');

  app.post('/api/tts', async (c) => {
    if (!config.elevenLabsKey || !config.flags.tts) return c.json({ error: 'tts disabled' }, 404);
    const parsed = TtsRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'invalid body' }, 400);
    const { text, voice } = parsed.data;
    const key = createHash('sha1').update(`${voice}:${text}`).digest('hex');
    const file = join(dir, `${key}.mp3`);
    if (existsSync(file)) return c.body(readFileSync(file), 200, { 'content-type': 'audio/mpeg' });
    try {
      const res = await fetcher(
        `https://api.elevenlabs.io/v1/text-to-speech/${voices[voice]}?output_format=mp3_44100_64`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': config.elevenLabsKey,
            'content-type': 'application/json',
            accept: 'audio/mpeg',
          },
          body: JSON.stringify({ text, model_id: 'eleven_flash_v2_5' }),
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!res.ok) {
        log.warn('tts upstream error', { status: res.status });
        return c.json({ error: 'tts upstream error' }, 502);
      }
      const audio = Buffer.from(await res.arrayBuffer());
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, audio);
      return c.body(audio, 200, { 'content-type': 'audio/mpeg' });
    } catch (e) {
      log.warn('tts failed', { error: (e as Error).message });
      return c.json({ error: 'tts failed' }, 502);
    }
  });
}
