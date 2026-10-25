/**
 * Commentary in the viewer's language (port of apps/web/src/lib/useTranslations.ts). Asks the
 * server to translate lines it has not seen yet, at most 20 per request, and returns
 * English -> translated. A failed request maps lines to themselves (English shows) instead of
 * retrying forever.
 */
import { useEffect, useRef, useState } from 'react';
import { api } from '@/api/client';
import type { Lang } from './langs';

export function useTranslations(lang: Lang, texts: string[]): Record<string, string> {
  const [maps, setMaps] = useState<Partial<Record<Lang, Record<string, string>>>>({});
  const pending = useRef(new Set<string>());
  const key = texts.join('\u0001');
  useEffect(() => {
    if (lang === 'en') return;
    const have = maps[lang] ?? {};
    const missing = [...new Set(texts)]
      .filter(
        (t) => t.length <= 400 && have[t] === undefined && !pending.current.has(`${lang}:${t}`),
      )
      .slice(0, 20);
    if (!missing.length) return;
    for (const t of missing) pending.current.add(`${lang}:${t}`);
    const merge = (out: string[]) =>
      setMaps((m) => ({
        ...m,
        [lang]: { ...m[lang], ...Object.fromEntries(missing.map((t, i) => [t, out[i] ?? t])) },
      }));
    api
      .translate(lang, missing)
      .then(merge)
      .catch(() => merge(missing))
      .finally(() => {
        for (const t of missing) pending.current.delete(`${lang}:${t}`);
      });
    // `key` stands in for `texts`; `maps` changes are what this effect produces.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, key, maps]);
  return lang === 'en' ? {} : (maps[lang] ?? {});
}
