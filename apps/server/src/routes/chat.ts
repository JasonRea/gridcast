/**
 * POST /api/games/:id/chat: Ask the game. Claude answers with tools that read the event log, and
 * cites plays as [Q3 4:12] so the web app can link them to replays. Streamed over SSE.
 * Off (404) without ANTHROPIC_API_KEY or with FLAG_CHAT=0.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { ChatRequestSchema, type ChatMessage } from '@gridcast/types';
import type { Config } from '../config.ts';
import { runTool, TOOL_DEFS } from '../chat/tools.ts';
import type { GameRegistry } from '../games/registry.ts';
import { log } from '../util/logger.ts';

const SYSTEM = `You are the analyst for Gridcast, answering fans' questions about one NFL game.
Use the tools to look up facts; answer only from tool results. If the tools do not have the answer, say so.
Keep answers short: 2-5 sentences. Cite plays by quarter and clock in square brackets, exactly like [Q3 4:12], using the "when" field.
Expected points (EPA) and win probability come from models; odds are information only, never betting advice.
Never speculate about injuries.`;

const MAX_TURNS = 6;

export function chatRoutes(app: Hono, deps: { config: Config; registry: GameRegistry }) {
  const { config } = deps;
  const client = config.anthropicKey
    ? new Anthropic({ apiKey: config.anthropicKey, maxRetries: 1 })
    : undefined;

  app.post('/api/games/:id/chat', async (c) => {
    if (!client || !config.flags.chat) return c.json({ error: 'chat disabled' }, 404);
    const session = await deps.registry.get(c.req.param('id'));
    if (!session) return c.json({ error: 'game not found' }, 404);
    const parsed = ChatRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'invalid body' }, 400);
    const { question, history = [] } = parsed.data;

    return streamSSE(c, async (stream) => {
      const send = (m: ChatMessage) => stream.writeSSE({ event: 'chat', data: JSON.stringify(m) });
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
            try {
              results.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: JSON.stringify(runTool(session, block.name, block.input)),
              });
            } catch (e) {
              results.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: `Invalid input: ${(e as Error).message}`,
                is_error: true,
              });
            }
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
