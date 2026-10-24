import { z } from 'zod';

export const VoiceSchema = z.enum(['pbp', 'color']);
export type Voice = z.infer<typeof VoiceSchema>;

export const CommentarySchema = z.object({
  kind: z.literal('commentary'),
  /** Id of the play or stoppage the line is about. */
  playId: z.string(),
  ts: z.number(),
  voice: VoiceSchema,
  text: z.string(),
  /** True when written by the deterministic template instead of Claude. */
  template: z.boolean().optional(),
});
export type Commentary = z.infer<typeof CommentarySchema>;
