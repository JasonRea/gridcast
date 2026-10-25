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
  /** The model that answered. */
  model: string;
  /** The model's turn, verbatim (thought signatures included) for the next request. */
  content: GeminiContent;
  text: string;
  calls: GeminiCall[];
  finishReason?: string;
};

export type GeminiOptions = {
  apiKey: string;
  model: string;
  /**
   * Models to try, in order, when `model` is overloaded (429, 5xx) or times out. Thought
   * signatures belong to the model that made them, so multi-turn callers pin the model that
   * answered (`GeminiResult.model`) for the rest of the conversation.
   */
  fallbacks?: string[];
  system?: string;
  contents: GeminiContent[];
  tools?: GeminiTool[];
  json?: boolean;
  /** Keep the tools declared but forbid calling them: the model must answer in text. */
  toolsOff?: boolean;
  fetcher?: Fetcher;
  /** Per attempt. */
  timeoutMs?: number;
  /** Override for tests and local mocks (GEMINI_BASE). */
  base?: string;
};

type Attempt = { result?: GeminiResult; retry: boolean };

async function attempt(opts: GeminiOptions, model: string): Promise<Attempt> {
  const body = {
    ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
    contents: opts.contents,
    ...(opts.tools?.length ? { tools: [{ functionDeclarations: opts.tools }] } : {}),
    ...(opts.tools?.length && opts.toolsOff
      ? { toolConfig: { functionCallingConfig: { mode: 'NONE' } } }
      : {}),
    generationConfig: {
      maxOutputTokens: 2048,
      ...(opts.json ? { responseMimeType: 'application/json' } : {}),
    },
  };
  try {
    const res = await (opts.fetcher ?? fetch)(
      `${opts.base ?? GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': opts.apiKey, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
      },
    );
    if (!res.ok) {
      log.warn('gemini upstream error', { status: res.status, model });
      return { retry: res.status === 429 || res.status >= 500 };
    }
    const parsed = ResponseSchema.safeParse(await res.json());
    if (!parsed.success) {
      log.warn('gemini response did not validate', { model });
      return { retry: false };
    }
    const cand = parsed.data.candidates[0];
    if (!cand?.content) return { retry: true };
    const parts = cand.content.parts;
    return {
      retry: false,
      result: {
        model,
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
      },
    };
  } catch (e) {
    // Timeouts and network errors: worth trying the next model.
    log.warn('gemini failed', { error: (e as Error).message, model });
    return { retry: true };
  }
}

export async function geminiGenerate(opts: GeminiOptions): Promise<GeminiResult | undefined> {
  const models = [...new Set([opts.model, ...(opts.fallbacks ?? [])])];
  for (const model of models) {
    const a = await attempt(opts, model);
    if (a.result) return a.result;
    if (!a.retry) return undefined;
  }
  return undefined;
}
