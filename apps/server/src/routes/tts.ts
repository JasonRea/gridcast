/**
 * POST /api/tts: announcer audio from ElevenLabs, proxied so the key never reaches the browser.
 * Live requests use the fast model; `pnpm pregen` renders a finished game ahead of time with the
 * higher-quality model into the same cache, and the route serves that first. Without
 * ELEVENLABS_API_KEY the route returns 404 and the web app uses browser speech instead.
 *
 * Voices are just IDs from the environment. Gridcast never clones a voice.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { TtsRequestSchema } from '@gridcast/types';
import type { Config } from '../config.ts';
import type { Fetcher } from '../util/fetchJson.ts';
import { log } from '../util/logger.ts';

export type Voice = 'pbp' | 'color';

export type TtsSettings = {
  voices: Record<Voice, string>;
  liveModel: string;
  pregenModel: string;
  /** Calm, steady network delivery: high stability, a little slower than default. */
  voiceSettings: { stability: number; similarity_boost: number; style: number; speed: number };
};

/** ElevenLabs premade voices until ELEVENLABS_PBP_VOICE / ELEVENLABS_COLOR_VOICE are set. */
const DEFAULT_VOICES: Record<Voice, string> = {
  pbp: 'pNInz6obpgDQGcFmaJgB',
  color: 'ErXwobaYiN019PkySvjV',
};

const num = (v: string | undefined, d: number) =>
  v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d;

export function ttsSettings(env: NodeJS.ProcessEnv = process.env): TtsSettings {
  return {
    voices: {
      pbp: env.ELEVENLABS_PBP_VOICE || DEFAULT_VOICES.pbp,
      color: env.ELEVENLABS_COLOR_VOICE || DEFAULT_VOICES.color,
    },
    liveModel: env.ELEVENLABS_LIVE_MODEL || 'eleven_flash_v2_5',
    pregenModel: env.ELEVENLABS_PREGEN_MODEL || 'eleven_multilingual_v2',
    voiceSettings: {
      stability: num(env.ELEVENLABS_STABILITY, 0.6),
      similarity_boost: num(env.ELEVENLABS_SIMILARITY, 0.8),
      style: num(env.ELEVENLABS_STYLE, 0.15),
      speed: num(env.ELEVENLABS_SPEED, 0.95),
    },
  };
}

/** Cache file for one rendering. Model and voice ID are in the key, so a voice swap never reuses audio. */
export function ttsCachePath(
  cacheDir: string,
  model: string,
  voiceId: string,
  text: string,
): string {
  const key = createHash('sha1').update(`${model}:${voiceId}:${text}`).digest('hex');
  return join(cacheDir, 'tts', `${key}.mp3`);
}

/**
 * Renders one line (or returns it from the cache). Returns undefined on any upstream failure.
 * Used by the route (live model) and by `pnpm pregen` (pregen model).
 */
export async function synthesize(opts: {
  apiKey: string;
  cacheDir: string;
  settings: TtsSettings;
  voice: Voice;
  text: string;
  model: string;
  fetcher?: Fetcher;
}): Promise<Buffer | undefined> {
  const voiceId = opts.settings.voices[opts.voice];
  const file = ttsCachePath(opts.cacheDir, opts.model, voiceId, opts.text);
  if (existsSync(file)) return readFileSync(file);
  try {
    const res = await (opts.fetcher ?? fetch)(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_64`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': opts.apiKey,
          'content-type': 'application/json',
          accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text: opts.text,
          model_id: opts.model,
          voice_settings: opts.settings.voiceSettings,
        }),
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!res.ok) {
      log.warn('tts upstream error', { status: res.status, model: opts.model });
      return undefined;
    }
    const audio = Buffer.from(await res.arrayBuffer());
    mkdirSync(join(opts.cacheDir, 'tts'), { recursive: true });
    writeFileSync(file, audio);
    return audio;
  } catch (e) {
    log.warn('tts failed', { error: (e as Error).message });
    return undefined;
  }
}

export function ttsRoutes(app: Hono, config: Config, fetcher: Fetcher = fetch) {
  const settings = ttsSettings();

  app.post('/api/tts', async (c) => {
    if (!config.elevenLabsKey || !config.flags.tts) return c.json({ error: 'tts disabled' }, 404);
    const parsed = TtsRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'invalid body' }, 400);
    const { text, voice } = parsed.data;
    // Pre-rendered (higher-quality) audio wins; otherwise render live with the fast model.
    const pregen = ttsCachePath(
      config.cacheDir,
      settings.pregenModel,
      settings.voices[voice],
      text,
    );
    const audio = existsSync(pregen)
      ? readFileSync(pregen)
      : await synthesize({
          apiKey: config.elevenLabsKey,
          cacheDir: config.cacheDir,
          settings,
          voice,
          text,
          model: settings.liveModel,
          fetcher,
        });
    if (!audio) return c.json({ error: 'tts upstream error' }, 502);
    return c.body(new Uint8Array(audio), 200, { 'content-type': 'audio/mpeg' });
  });
}
