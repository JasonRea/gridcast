/**
 * Claude commentary writer. Streams so the first words reach the client in under 2 s.
 * Claude only writes words about facts in the context; it never decides what happened.
 */
import Anthropic from '@anthropic-ai/sdk';
import { log } from '../util/logger.ts';
import type { CommentaryContext } from './context.ts';
import type { LinePair } from './template.ts';

export type Writer = {
  /** `onDelta` receives the play-by-play line as it streams. */
  write(
    ctx: CommentaryContext,
    onDelta?: (voice: 'pbp' | 'color', text: string) => void,
  ): Promise<LinePair | undefined>;
};

export const SYSTEM_PROMPT = `You are two NFL TV announcers calling a game for viewers who cannot watch it.
PBP is the play-by-play voice: crisp, energetic, present tense, under 25 words.
COLOR is the analyst: one sentence on why the play matters, under 25 words.

Rules:
- Use only facts in the JSON context: players, teams, yards, score, clock, down, win probability, odds.
- Never invent stats, records, quotes, history, or player names that are not in the context.
- Refer to players by last name. Refer to teams by the names in the context.
- Never speculate about how serious an injury is.
- Odds and win probability are information, never betting advice.

Output format, exactly:
PBP: <line>
COLOR: <line>
Write the COLOR line only when the context says "notable": true or for stoppages. For a stoppage, write only COLOR: one context nugget (drive recap, score, or win probability) to fill the break.`;

function parse(text: string): LinePair | undefined {
  const pbp = /PBP:\s*(.+)/i.exec(text)?.[1]?.trim();
  const color = /COLOR:\s*(.+)/i.exec(text)?.[1]?.trim();
  if (!pbp && !color) return undefined;
  return { pbp: pbp ?? '', ...(color ? { color } : {}) };
}

export function createClaudeWriter(opts: {
  apiKey: string;
  model: string;
  timeoutMs?: number;
}): Writer {
  const client = new Anthropic({
    apiKey: opts.apiKey,
    timeout: opts.timeoutMs ?? 15_000,
    maxRetries: 1,
  });
  return {
    async write(ctx, onDelta) {
      try {
        const stream = client.messages.stream({
          model: opts.model,
          // Two short lines; deliberately small.
          max_tokens: 200,
          // Latency matters more than depth for a one-line call.
          thinking: { type: 'disabled' },
          output_config: { effort: 'low' },
          system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: JSON.stringify(ctx) }],
        });
        let text = '';
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            text += event.delta.text;
            const partial = parse(text);
            if (partial?.pbp && onDelta && !/COLOR:/i.test(text)) onDelta('pbp', partial.pbp);
          }
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === 'refusal') {
          log.warn('commentary refused', {
            id: ctx.kind === 'play' ? ctx.play.id : ctx.stoppage.id,
          });
          return undefined;
        }
        return parse(text);
      } catch (e) {
        if (e instanceof Anthropic.RateLimitError) log.warn('commentary rate limited');
        else if (e instanceof Anthropic.APIError)
          log.warn('commentary API error', { status: e.status });
        else log.warn('commentary failed', { error: (e as Error).message });
        return undefined;
      }
    },
  };
}
