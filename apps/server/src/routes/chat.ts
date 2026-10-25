/**
 * POST /api/games/:id/chat: Ask the game, and the voice booth. Gemini (GEMINI_API_KEY) or Claude
 * (ANTHROPIC_API_KEY) answers with tools that read the event log, and cites plays as [Q3 4:12]
 * so the web app can link them to replays. Streamed over SSE. Off (404) with neither key or with
 * FLAG_CHAT=0. CHAT_PROVIDER picks one when both keys are set.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { ChatRequestSchema, type ChatMessage } from '@gridcast/types';
import type { Config } from '../config.ts';
import { runTool, TOOL_DEFS } from '../chat/tools.ts';
import type { GameRegistry } from '../games/registry.ts';
import type { GameSession } from '../games/session.ts';
import { geminiGenerate, type GeminiContent, type GeminiPart } from '../llm/gemini.ts';
import type { Fetcher } from '../util/fetchJson.ts';
import { log } from '../util/logger.ts';

const SYSTEM = `You are the analyst for Gridcast, answering fans' questions about one NFL game.
Use the tools to look up facts; answer only from tool results. If the tools do not have the answer, say so.
Keep answers short: 2-5 sentences, plain sentences, no lists or markdown (answers may be read aloud). Cite plays by quarter and clock in square brackets, exactly like [Q3 4:12], using the "when" field.
When asked how a game was won or ended, check get_game_state's lastPlay: the final play may come after the last score.
Write player names exactly as the tools give them (e.g. "J.Ramsey" or "Ramsey"); never expand an initial into a first name.
For counts and totals, use get_team_stats or the "matching" count from get_plays, never a count of a shortened list.
Expected points (EPA) and win probability come from models; odds are information only, never betting advice.
Never speculate about injuries.`;

const MAX_TURNS = 6;
/** The last turn runs with tools off, so a long investigation still ends in an answer. */
const lastTurn = (turn: number) => turn === MAX_TURNS - 1;

type Send = (m: ChatMessage) => Promise<void>;
type History = { role: 'user' | 'assistant'; text: string }[];

function toolResult(
  session: GameSession,
  name: string,
  input: unknown,
): { ok: boolean; out: string } {
  try {
    return { ok: true, out: JSON.stringify(runTool(session, name, input)) };
  } catch (e) {
    return { ok: false, out: `Invalid input: ${(e as Error).message}` };
  }
}

/** Gemini answers with function calling over REST. Model turns go back verbatim. */
async function geminiChat(opts: {
  apiKey: string;
  model: string;
  fallbacks: string[];
  /** Pause before retrying a pinned model (tests use 0). */
  retryDelayMs?: number;
  session: GameSession;
  question: string;
  history: History;
  send: Send;
  fetcher?: Fetcher;
  base?: string;
}): Promise<void> {
  const fresh = (): GeminiContent[] => [
    ...opts.history.map((h): GeminiContent => ({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.text }],
    })),
    { role: 'user', parts: [{ text: opts.question }] },
  ];
  let contents = fresh();
  const tools = TOOL_DEFS.map((t) => ({
    name: t.name,
    description: t.description,
    parametersJsonSchema: t.input_schema,
  }));
  const ask = (model: string, fallbacks: string[], final = false) =>
    geminiGenerate({
      ...(final ? { toolsOff: true } : {}),
      apiKey: opts.apiKey,
      model,
      fallbacks,
      timeoutMs: 15_000,
      system: SYSTEM,
      contents,
      tools,
      ...(opts.base ? { base: opts.base } : {}),
      ...(opts.fetcher ? { fetcher: opts.fetcher } : {}),
    });
  // The first turn may fall back to another model; later turns stay on the one that answered,
  // because its thought signatures are in the conversation. If that model then fails, retry it
  // once, then start the question over on the other models (a fresh conversation has no
  // signatures to carry).
  let pinned: string | undefined;
  let restarted = false;
  let answered = false;
  const noAnswer = () =>
    opts.send({
      type: 'error',
      message: "I couldn't pin that one down. Try asking it another way.",
    });
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const final = lastTurn(turn);
    let r = await ask(pinned ?? opts.model, pinned ? [] : opts.fallbacks, final);
    if (!r && pinned) {
      await new Promise((ok) => setTimeout(ok, opts.retryDelayMs ?? 1500));
      r = await ask(pinned, [], final);
    }
    if (!r && pinned && !restarted) {
      restarted = true;
      const others = [opts.model, ...opts.fallbacks].filter((m) => m !== pinned);
      contents = fresh();
      pinned = undefined;
      if (others[0]) r = await ask(others[0], others.slice(1));
    }
    if (!r) {
      await opts.send({ type: 'error', message: 'The analyst is unavailable right now.' });
      return;
    }
    pinned = r.model;
    contents.push(r.content);
    if (r.text) {
      answered = true;
      await opts.send({ type: 'delta', text: r.text });
    }
    if (!r.calls.length || lastTurn(turn)) {
      if (!answered) {
        log.warn('booth ended without an answer', {
          model: r.model,
          ...(r.finishReason ? { finishReason: r.finishReason } : {}),
        });
        await noAnswer();
      }
      return;
    }
    const parts: GeminiPart[] = [];
    for (const call of r.calls) {
      await opts.send({ type: 'tool', name: call.name });
      const { ok, out } = toolResult(opts.session, call.name, call.args);
      parts.push({
        functionResponse: {
          ...(call.id ? { id: call.id } : {}),
          name: call.name,
          response: ok ? { result: JSON.parse(out) as unknown } : { error: out },
        },
      });
    }
    contents.push({ role: 'user', parts });
  }
}

