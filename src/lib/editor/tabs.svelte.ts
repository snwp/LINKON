/**
 * Projetos abertos no Editor, em abas (ids de página, na ordem em que foram abertos).
 * Guardados neste computador para as abas voltarem ao reabrir o app.
 */
const KEY = 'linkon.editor.tabs';

function load(): number[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((n) => Number.isInteger(n) && n > 0).slice(0, 30) : [];
  } catch {
    return [];
  }
}

export const tabs = $state<{ ids: number[] }>({ ids: typeof localStorage === 'undefined' ? [] : load() });

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(tabs.ids));
  } catch {
    // Sem armazenamento local, as abas valem até fechar o app.
  }
}

export function openTab(id: number) {
  if (tabs.ids.includes(id)) return;
  tabs.ids.push(id);
  save();
}

/** Fecha a aba e devolve a vizinha que deve ficar aberta (a da direita, senão a da esquerda), ou null. */
export function closeTab(id: number): number | null {
  const i = tabs.ids.indexOf(id);
  if (i < 0) return null;
  tabs.ids.splice(i, 1);
  save();
  return tabs.ids[i] ?? tabs.ids[i - 1] ?? null;
}

/** Tira abas de páginas que não existem mais. */
export function pruneTabs(existing: Set<number>) {
  const kept = tabs.ids.filter((id) => existing.has(id));
  if (kept.length === tabs.ids.length) return;
  tabs.ids = kept;
  save();
}
