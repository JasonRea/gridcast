import type { Language } from '@gridcast/types';

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
