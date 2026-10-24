/** Wires the pipeline together. Shared by the server entry point, the CLI and tests. */
import type { Config } from './config.ts';
import { CommentaryCache } from './commentary/cache.ts';
import { createClaudeWriter, type Writer } from './commentary/claude.ts';
import { CommentaryService } from './commentary/service.ts';
import { createEspnClient, type EspnClient } from './espn/client.ts';
import { GameRegistry } from './games/registry.ts';
import { ScoreboardService } from './games/scoreboard.ts';
import type { Fetcher } from './util/fetchJson.ts';

export type Services = {
  config: Config;
  espn: EspnClient;
  registry: GameRegistry;
  scoreboard: ScoreboardService;
  commentary: CommentaryService;
};

export function createServices(
  config: Config,
  opts: { fetcher?: Fetcher; writer?: Writer | null; persist?: boolean } = {},
): Services {
  const espn = createEspnClient({
    fixturesDir: config.fixturesDir,
    offline: config.offline,
    ...(opts.fetcher ? { fetcher: opts.fetcher } : {}),
  });
  const registry = new GameRegistry(config, espn, opts.persist === false ? { persist: false } : {});
  const scoreboard = new ScoreboardService(espn, config);
  // Missing key disables Claude, not the app: commentary falls back to templates.
  const writer =
    opts.writer === null
      ? undefined
      : (opts.writer ??
        (config.anthropicKey
          ? createClaudeWriter({ apiKey: config.anthropicKey, model: config.commentaryModel })
          : undefined));
  const commentary = new CommentaryService(
    new CommentaryCache(config.cacheDir, config.assetsDir, opts.persist !== false),
    writer,
    (gameId) => void registry.refresh(gameId),
  );
  registry.addRebuildEnricher(commentary.enrichRebuild);
  registry.onSession((s) => commentary.attach(s));
  return { config, espn, registry, scoreboard, commentary };
}
