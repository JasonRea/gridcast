/**
 * Minimal Gemini client over REST (generateContent), no SDK. Used by the booth (Ask the game
 * with function calling) and by commentary translation. Responses are validated with zod and
 * every failure returns undefined: callers fall back, they never throw at the user.
 *
 * Gemini 3 models attach a thoughtSignature to their parts; multi-turn tool use must send the
 * model's content back exactly as received, so callers keep `content` verbatim.
 */
import { z } from 'zod';
import type { Fetcher } from '../util/fetchJson.ts';
import { log } from '../util/logger.ts';

export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const PartSchema = z
  .object({
    text: z.string().optional(),
    thought: z.boolean().optional(),
    functionCall: z
      .object({
        id: z.string().optional(),
        name: z.string(),
        args: z.record(z.string(), z.unknown()).optional(),
      })
      .optional(),
  })
  .passthrough();

const ContentSchema = z.object({
  role: z.string().optional(),
  parts: z.array(PartSchema).default([]),
});

const ResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: ContentSchema.optional(),
        finishReason: z.string().optional(),
      }),
    )
    .default([]),
});

export type GeminiPart = Record<string, unknown>;
export type GeminiContent = { role: 'user' | 'model'; parts: GeminiPart[] };
export type GeminiTool = { name: string; description: string; parametersJsonSchema: unknown };
export type GeminiCall = { id?: string; name: string; args: Record<string, unknown> };

export type GeminiResult = {
  /** The model's turn, verbatim (thought signatures included) for the next request. */
  content: GeminiContent;
  text: string;
  calls: GeminiCall[];
  finishReason?: string;
};

export async function geminiGenerate(opts: {
  apiKey: string;
  model: string;
  system?: string;
  contents: GeminiContent[];
  tools?: GeminiTool[];
  json?: boolean;
  fetcher?: Fetcher;
  timeoutMs?: number;
  /** Override for tests and local mocks (GEMINI_BASE). */
  base?: string;
}): Promise<GeminiResult | undefined> {
  const body = {
    ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
    contents: opts.contents,
    ...(opts.tools?.length ? { tools: [{ functionDeclarations: opts.tools }] } : {}),
    generationConfig: {
      maxOutputTokens: 2048,
      ...(opts.json ? { responseMimeType: 'application/json' } : {}),
    },
  };
  try {
    const res = await (opts.fetcher ?? fetch)(
      `${opts.base ?? GEMINI_BASE}/models/${encodeURIComponent(opts.model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': opts.apiKey, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
      },
    );
    if (!res.ok) {
      log.warn('gemini upstream error', { status: res.status, model: opts.model });
      return undefined;
    }
    const parsed = ResponseSchema.safeParse(await res.json());
    if (!parsed.success) {
      log.warn('gemini response did not validate', { model: opts.model });
      return undefined;
    }
    const cand = parsed.data.candidates[0];
    if (!cand?.content) return undefined;
    const parts = cand.content.parts;
    return {
      content: { role: 'model', parts: parts as GeminiPart[] },
      text: parts
        .filter((p) => p.text && !p.thought)
        .map((p) => p.text)
        .join(''),
      calls: parts.flatMap((p) =>
        p.functionCall
          ? [
              {
                ...(p.functionCall.id ? { id: p.functionCall.id } : {}),
                name: p.functionCall.name,
                args: p.functionCall.args ?? {},
              },
            ]
          : [],
      ),
      ...(cand.finishReason ? { finishReason: cand.finishReason } : {}),
    };
  } catch (e) {
    log.warn('gemini failed', { error: (e as Error).message });
    return undefined;
  }
}
