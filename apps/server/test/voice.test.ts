import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { Commentary, GameEvent, PlayEvent } from '@gridcast/types';
import { CommentaryCache, COMMENTARY_STYLE } from '../src/commentary/cache.ts';
import { SYSTEM_PROMPT } from '../src/commentary/claude.ts';
import { allowedVocabulary, buildPlayContext } from '../src/commentary/context.ts';
import { grounded } from '../src/commentary/grounding.ts';
import { teamNames } from '../src/commentary/service.ts';
import { synthesize, ttsCachePath, ttsRoutes, ttsSettings } from '../src/routes/tts.ts';
import { DEMO, testConfig, testServer } from './helpers.ts';

async function demo() {
  const s = (await testServer().registry.get(DEMO))!;
  const events: GameEvent[] = s.log.all().map((e) => e.event);
  const lineFor = (text: string) => {
    const i = events.findIndex((e) => e.kind === 'play' && e.raw.text.includes(text));
    return {
      play: events[i] as PlayEvent,
      pbp: (
        events
          .slice(i + 1, i + 3)
          .find((e) => e.kind === 'commentary' && e.voice === 'pbp') as Commentary
      ).text,
    };
  };
  return { s, events, lineFor };
}

describe('network-style play-by-play', () => {
  it('the prompt asks for economical calls and restraint', () => {
    expect(SYSTEM_PROMPT).toMatch(/Economical and present tense/);
    expect(SYSTEM_PROMPT).toMatch(/Under 20 words/);
    expect(SYSTEM_PROMPT).toMatch(/No hype words/);
  });

  it('templates: routine plain, situation on third down, big moments short', async () => {
    const { lineFor } = await demo();
    expect(lineFor('left guard to TB 33').pbp).toBe(
      'Irving around the left side, picks up 3 yards.',
    );
    expect(lineFor('A.Rodgers pass short right to G.Bernard to TB 42').pbp).toMatch(
      /^Third and 7\. Rodgers to Bernard/,
    );
    expect(lineFor('G.Bernard for 6 yards, TOUCHDOWN').pbp).toBe('Rodgers to Bernard. Touchdown.');
    expect(lineFor('58 yard field goal').pbp).toBe("Boswell from 58. It's good.");
  });

  it('no exclamation marks on any template line, and every line passes the grounding check', async () => {
    const { s, events } = await demo();
    for (const [i, e] of events.entries()) {
      if (e.kind !== 'commentary' || e.voice !== 'pbp') continue;
      expect(e.text).not.toMatch(/!/);
      const play = events
        .slice(0, i)
        .reverse()
        .find((x): x is PlayEvent => x.kind === 'play' && x.id === e.playId);
      if (!play) continue;
      const ctx = buildPlayContext(play, events.slice(0, i), teamNames(s));
      expect(
        grounded(e.text, ctx, allowedVocabulary(ctx, s.rosters, teamNames(s))),
        e.text,
      ).toEqual({ ok: true });
    }
  });

  it('cached lines from an older style are ignored', () => {
    const cfg = testConfig();
    const cache = new CommentaryCache(cfg.cacheDir, cfg.assetsDir, false);
    cache.set('g', 'p1', { pbp: 'new', source: 'claude' });
    expect(cache.get('g', 'p1')?.style).toBe(COMMENTARY_STYLE);
    // Simulate an old entry without a style tag.
    (cache as unknown as { maps: Map<string, Record<string, unknown>> }).maps.get('g')!.p2 = {
      pbp: 'old',
      source: 'claude',
    };
    expect(cache.get('g', 'p2')).toBeUndefined();
    expect(Object.keys(cache.all('g'))).toEqual(['p1']);
  });
});

describe('TTS models', () => {
  const settings = ttsSettings({});

  it('live requests use the fast model with steady voice settings', async () => {
    let body: Record<string, unknown> = {};
    const fetcher = async (_u: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(new Uint8Array([7]));
    };
    const app = new Hono();
    ttsRoutes(app, { ...testConfig(), elevenLabsKey: 'k' }, fetcher);
    const res = await app.request('/api/tts', {
      method: 'POST',
      body: JSON.stringify({ text: 'Third and 7.', voice: 'pbp' }),
    });
    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      model_id: 'eleven_flash_v2_5',
      voice_settings: { stability: 0.6, speed: 0.95 },
    });
  });

  it('pre-rendered audio is served first, without calling ElevenLabs', async () => {
    const cfg = { ...testConfig(), elevenLabsKey: 'k' };
    const file = ttsCachePath(
      cfg.cacheDir,
      settings.pregenModel,
      settings.voices.pbp,
      'It is good.',
    );
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, new Uint8Array([9, 9]));
    let calls = 0;
    const app = new Hono();
    ttsRoutes(app, cfg, async () => {
      calls++;
      return new Response(new Uint8Array([1]));
    });
    const res = await app.request('/api/tts', {
      method: 'POST',
      body: JSON.stringify({ text: 'It is good.', voice: 'pbp' }),
    });
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([9, 9]));
    expect(calls).toBe(0);
  });

  it('pregen renders with the higher-quality model and caches per model and voice', async () => {
    const cfg = testConfig();
    let model = '';
    const fetcher = async (_u: string, init?: RequestInit) => {
      model = String((JSON.parse(String(init?.body)) as { model_id: string }).model_id);
      return new Response(new Uint8Array([5]));
    };
    const audio = await synthesize({
      apiKey: 'k',
      cacheDir: cfg.cacheDir,
      settings,
      voice: 'color',
      text: 'Line.',
      model: settings.pregenModel,
      fetcher,
    });
    expect(audio).toBeDefined();
    expect(model).toBe('eleven_multilingual_v2');
    expect(
      existsSync(ttsCachePath(cfg.cacheDir, settings.pregenModel, settings.voices.color, 'Line.')),
    ).toBe(true);
    expect(
      existsSync(ttsCachePath(cfg.cacheDir, settings.liveModel, settings.voices.color, 'Line.')),
    ).toBe(false);
  });

  it('voice IDs come from the environment', () => {
    expect(ttsSettings({ ELEVENLABS_PBP_VOICE: 'abc' }).voices.pbp).toBe('abc');
  });
});
