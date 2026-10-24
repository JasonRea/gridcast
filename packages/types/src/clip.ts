import { z } from 'zod';

export const ClipSchema = z.object({
  kind: z.literal('clip'),
  playId: z.string(),
  ts: z.number(),
  url: z.string(),
  source: z.enum(['x', 'manual', 'self']),
});
export type Clip = z.infer<typeof ClipSchema>;