export function chatRoutes(
  app: Hono,
  deps: { config: Config; registry: GameRegistry; fetcher?: Fetcher },
) {
  const { config } = deps;
  const client =
    config.chatProvider === 'claude' && config.anthropicKey
      ? new Anthropic({ apiKey: config.anthropicKey, maxRetries: 1 })
      : undefined;
  const gemini =
    config.chatProvider === 'gemini' && config.geminiKey ? config.geminiKey : undefined;

  app.post('/api/games/:id/chat', async (c) => {
    if ((!client && !gemini) || !config.flags.chat) return c.json({ error: 'chat disabled' }, 404);
    const session = await deps.registry.get(c.req.param('id'));
    if (!session) return c.json({ error: 'game not found' }, 404);
    const parsed = ChatRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'invalid body' }, 400);
    const { question, history = [] } = parsed.data;

    return streamSSE(c, async (stream) => {
      const send = (m: ChatMessage) => stream.writeSSE({ event: 'chat', data: JSON.stringify(m) });
      if (gemini) {
        await geminiChat({
          apiKey: gemini,
          model: config.geminiModel,
          fallbacks: config.geminiFallbackModels,
          session,
          question,
          history,
          send,
          ...(config.geminiBase ? { base: config.geminiBase } : {}),
          ...(deps.fetcher ? { fetcher: deps.fetcher } : {}),
        });
        await send({ type: 'done' });
        return;
      }
      if (!client) return;
      const messages: Anthropic.Beta.BetaMessageParam[] = [
        ...history.map((h) => ({ role: h.role, content: h.text })),
        { role: 'user', content: question },
      ];
      const tools: Anthropic.Beta.BetaTool[] = TOOL_DEFS.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema as unknown as Anthropic.Beta.BetaTool.InputSchema,
        eager_input_streaming: true,
      }));
      try {
        for (let turn = 0; turn < MAX_TURNS; turn++) {
          const s = client.beta.messages.stream({
            model: config.chatModel,
            max_tokens: 4000,
            output_config: { effort: 'low' },
            // On a policy decline the API retries on a fallback model inside the same call.
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
            tools,
            ...(lastTurn(turn) ? { tool_choice: { type: 'none' as const } } : {}),
            messages,
          });
          s.on('text', (t) => void send({ type: 'delta', text: t }));
          const msg = await s.finalMessage();
          if (msg.stop_reason === 'refusal') {
            await send({ type: 'error', message: 'Claude declined to answer that one.' });
            break;
          }
          messages.push({ role: 'assistant', content: msg.content });
          if (msg.stop_reason !== 'tool_use') break;
          const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
          for (const block of msg.content) {
            if (block.type !== 'tool_use') continue;
            await send({ type: 'tool', name: block.name });
            const { ok, out } = toolResult(session, block.name, block.input);
            results.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: out,
              ...(ok ? {} : { is_error: true }),
            });
          }
          messages.push({ role: 'user', content: results });
        }
      } catch (e) {
        if (e instanceof Anthropic.APIError) log.warn('chat API error', { status: e.status });
        else log.warn('chat failed', { error: (e as Error).message });
        await send({ type: 'error', message: 'The analyst is unavailable right now.' });
      }
      await send({ type: 'done' });
    });
  });
}
