/**
 * Commentary cache keyed by play (or stoppage) id, so replays never call Claude again.
 * Runtime cache: data/cache/commentary/<gameId>.json. Pre-generated demo commentary can be
 * committed to data/assets/commentary/<gameId>.json and is read first.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LinePair } from './template.ts';

/**
 * Bump when the commentary style changes (prompt or templates): older cached lines are ignored
 * and regenerated.
 */
export const COMMENTARY_STYLE = 3;

export type CachedLines = LinePair & { source: 'claude' | 'template'; style?: number };

export class CommentaryCache {
  private readonly maps = new Map<string, Record<string, CachedLines>>();

  constructor(
    private readonly cacheDir: string,
    private readonly assetsDir: string,
    private readonly persist = true,
  ) {}

  private file(gameId: string) {
    return join(this.cacheDir, 'commentary', `${gameId}.json`);
  }

  private load(gameId: string): Record<string, CachedLines> {
    let m = this.maps.get(gameId);
    if (m) return m;
    m = {};
    for (const path of [join(this.assetsDir, 'commentary', `${gameId}.json`), this.file(gameId)]) {
      if (this.persist && existsSync(path)) {
        try {
          Object.assign(m, JSON.parse(readFileSync(path, 'utf8')) as Record<string, CachedLines>);
        } catch {
          /* corrupt cache: regenerate */
        }
      }
    }
    this.maps.set(gameId, m);
    return m;
  }

  get(gameId: string, id: string): CachedLines | undefined {
    const hit = this.load(gameId)[id];
    return hit && hit.style === COMMENTARY_STYLE ? hit : undefined;
  }

  set(gameId: string, id: string, lines: CachedLines): void {
    const m = this.load(gameId);
    m[id] = { ...lines, style: COMMENTARY_STYLE };
    if (!this.persist) return;
    mkdirSync(join(this.cacheDir, 'commentary'), { recursive: true });
    writeFileSync(this.file(gameId), JSON.stringify(m));
  }

  /** Current-style lines only. */
  all(gameId: string): Record<string, CachedLines> {
    return Object.fromEntries(
      Object.entries(this.load(gameId)).filter(([, v]) => v.style === COMMENTARY_STYLE),
    );
  }
}
