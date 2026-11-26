<script lang="ts">
  // Início (versão Galeria, escolhida pelo usuário em 2026-11-24): miniaturas grandes de cada interface
  // (desktop com o celular sobreposto) e as pastas numa faixa no topo.
  import { Plus, Folder, FolderPlus } from '@lucide/svelte';
  import { openMenu, pageItems, view, viewItems, setView, ordered, moveInOrder, type Size } from '$lib/menu.svelte';
  import { sortable } from '$lib/reorder';
  import { goto } from '$app/navigation';
  import { store } from '$lib/store.svelte';
  import { t } from '$lib/i18n.svelte';
  import { parseDoc } from '$lib/editor/doc';
  import Thumb from '$lib/editor/Thumb.svelte';
  import { flip } from 'svelte/animate';
  import { cardIn, FLIP } from '$lib/motion';

  // Só cartões que chegam depois da tela aberta (ex.: Duplicar) entram com animação.
  let ready = $state(false);
  $effect(() => {
    requestAnimationFrame(() => (ready = true));
  });

  // Tamanho e ordem das miniaturas, escolhidos no botão direito.
  const SIZES: Record<Size, { w: number; h: number; col: number; phone: number }> = {
    s: { w: 200, h: 140, col: 220, phone: 36 },
    m: { w: 280, h: 196, col: 300, phone: 48 },
    l: { w: 400, h: 280, col: 420, phone: 64 },
  };
  let size = $derived(SIZES[view.homeSize]);
  let pages = $derived(ordered(store.pages, view.homeOrder, (p) => p.title, view.homeManual));

  /** Soltar um cartão sobre outro muda a ordem e a deixa manual (guardada neste computador). */
  function moveCard(from: number, to: number, after: boolean) {
    setView('homeManual', moveInOrder(pages.map((p) => p.id), from, to, after));
    setView('homeOrder', 'manual');
  }

  const itemCount = (id: number) =>
    store.pages.filter((p) => p.project_id === id).length + store.files.filter((f) => f.project_ids.includes(id)).length;
</script>

<div
  class="v2"
  role="presentation"
  oncontextmenu={(e) =>
    openMenu(e, [
      { label: t('Nova interface'), icon: Plus, kbd: 'Ctrl N', run: () => goto('/editor?novo=1') },
      { label: t('Nova pasta'), icon: FolderPlus, run: () => goto('/projetos?novo=1') },
      { separator: true },
      ...viewItems('homeSize', 'homeOrder', t('miniaturas')),
    ])}
>
  <header>
    <h1>{t('Início')}</h1>
  </header>

  {#if store.projects.length}
    <ul class="folders" aria-label={t('Pastas')}>
      {#each ordered(store.projects, view.folderOrder, (f) => f.name, view.folderManual).slice(0, 8) as f (f.id)}
        <li>
          <a href={`/projetos?id=${f.id}`}>
            <Folder size={15} strokeWidth={1.75} aria-hidden="true" />
            <span class="fname">{f.name}</span>
            <span class="count mono">{itemCount(f.id)}</span>
          </a>
        </li>
      {/each}
    </ul>
  {/if}

  <ul class="grid" aria-label={t('Interfaces')} style={`--col:${size.col}px;--shot:${size.h}px`}>
    <li>
      <button class="new" onclick={() => goto('/editor?novo=1')}>
        <Plus size={22} strokeWidth={1.5} aria-hidden="true" />
        {t('Nova interface')}
      </button>
    </li>
    {#each pages as p (p.id)}
      {@const doc = parseDoc(p.doc)}
      <li in:cardIn|global={{ skip: !ready }} animate:flip={FLIP} use:sortable={{ key: p.id, onDrop: moveCard }}>
        <a class="card" href={`/editor?id=${p.id}`} oncontextmenu={(e) => openMenu(e, pageItems(p))}>
          <span class="shot">
            <Thumb {doc} width={size.w} maxHeight={size.h - 20} />
            {#if doc.mobile}<span class="phone"><Thumb doc={doc.mobile} width={size.phone} maxHeight={size.h / 2} /></span>{/if}
          </span>
          <span class="title">{p.title}</span>
        </a>
      </li>
    {/each}
  </ul>
</div>

<style>
  .v2 {
    display: flex;
    flex-direction: column;
    gap: var(--s5);
    padding: var(--s6) var(--s7) calc(var(--s6) + var(--dock-space, 0px));
  }

  .folders {
    display: flex;
    gap: var(--s2);
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-x: auto;
  }

  .folders a {
    display: flex;
    align-items: center;
    gap: var(--s2);
    height: 36px;
    padding: 0 6px 0 12px;
    border: 1px solid var(--line);
    border-radius: 10px;
    color: var(--muted);
    text-decoration: none;
    font: 500 13px var(--font-ui);
    white-space: nowrap;
  }

  .folders a:hover {
    color: var(--fg);
    background: color-mix(in srgb, var(--fg) 7.8%, var(--bg));
  }

  .fname {
    color: var(--fg);
  }

  .count {
    padding: 1px 6px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--fg) 11%, var(--bg));
    font-size: 11px;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(var(--col, 300px), 1fr));
    gap: var(--s5) var(--s4);
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .new {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--s2);
    width: 100%;
    height: var(--shot, 196px);
    border: 1.5px dashed color-mix(in srgb, var(--fg) 23.9%, var(--bg));
    border-radius: 12px;
    background: transparent;
    color: var(--muted);
    font: 500 13px var(--font-ui);
    cursor: pointer;
    transition:
      border-color 150ms,
      color 150ms;
  }

  .new:hover {
    border-color: var(--muted);
    color: var(--fg);
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    text-decoration: none;
  }

  .shot {
    position: relative;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    height: var(--shot, 196px);
    margin-bottom: var(--s2);
    padding-top: 10px;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: color-mix(in srgb, var(--fg) 6.7%, var(--bg));
    transition: border-color 150ms;
  }

  .card:hover .shot {
    border-color: color-mix(in srgb, var(--fg) 35.3%, var(--bg));
  }

  .phone {
    position: absolute;
    right: 12px;
    bottom: 10px;
    padding: 3px;
    border-radius: 8px;
    background: var(--bg);
    box-shadow: 0 0 0 1px var(--line);
  }

  .title {
    font: 500 14px var(--font-ui);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Arrastar para reordenar: o cartão em mão fica apagado e uma linha mostra onde ele cai. */
  .grid :global(li.sorting) {
    opacity: 0.4;
  }

  .grid :global(li.drop-before),
  .grid :global(li.drop-after) {
    position: relative;
  }

  .grid :global(li.drop-before)::before,
  .grid :global(li.drop-after)::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    border-radius: 1px;
    background: var(--fg);
  }

  .grid :global(li.drop-before)::before {
    left: -9px;
  }

  .grid :global(li.drop-after)::after {
    right: -9px;
  }
</style>
