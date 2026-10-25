/**
 * Commentary in the viewer's language. Asks the server to translate lines it has not seen yet
 * (at most 20 per request) and returns English -> translated for the current language. A failed
 * request maps lines to themselves, so the page shows English instead of retrying forever.
 */
import { useEffect, useRef, useState } from 'react';
import type { Language } from '@gridcast/types';
import { api } from './api';

export type Lang = 'en' | Language;

export const LANGS: { code: Lang; label: string; name: string }[] = [
  { code: 'en', label: 'EN', name: 'English' },
  { code: 'fr', label: 'FR', name: 'Français' },
  { code: 'es', label: 'ES', name: 'Español' },
  { code: 'de', label: 'DE', name: 'Deutsch' },
  { code: 'pt', label: 'PT', name: 'Português' },
];

export function isLang(v: string | null | undefined): v is Lang {
  return LANGS.some((l) => l.code === v);
}

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
  }, [lang, key]);
  return lang === 'en' ? {} : (maps[lang] ?? {});
}
