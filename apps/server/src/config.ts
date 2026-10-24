import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const bool = (v: string | undefined, dflt: boolean) =>
  v === undefined || v === '' ? dflt : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());

export type Config = {
  port: number;
  root: string;
  dataDir: string;
  fixturesDir: string;
  logsDir: string;
  cacheDir: string;
  assetsDir: string;
  webDist: string;
  featuredGameId: string;
  demoGameId: string;
  adminToken?: string;
  anthropicKey?: string;
  elevenLabsKey?: string;
  xBearer?: string;
  oddsApiKey?: string;
  /** Never call upstream APIs; serve fixtures and recorded logs only. */
  offline: boolean;
  espnPollMs: number;
  kalshiPollMs: number;
  season: number;
  /** Fast model for per-play commentary, stronger model for chat. */
  commentaryModel: string;
  chatModel: string;
  /** Feature flags (P1). Each is documented in README.md. */
  flags: Record<string, boolean>;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = env.DATA_DIR ? resolve(env.DATA_DIR) : join(ROOT, 'data');
  const opt = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);
  const adminToken = opt(env.ADMIN_TOKEN);
  const anthropicKey = opt(env.ANTHROPIC_API_KEY);
  const elevenLabsKey = opt(env.ELEVENLABS_API_KEY);
  const xBearer = opt(env.X_BEARER_TOKEN);
  const oddsApiKey = opt(env.ODDS_API_KEY);
  return {
    port: Number(env.PORT ?? 8787),
    root: ROOT,
    dataDir,
    fixturesDir: join(ROOT, 'data/fixtures'),
    logsDir: join(dataDir, 'logs'),
    cacheDir: join(dataDir, 'cache'),
    assetsDir: join(ROOT, 'data/assets'),
    webDist: join(ROOT, 'apps/web/dist'),
    featuredGameId: env.FEATURED_GAME_ID ?? '401873011',
    demoGameId: env.DEMO_GAME_ID ?? '401873002',
    ...(adminToken ? { adminToken } : {}),
    ...(anthropicKey ? { anthropicKey } : {}),
    ...(elevenLabsKey ? { elevenLabsKey } : {}),
    ...(xBearer ? { xBearer } : {}),
    ...(oddsApiKey ? { oddsApiKey } : {}),
    offline: bool(env.GRIDCAST_OFFLINE, false),
    espnPollMs: Number(env.ESPN_POLL_MS ?? 10_000),
    kalshiPollMs: Number(env.KALSHI_POLL_MS ?? 5_000),
    season: Number(env.SEASON ?? 2026),
    commentaryModel: env.COMMENTARY_MODEL ?? 'claude-haiku-5-5',
    chatModel: env.CHAT_MODEL ?? 'claude-opus-5-5',
    flags: {
      timeline: bool(env.FLAG_TIMELINE, true),
      epa: bool(env.FLAG_EPA, true),
      preview: bool(env.FLAG_PREVIEW, true),
      oddsChart: bool(env.FLAG_ODDS_CHART, true),
      tts: bool(env.FLAG_TTS, true),
      fourthDown: bool(env.FLAG_FOURTH_DOWN, true),
      chat: bool(env.FLAG_CHAT, true) && !!anthropicKey,
      clips: bool(env.FLAG_CLIPS, true) && !!xBearer,
      sound: bool(env.FLAG_SOUND, false),
    },
  };
}
