import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { ChatMessageSchema, type ChatMessage } from '@gridcast/types';
import { loadConfig } from '../src/config.ts';
import { chatRoutes } from '../src/routes/chat.ts';
import { keepsNumbers, translateRoutes } from '../src/routes/translate.ts';
import { DEMO, testConfig, testServer } from './helpers.ts';

type Body = { contents: { role: string; parts: Record<string, unknown>[] }[]; tools?: unknown };

/** Fake Gemini: first asks for a tool, then answers citing a play. */
function fakeGemini() {
  const bodies: Body[] = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Body;
    bodies.push(body);
    expect(url).toMatch(/models\/gemini-3\.6-flash:generateContent$/);
    expect((init?.headers as Record<string, string>)['x-goog-api-key']).toBe('g');
    const parts =
      bodies.length === 1
        ? [
            {
              functionCall: { id: 'c1', name: 'get_plays', args: { quarter: 5, type: 'pass' } },
              thoughtSignature: 'sig-1',
            },
          ]
        : [{ text: 'Rodgers found Bernard for the overtime touchdown [OT 3:15].' }];
    return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts } }] }));
  };
  return { bodies, fetcher };
}

async function readSse(res: Response): Promise<ChatMessage[]> {
  const text = await res.text();
  return text
    .split('\n')
    .filter((l) => l.startsWith('data: '))
    .map((l) => ChatMessageSchema.parse(JSON.parse(l.slice(6))));
}

describe('provider choice', () => {
  it('prefers Gemini when its key is set, Claude otherwise, none without keys', () => {
    expect(loadConfig({ GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a' }).chatProvider).toBe('gemini');
    expect(
      loadConfig({ GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a', CHAT_PROVIDER: 'claude' })
        .chatProvider,
    ).toBe('claude');
    expect(loadConfig({ ANTHROPIC_API_KEY: 'a' }).chatProvider).toBe('claude');
    expect(loadConfig({}).chatProvider).toBeUndefined();
    expect(loadConfig({}).flags.chat).toBe(false);
    expect(loadConfig({ GEMINI_API_KEY: 'g' }).flags.translate).toBe(true);
  });
});

describe('the booth on Gemini', () => {
  it('runs the game tools and returns the model turn verbatim (thought signature kept)', async () => {
    const { registry } = testServer();
    const config = testConfig({ geminiKey: 'g', chatProvider: 'gemini' });
    config.flags.chat = true;
    const { bodies, fetcher } = fakeGemini();
    const app = new Hono();
    chatRoutes(app, { config, registry, fetcher });
    const res = await app.request(`/api/games/${DEMO}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'How did they win in overtime?' }),
    });
    const msgs = await readSse(res);
    expect(msgs).toContainEqual({ type: 'tool', name: 'get_plays' });
    expect(msgs.find((m) => m.type === 'delta')).toMatchObject({ text: /\[OT 3:15\]/ });
    expect(msgs.at(-1)).toEqual({ type: 'done' });
    // Second request: model turn echoed with its signature, then the tool result.
    const second = bodies[1]!.contents;
    expect(second.at(-2)!.parts[0]).toMatchObject({ thoughtSignature: 'sig-1' });
    const fr = second.at(-1)!.parts[0]!.functionResponse as {
      id: string;
      name: string;
      response: { result: unknown[] };
    };
    expect(fr).toMatchObject({ id: 'c1', name: 'get_plays' });
    expect(Array.isArray(fr.response.result)).toBe(true);
  });

  it('an overloaded model falls back, and the conversation stays on the model that answered', async () => {
    const { registry } = testServer();
    const config = testConfig({ geminiKey: 'g', chatProvider: 'gemini' });
    config.flags.chat = true;
    const urls: string[] = [];
    let answered = 0;
    const fetcher = async (url: string) => {
      urls.push(url);
      if (url.includes('gemini-3.6-flash')) return new Response('busy', { status: 503 });
      answered++;
      const parts =
        answered === 1
          ? [
              {
                functionCall: { id: 'c1', name: 'get_game_state', args: {} },
                thoughtSignature: 's',
              },
            ]
          : [{ text: 'Pittsburgh won 26-19 in overtime.' }];
      return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts } }] }));
    };
    const app = new Hono();
    chatRoutes(app, { config, registry, fetcher });
    const res = await app.request(`/api/games/${DEMO}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Final score?' }),
    });
    const msgs = await readSse(res);
    expect(msgs.find((m) => m.type === 'delta')).toMatchObject({ text: /26-19/ });
    expect(urls.map((u) => /models\/([^:]+):/.exec(u)![1])).toEqual([
      'gemini-3.6-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.5-flash-lite',
    ]);
  });

  it('a failed Gemini call ends with a short error, not a crash', async () => {
    const { registry } = testServer();
    const config = testConfig({ geminiKey: 'g', chatProvider: 'gemini' });
    config.flags.chat = true;
    const app = new Hono();
    chatRoutes(app, {
      config,
      registry,
      fetcher: async () => new Response('nope', { status: 500 }),
    });
    const res = await app.request(`/api/games/${DEMO}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Hi' }),
    });
    const msgs = await readSse(res);
    expect(msgs.some((m) => m.type === 'error')).toBe(true);
    expect(msgs.at(-1)).toEqual({ type: 'done' });
  });
});

describe('commentary translation', () => {
  const post = (app: Hono, body: unknown) =>
    app.request('/api/translate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('is off without a key', async () => {
    const app = new Hono();
    translateRoutes(app, testConfig());
    expect((await post(app, { lang: 'fr', texts: ['Touchdown.'] })).status).toBe(404);
  });

  it('translates once, caches, and keeps English when a number changes', async () => {
    let calls = 0;
    const fetcher = async () => {
      calls++;
      const out = ['Rodgers trouve Bernard. Touchdown.', 'Warren gagne 4 yards.'];
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }],
        }),
      );
    };
    const config = testConfig({ geminiKey: 'g' });
    config.flags.translate = true;
    const app = new Hono();
    translateRoutes(app, config, fetcher);
    const texts = ['Rodgers to Bernard. Touchdown.', 'Warren picks up 3 yards.'];
    const a = (await (await post(app, { lang: 'fr', texts })).json()) as { texts: string[] };
    expect(a.texts[0]).toBe('Rodgers trouve Bernard. Touchdown.');
    // "3 yards" came back as "4 yards": rejected, English kept.
    expect(a.texts[1]).toBe('Warren picks up 3 yards.');
    await post(app, { lang: 'fr', texts });
    expect(calls).toBe(1);
  });

  it('number check', () => {
    expect(keepsNumbers('Third and 7 at the 35', 'Troisième et 7 sur la 35')).toBe(true);
    expect(keepsNumbers('A 58 yard field goal', 'Un field goal de 85 yards')).toBe(false);
  });
});
