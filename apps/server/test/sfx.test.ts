import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { sfxRoutes } from '../src/routes/sfx.ts';
import { testConfig } from './helpers.ts';

describe('Access mode sound effects', () => {
  it('answers 204 without an ElevenLabs key so the browser synthesizes the roar', async () => {
    const app = new Hono();
    sfxRoutes(app, testConfig());
    expect((await app.request('/api/sfx/touchdown')).status).toBe(204);
  });

  it('generates a named effect once, then serves it from the cache', async () => {
    let calls = 0;
    let body: Record<string, unknown> = {};
    const fetcher = async (_u: string, init?: RequestInit) => {
      calls++;
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(new Uint8Array([1, 2, 3]));
    };
    const app = new Hono();
    sfxRoutes(app, testConfig({ elevenLabsKey: 'k' }), fetcher);
    const a = await app.request('/api/sfx/touchdown');
    expect(a.status).toBe(200);
    expect(a.headers.get('content-type')).toBe('audio/mpeg');
    expect(new Uint8Array(await a.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(body.text).toMatch(/crowd/);
    await app.request('/api/sfx/touchdown');
    expect(calls).toBe(1);
  });

  it('only serves named effects: prompts never come from the browser', async () => {
    const app = new Hono();
    sfxRoutes(app, testConfig({ elevenLabsKey: 'k' }), async () => new Response('x'));
    expect((await app.request('/api/sfx/anything-else')).status).toBe(404);
  });
});
