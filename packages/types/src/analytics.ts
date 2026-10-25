import { z } from 'zod';

export const FourthChoiceSchema = z.enum(['go', 'punt', 'fg']);
export type FourthChoice = z.infer<typeof FourthChoiceSchema>;

/**
 * 4th-down bot output, in expected points for the offense (built on the EP table; see
 * DECISIONS.md). `call` and `delta` are set once the snap has happened.
 */
/** Historical twins: what NFL teams did in the same 4th-down spot (A4, additive). */
export const FourthDownHistorySchema = z.object({
  /** Fourth downs in the matched situation. */
  n: z.number().int(),
  goRate: z.number(),
  /** Conversion rate when they went for it (omitted under 10 attempts). */
  convRate: z.number().optional(),
  fgRate: z.number(),
  puntRate: z.number(),
  /** Plain-English situation, e.g. "4th & 1, 31-40 yards from the end zone, tied". */
  situation: z.string(),
  seasons: z.string(),
});
export type FourthDownHistory = z.infer<typeof FourthDownHistorySchema>;

export const FourthDownCallSchema = z.object({
  options: z.object({ go: z.number(), punt: z.number().optional(), fg: z.number().optional() }),
  recommend: FourthChoiceSchema,
  /** Conversion probability for going for it, 0-1. */
  goProb: z.number(),
  /** Field goal make probability, 0-1, when in range. */
  fgProb: z.number().optional(),
  call: FourthChoiceSchema.optional(),
  /** Expected points given up versus the recommendation (>= 0). */
  delta: z.number().optional(),
  history: FourthDownHistorySchema.optional(),
});
export type FourthDownCall = z.infer<typeof FourthDownCallSchema>;

export const PreviewSchema = z.object({
  injuries: z.array(
    z.object({
      team: z.string(),
      players: z.array(
        z.object({ name: z.string(), position: z.string().optional(), status: z.string() }),
      ),
    }),
  ),
  leaders: z.array(
    z.object({ team: z.string(), category: z.string(), name: z.string(), value: z.string() }),
  ),
  /** ESPN matchup predictor, home win probability 0-1. */
  predictorHome: z.number().optional(),
  comparison: z.array(z.object({ label: z.string(), home: z.string(), away: z.string() })),
  storylines: z.array(z.string()),
});
export type Preview = z.infer<typeof PreviewSchema>;

export const ChatRequestSchema = z.object({
  question: z.string().min(1).max(500),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(4000) }))
    .max(12)
    .optional(),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

/** SSE messages from POST /api/games/:id/chat. */
export const ChatMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('delta'), text: z.string() }),
  z.object({ type: z.literal('tool'), name: z.string() }),
  z.object({ type: z.literal('done') }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const TtsRequestSchema = z.object({
  text: z.string().min(1).max(400),
  voice: z.enum(['pbp', 'color']),
});
export type TtsRequest = z.infer<typeof TtsRequestSchema>;

/** Commentary languages (P2 addition: A3 multilingual commentary). English is the source. */
export const LanguageSchema = z.enum(['fr', 'es', 'de', 'pt']);
export type Language = z.infer<typeof LanguageSchema>;

/** POST /api/translate: commentary lines into another language. */
export const TranslateRequestSchema = z.object({
  lang: LanguageSchema,
  texts: z.array(z.string().min(1).max(400)).min(1).max(20),
});
export type TranslateRequest = z.infer<typeof TranslateRequestSchema>;

/** Same order and length as the request. A line that failed the check comes back in English. */
export const TranslateResponseSchema = z.object({
  lang: LanguageSchema,
  texts: z.array(z.string()),
});
export type TranslateResponse = z.infer<typeof TranslateResponseSchema>;
