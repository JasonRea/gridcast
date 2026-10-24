import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { ttsRoutes } from '../src/routes/tts.ts';
import { testConfig } from './helpers.ts';

const body = JSON.stringify({ text: 'Touchdown Steelers!', voice: 'pbp' });

describe('POST /api/tts', () => {
  it('is off without an ElevenLabs key (browser speech takes over)', async () => {
    const app = new Hono();
    ttsRoutes(app, testConfig());
    expect((await app.request('/api/tts', { method: 'POST', body })).status).toBe(404);
  });

  it('proxies ElevenLabs once and serves repeats from the cache', async () => {
    let calls = 0;
    const fetcher = async (url: string, init?: RequestInit) => {
      calls++;
      expect(url).toContain('api.elevenlabs.io/v1/text-to-speech/');
      expect((init?.headers as Record<string, string>)['xi-api-key']).toBe('k');
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/mpeg' } });
    };
    const app = new Hono();
    ttsRoutes(app, { ...testConfig(), elevenLabsKey: 'k' }, fetcher);
    for (let i = 0; i < 2; i++) {
      const res = await app.request('/api/tts', { method: 'POST', body });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('audio/mpeg');
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    }
    expect(calls).toBe(1);
  });
});
