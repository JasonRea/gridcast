/**
 * ESPN site API client. Every call validates with zod and fails soft. When the network call fails
 * (or the server runs offline) it falls back to a saved fixture if one exists, and says so.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EspnDepthChartSchema,
  EspnRosterSchema,
  EspnScoreboardSchema,
  EspnSummarySchema,
  type EspnDepthChart,
  type EspnRoster,
  type EspnScoreboard,
  type EspnSummary,
} from '@gridcast/types';
import type { z } from 'zod';
import { fetchJson, type Fetcher } from '../util/fetchJson.ts';
import { log } from '../util/logger.ts';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';

export type Sourced<T> = { data: T; source: 'live' | 'fixture' };

export type EspnClient = {
  scoreboard(season: number, week: number): Promise<Sourced<EspnScoreboard> | undefined>;
  /** `fresh` skips the fixture fallback (live polling must not replay stale data). */
  summary(eventId: string, opts?: { fresh?: boolean }): Promise<Sourced<EspnSummary> | undefined>;
  roster(teamId: string, abbr: string): Promise<EspnRoster | undefined>;
  depthChart(teamId: string, abbr: string): Promise<EspnDepthChart | undefined>;
};

export function createEspnClient(opts: {
  fixturesDir: string;
  offline: boolean;
  fetcher?: Fetcher;
}): EspnClient {
  const dir = join(opts.fixturesDir, 'espn');

  function fixture<S extends z.ZodType>(file: string, schema: S): z.infer<S> | undefined {
    const path = join(dir, file);
    if (!existsSync(path)) return undefined;
    const parsed = schema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
    if (!parsed.success) {
      log.warn('fixture failed validation', { file });
      return undefined;
    }
    return parsed.data;
  }

  async function get<S extends z.ZodType>(
    url: string,
    schema: S,
    file: string,
    fresh = false,
  ): Promise<Sourced<z.infer<S>> | undefined> {
    if (!opts.offline) {
      const r = await fetchJson(url, schema, opts.fetcher ? { fetcher: opts.fetcher } : {});
      if (r.ok) return { data: r.data, source: 'live' };
    }
    if (fresh && !opts.offline) return undefined;
    const f = fixture(file, schema);
    return f === undefined ? undefined : { data: f, source: 'fixture' };
  }

  return {
    scoreboard: (season, week) =>
      get(
        `${BASE}/scoreboard?seasontype=2&week=${week}&dates=${season}`,
        EspnScoreboardSchema,
        `scoreboard_${season}_wk${week}.json`,
      ),
    summary: (id, o) =>
      get(`${BASE}/summary?event=${id}`, EspnSummarySchema, `summary_${id}.json`, o?.fresh),
    roster: async (teamId, abbr) =>
      (await get(`${BASE}/teams/${teamId}/roster`, EspnRosterSchema, `roster_${abbr}.json`))?.data,
    depthChart: async (teamId, abbr) =>
      (
        await get(
          `${BASE}/teams/${teamId}/depthcharts`,
          EspnDepthChartSchema,
          `depthchart_${abbr}.json`,
        )
      )?.data,
  };
}
