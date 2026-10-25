/**
 * POST /api/translate: commentary lines in another language (A3). Gemini translates (Claude when
 * only ANTHROPIC_API_KEY is set). Results are cached per language on disk, so a replay never
 * re-translates a line. Grounding: a translated line must keep every number of the original;
 * otherwise the English line is returned. Off (404) with neither key or FLAG_TRANSLATE=0.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import type { Hono } from 'hono';
import { z } from 'zod';
import { TranslateRequestSchema, type Language, type TranslateResponse } from '@gridcast/types';
import type { Config } from '../config.ts';
import { geminiGenerate } from '../llm/gemini.ts';
import type { Fetcher } from '../util/fetchJson.ts';
import { log } from '../util/logger.ts';

export const LANGUAGE_NAMES: Record<Language, string> = {
  fr: 'French',
  es: 'Spanish',
  de: 'German',
  pt: 'Brazilian Portuguese',
};

export function translatePrompt(lang: Language): string {
  return `You translate live NFL broadcast commentary into ${LANGUAGE_NAMES[lang]}, as a native ${LANGUAGE_NAMES[lang]}-speaking play-by-play announcer would say it.
Rules: keep player names, team names and every number exactly as written. Keep it short and in the present tense. Add nothing that is not in the line.
Input is a JSON array of English lines. Reply with only a JSON array of the translated lines, same length and order.`;
}

/** Every number in the source must survive translation (no invented or dropped facts). */
export function keepsNumbers(src: string, out: string): boolean {
  const nums = (s: string) => (s.match(/\d+/g) ?? []).sort().join(',');
  return nums(src) === nums(out);
}

const LinesSchema = z.array(z.string());

function parseLines(text: string, n: number): string[] | undefined {
  const m = /\[[\s\S]*\]/.exec(text);
  if (!m) return undefined;
  try {
    const p = LinesSchema.safeParse(JSON.parse(m[0]));
    return p.success && p.data.length === n ? p.data : undefined;
  } catch {
    return undefined;
  }
}

export function translateRoutes(app: Hono, config: Config, fetcher?: Fetcher) {
  const claude =
    !config.geminiKey && config.anthropicKey
      ? new Anthropic({ apiKey: config.anthropicKey, maxRetries: 1 })
      : undefined;
  const caches = new Map<Language, Record<string, string>>();
  const file = (lang: Language) => join(config.cacheDir, 'translate', `${lang}.json`);
  const cacheFor = (lang: Language) => {
    let c = caches.get(lang);
    if (!c) {
      try {
        c = existsSync(file(lang))
          ? (JSON.parse(readFileSync(file(lang), 'utf8')) as Record<string, string>)
          : {};
      } catch {
        c = {};
      }
      caches.set(lang, c);
    }
    return c;
  };

  async function upstream(lang: Language, texts: string[]): Promise<string[] | undefined> {
    const input = JSON.stringify(texts);
    if (config.geminiKey) {
      const r = await geminiGenerate({
        apiKey: config.geminiKey,
        model: config.geminiTranslateModel,
        fallbacks: config.geminiFallbackModels,
        system: translatePrompt(lang),
        contents: [{ role: 'user', parts: [{ text: input }] }],
        json: true,
        timeoutMs: 15_000,
        ...(config.geminiBase ? { base: config.geminiBase } : {}),
        ...(fetcher ? { fetcher } : {}),
      });
      return r ? parseLines(r.text, texts.length) : undefined;
    }
    if (!claude) return undefined;
    try {
      const msg = await claude.messages.create({
        model: config.commentaryModel,
        max_tokens: 1500,
        system: translatePrompt(lang),
        messages: [{ role: 'user', content: input }],
      });
      const text = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      return parseLines(text, texts.length);
    } catch (e) {
      log.warn('translate failed', { error: (e as Error).message });
      return undefined;
    }
  }

  app.post('/api/translate', async (c) => {
    if (!config.flags.translate || (!config.geminiKey && !claude))
      return c.json({ error: 'translation disabled' }, 404);
    const parsed = TranslateRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'invalid body' }, 400);
    const { lang, texts } = parsed.data;
    const cache = cacheFor(lang);
    const missing = [...new Set(texts.filter((t) => cache[t] === undefined))];
    if (missing.length) {
      const out = await upstream(lang, missing);
      if (!out) return c.json({ error: 'translation unavailable' }, 502);
      missing.forEach((src, i) => {
        const t = out[i]?.trim();
        // A line that lost or changed a number is not trusted: keep the English.
        cache[src] = t && keepsNumbers(src, t) ? t : src;
      });
      try {
        mkdirSync(join(config.cacheDir, 'translate'), { recursive: true });
        writeFileSync(file(lang), JSON.stringify(cache));
      } catch (e) {
        log.warn('translate cache write failed', { error: (e as Error).message });
      }
    }
    const body: TranslateResponse = { lang, texts: texts.map((t) => cache[t] ?? t) };
    return c.json(body);
  });
}
