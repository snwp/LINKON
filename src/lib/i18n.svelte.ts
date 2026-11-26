import { en } from './i18n/en';
import { es } from './i18n/es';

/** Idiomas da interface. O português é a fonte: o próprio texto em português é a chave das traduções. */
export const LANGS = [
  { id: 'pt-BR', name: 'Português' },
  { id: 'en', name: 'English' },
  { id: 'es', name: 'Español' },
] as const;
export type Lang = (typeof LANGS)[number]['id'];

const DICTS: Record<string, Record<string, string>> = { en, es };
const KEY = 'linkon.lang';

function initial(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    if (LANGS.some((l) => l.id === v)) return v as Lang;
  } catch {
    /* sem armazenamento */
  }
  return 'pt-BR';
}

export const i18n = $state({ lang: initial() });

export function setLang(lang: Lang) {
  i18n.lang = lang;
  document.documentElement.lang = lang;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* vale só nesta sessão */
  }
}

/** Traduz um texto escrito em português. `{nome}` no texto é trocado por `vars.nome`. Sem tradução, fica o português. */
export function t(pt: string, vars?: Record<string, string | number>): string {
  let s = DICTS[i18n.lang]?.[pt] ?? pt;
  if (vars) for (const k in vars) s = s.replaceAll(`{${k}}`, String(vars[k]));
  return s;
}

/** Locale para datas e números (Intl). */
export const locale = () => i18n.lang;
