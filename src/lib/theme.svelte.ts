/** Temas do app. As cores ficam em app.css, em :root[data-theme='…']; aqui só a escolha e a amostra do seletor. */
export const THEMES = [
  { id: 'escuro', name: 'Escuro', bg: '#000000', fg: '#ffffff', accent: '#ffffff' },
  { id: 'claro', name: 'Claro', bg: '#ffffff', fg: '#0a0a0a', accent: '#0a0a0a' },
  { id: 'planta', name: 'Planta', bg: '#0c2340', fg: '#e4eef8', accent: '#e4eef8' },
  { id: 'ambar', name: 'Âmbar', bg: '#0e0b06', fg: '#ffb547', accent: '#ffb547' },
  { id: 'sinal', name: 'Sinal', bg: '#f3f3f1', fg: '#151515', accent: '#ff4f00' },
  { id: 'riso', name: 'Riso', bg: '#fafafa', fg: '#1c3f94', accent: '#ff48b0' },
] as const;
export type ThemeId = (typeof THEMES)[number]['id'];

const KEY = 'linkon.theme';

function initial(): ThemeId {
  try {
    const v = localStorage.getItem(KEY);
    if (THEMES.some((t) => t.id === v)) return v as ThemeId;
  } catch {
    /* sem armazenamento */
  }
  return 'escuro';
}

export const theme = $state({ id: initial() });

export function setTheme(id: ThemeId) {
  theme.id = id;
  if (id === 'escuro') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* vale só nesta sessão */
  }
}
