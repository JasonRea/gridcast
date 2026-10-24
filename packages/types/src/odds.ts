import { z } from 'zod';

export const OddsSourceSchema = z.enum(['kalshi', 'oddsapi']);
export const OddsMarketSchema = z.enum(['moneyline', 'spread', 'total']);

export const OddsTickSchema = z.object({
  kind: z.literal('odds'),
  ts: z.number(),
  source: OddsSourceSchema,
  market: OddsMarketSchema,
  /** 0-1 implied probability for the home side (price in cents / 100). */
  homeProb: z.number().min(0).max(1),
  line: z.number().optional(),
  ticker: z.string().optional(),
});
export type OddsTick = z.infer<typeof OddsTickSchema>;
