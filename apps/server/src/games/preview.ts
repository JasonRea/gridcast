/**
 * Preview data for upcoming games from the ESPN summary (injuries, leaders, predictor, stats),
 * parsed leniently: any section that does not match is skipped. Storylines are facts-only:
 * deterministic sentences, or Claude-written ones when a key is set (grounded and cached).
 */
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { normalizeAbbr, type EspnSummary, type GameCard, type Preview } from '@gridcast/types';
import { log } from '../util/logger.ts';

const InjuryBlock = z.looseObject({
  team: z.looseObject({ abbreviation: z.string() }),
  injuries: z.array(
    z.looseObject({
      status: z.string().optional(),
      athlete: z.looseObject({
        displayName: z.string(),
        position: z.looseObject({ abbreviation: z.string() }).optional(),
      }),
    }),
  ),
});

const LeaderBlock = z.looseObject({
  team: z.looseObject({ abbreviation: z.string() }),
  leaders: z.array(
    z.looseObject({
      displayName: z.string().optional(),
      name: z.string().optional(),
      leaders: z.array(
        z.looseObject({
          displayValue: z.string().optional(),
          athlete: z.looseObject({ displayName: z.string() }),
        }),
      ),
    }),
  ),
});

const Predictor = z.looseObject({
  homeTeam: z.looseObject({ gameProjection: z.union([z.string(), z.number()]).optional() }),
});

const BoxTeam = z.looseObject({
  team: z.looseObject({ abbreviation: z.string() }),
  statistics: z.array(
    z.looseObject({
      label: z.string().optional(),
      name: z.string().optional(),
      displayValue: z.string(),
    }),
  ),
});

function each<T>(schema: z.ZodType<T>, list: unknown): T[] {
  if (!Array.isArray(list)) return [];
  return list.flatMap((x) => {
    const p = schema.safeParse(x);
    return p.success ? [p.data] : [];
  });
}

export function extractPreview(summary: EspnSummary, card: GameCard): Omit<Preview, 'storylines'> {
  const raw = summary as Record<string, unknown>;
  const injuries = each(InjuryBlock, raw.injuries).map((b) => ({
    team: normalizeAbbr(b.team.abbreviation),
    players: b.injuries
      .filter((i) => i.status && !/active/i.test(i.status))
      .slice(0, 8)
      .map((i) => ({
        name: i.athlete.displayName,
        ...(i.athlete.position ? { position: i.athlete.position.abbreviation } : {}),
        status: i.status ?? '',
      })),
  }));
  const leaders = each(LeaderBlock, raw.leaders).flatMap((b) =>
    b.leaders.slice(0, 3).flatMap((cat) => {
      const top = cat.leaders[0];
      return top
        ? [
            {
              team: normalizeAbbr(b.team.abbreviation),
              category: cat.displayName ?? cat.name ?? '',
              name: top.athlete.displayName,
              value: top.displayValue ?? '',
            },
          ]
        : [];
    }),
  );
  const pred = Predictor.safeParse(raw.predictor);
  const proj = pred.success ? Number(pred.data.homeTeam.gameProjection) : NaN;
  const box = each(BoxTeam, (raw.boxscore as { teams?: unknown } | undefined)?.teams);
  const home = box.find((b) => normalizeAbbr(b.team.abbreviation) === card.home.abbr);
  const away = box.find((b) => normalizeAbbr(b.team.abbreviation) === card.away.abbr);
  const comparison =
    home && away
      ? home.statistics.slice(0, 8).flatMap((s) => {
          const key = s.name ?? s.label;
          const other = away.statistics.find((x) => (x.name ?? x.label) === key);
          return other && key
            ? [{ label: s.label ?? key, home: s.displayValue, away: other.displayValue }]
            : [];
        })
      : [];
  return {
    injuries,
    leaders,
    ...(Number.isFinite(proj) ? { predictorHome: Math.round(proj * 10) / 1000 } : {}),
    comparison,
  };
}

/** Facts-only storylines from the card and preview data. */
export function templateStorylines(
  card: GameCard,
  p: Omit<Preview, 'storylines'>,
  kalshiHome?: number,
): string[] {
  const out: string[] = [];
  if (card.spread)
    out.push(
      `The line is ${card.spread}${card.total !== undefined ? ` with a total of ${card.total}` : ''}.`,
    );
  if (kalshiHome !== undefined) {
    const fav = kalshiHome >= 0.5 ? card.home : card.away;
    out.push(
      `Kalshi traders give the ${fav.shortName} a ${Math.round(Math.max(kalshiHome, 1 - kalshiHome) * 100)}% chance to win.`,
    );
  }
  if (p.predictorHome !== undefined) {
    const fav = p.predictorHome >= 0.5 ? card.home : card.away;
    out.push(
      `ESPN's matchup predictor favors the ${fav.shortName} at ${Math.round(Math.max(p.predictorHome, 1 - p.predictorHome) * 100)}%.`,
    );
  }
  if (card.home.record && card.away.record)
    out.push(
      `${card.away.shortName} ${card.away.record} visit ${card.home.shortName} ${card.home.record}.`,
    );
  for (const inj of p.injuries) {
    const out_ = inj.players.filter((x) => /out|doubtful/i.test(x.status));
    if (out_.length)
      out.push(
        `${inj.team} will be without ${out_
          .slice(0, 3)
          .map((x) => x.name)
          .join(', ')}.`,
      );
  }
  if (card.venue) out.push(`Kickoff at ${card.venue}${card.tv ? ` on ${card.tv}` : ''}.`);
  return out.slice(0, 4);
}

/** Claude storylines (3 bullets), cached per game for the day. Falls back to templates. */
export class StorylineWriter {
  private cache = new Map<string, { day: string; lines: string[] }>();
  private pending = new Set<string>();
  private client: Anthropic | undefined;

  constructor(
    apiKey: string | undefined,
    private readonly model: string,
  ) {
    if (apiKey) this.client = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 });
  }

  get(gameId: string, facts: unknown, fallback: string[]): string[] {
    const day = new Date().toISOString().slice(0, 10);
    const hit = this.cache.get(gameId);
    if (hit && hit.day === day) return hit.lines;
    if (this.client && !this.pending.has(gameId)) void this.generate(gameId, facts, day);
    return fallback;
  }

  private async generate(gameId: string, facts: unknown, day: string) {
    this.pending.add(gameId);
    try {
      const res = await this.client!.messages.create({
        model: this.model,
        max_tokens: 600,
        output_config: { effort: 'low' },
        system:
          'You write three short pregame storylines for an NFL game, one per line, each under 25 words. Use only the facts in the JSON. No invented stats, records, history, quotes or injury details beyond the listed status. Odds are information, never betting advice.',
        messages: [{ role: 'user', content: JSON.stringify(facts) }],
      });
      if (res.stop_reason === 'refusal') return;
      const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n');
      const lines = text
        .split('\n')
        .map((l) => l.replace(/^[-*\d.)\s]+/, '').trim())
        .filter((l) => l.length > 10)
        .slice(0, 3);
      if (lines.length) this.cache.set(gameId, { day, lines });
    } catch (e) {
      log.warn('storylines failed', { gameId, error: (e as Error).message });
    } finally {
      this.pending.delete(gameId);
    }
  }
}
