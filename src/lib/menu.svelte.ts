/**
 * Menu do botão direito (um só para o app). Cada tela monta os itens do que está sob o cursor
 * e chama openMenu; o layout abre um menu geral onde ninguém tratou o clique.
 */
import type { Component } from 'svelte';
import { goto } from '$app/navigation';
import { PenLine, Eye, Copy, Trash2 } from '@lucide/svelte';
import { api, message, type Page } from '$lib/api';
import { store, reload } from '$lib/store.svelte';
import { locale, t } from '$lib/i18n.svelte';

export type MenuItem =
  | {
      label: string;
      icon?: Component;
      /** Atalho mostrado à direita (só texto; o atalho em si é tratado em outro lugar). */
      kbd?: string;
      /** Etiqueta pequena ao lado do nome (ex.: "Padrão"). */
      badge?: string;
      /** Texto discreto à direita (ex.: por que está bloqueado). */
      note?: string;
      /** Marca de opção escolhida (tamanhos, ordem). */
      checked?: boolean;
      danger?: boolean;
      /** Se presente, o primeiro clique troca o rótulo por esta pergunta e só o segundo executa. */
      confirm?: string;
      disabled?: boolean;
      run: () => void;
    }
  | { separator: true }
  | { heading: string };

export const menu = $state<{ open: boolean; x: number; y: number; items: MenuItem[]; above: boolean; alignRight: boolean }>({
  open: false,
  x: 0,
  y: 0,
  items: [],
  above: false,
  alignRight: false,
});

export function openMenu(e: MouseEvent, items: MenuItem[]) {
  e.preventDefault();
  e.stopPropagation();
  Object.assign(menu, { open: true, x: e.clientX, y: e.clientY, items, above: false, alignRight: false });
}

/** Abre o mesmo menu preso a um botão: acima dele e alinhado pela direita (para botões no rodapé da tela). */
export function openMenuAbove(anchor: HTMLElement, items: MenuItem[]) {
  const r = anchor.getBoundingClientRect();
  Object.assign(menu, { open: true, x: r.right, y: r.top - 6, items, above: true, alignRight: true });
}

export function closeMenu() {
  menu.open = false;
}

/** Atalhos do botão direito sobre uma interface (Início e pastas). */
export function pageItems(p: Page): MenuItem[] {
  return [
    { label: t('Abrir no Editor'), icon: PenLine, run: () => goto(`/editor?id=${p.id}`) },
    { label: t('Visualizar'), icon: Eye, run: () => goto(`/visualizar?id=${p.id}`) },
    {
      label: t('Duplicar'),
      icon: Copy,
      run: async () => {
        try {
          await api.createPage(t('{title} (cópia)', { title: p.title }), p.project_id, p.doc);
          await reload();
        } catch (e) {
          store.error = `${t('A interface não foi duplicada.')} ${message(e)}`;
        }
      },
    },
    { separator: true },
    {
      label: t('Excluir interface'),
      icon: Trash2,
      danger: true,
      confirm: t('Confirmar: excluir de vez'),
      run: async () => {
        try {
          await api.deletePage(p.id);
          await reload();
        } catch (e) {
          store.error = `${t('A interface não foi excluída.')} ${message(e)}`;
        }
      },
    },
  ];
}

// ---------- preferências de exibição (guardadas neste computador) ----------

export type Size = 's' | 'm' | 'l';
/** 'manual' = a ordem que a pessoa arrastou (guardada em folderManual/homeManual). */
export type Order = 'recent' | 'name' | 'manual';
type Prefs = {
  folderSize: Size;
  folderOrder: Order;
  homeSize: Size;
  homeOrder: Order;
  folderManual: number[];
  homeManual: number[];
};

const KEY = 'linkon.view';
const DEFAULTS: Prefs = {
  folderSize: 'm',
  folderOrder: 'recent',
  homeSize: 'm',
  homeOrder: 'recent',
  folderManual: [],
  homeManual: [],
};

/**
 * Aplica a ordem escolhida. Na manual, quem não está na lista (criado depois) vem primeiro, do mais recente.
 */
export function ordered<T extends { id: number; updated_at: number }>(items: T[], order: Order, name: (x: T) => string, manual: number[]): T[] {
  const byRecent = [...items].sort((a, b) => b.updated_at - a.updated_at);
  if (order === 'name') return [...items].sort((a, b) => name(a).localeCompare(name(b), locale()));
  if (order !== 'manual') return byRecent;
  const pos = new Map(manual.map((id, i) => [id, i]));
  return [...byRecent.filter((x) => !pos.has(x.id)), ...byRecent.filter((x) => pos.has(x.id)).sort((a, b) => pos.get(a.id)! - pos.get(b.id)!)];
}

/** Move `from` para antes (ou depois) de `to` na ordem atual e passa a ordem para manual. */
export function moveInOrder(current: number[], from: number, to: number, after: boolean): number[] {
  const ids = current.filter((id) => id !== from);
  const i = ids.indexOf(to);
  ids.splice(i < 0 ? ids.length : i + (after ? 1 : 0), 0, from);
  return ids;
}

function load(): Prefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export const view = $state<Prefs>(load());

export function setView<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  view[key] = value;
  try {
    localStorage.setItem(KEY, JSON.stringify(view));
  } catch {
    // Sem armazenamento local, a escolha vale até fechar o app.
  }
}

/** Textos em português; quem exibe passa por t(). */
export const SIZE_LABELS: Record<Size, string> = { s: 'Pequenas', m: 'Médias', l: 'Grandes' };

/** Itens prontos de tamanho e ordem, usados no Início e em Pastas. */
export function viewItems(sizeKey: 'folderSize' | 'homeSize', orderKey: 'folderOrder' | 'homeOrder', what: string): MenuItem[] {
  return [
    { heading: t('Tamanho das {what}', { what }) },
    ...(['s', 'm', 'l'] as Size[]).map((s) => ({
      label: t(SIZE_LABELS[s]),
      checked: view[sizeKey] === s,
      run: () => setView(sizeKey, s),
    })),
    { heading: t('Ordenar') },
    { label: t('Mais recentes primeiro'), checked: view[orderKey] === 'recent', run: () => setView(orderKey, 'recent') },
    { label: t('Por nome'), checked: view[orderKey] === 'name', run: () => setView(orderKey, 'name') },
    { label: t('Manual (arrastar)'), checked: view[orderKey] === 'manual', run: () => setView(orderKey, 'manual') },
  ];
}
