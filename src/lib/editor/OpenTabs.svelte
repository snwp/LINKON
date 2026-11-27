<script lang="ts">
  import { goto } from '$app/navigation';
  import { Plus, X } from '@lucide/svelte';
  import { store } from '$lib/store.svelte';
  import { t } from '$lib/i18n.svelte';
  import { tabs, closeTab } from './tabs.svelte';

  /** Página aberta agora (null na escolha de modelo). */
  let { current }: { current: number | null } = $props();

  let open = $derived(tabs.ids.map((id) => store.pages.find((p) => p.id === id)).filter((p) => !!p));

  function close(e: MouseEvent, id: number) {
    e.preventDefault();
    e.stopPropagation();
    const next = closeTab(id);
    if (id === current) goto(next ? `/editor?id=${next}` : '/editor?novo=1');
  }
</script>

<nav class="tabs" aria-label={t('Projetos abertos')}>
  {#each open as p (p.id)}
    <div class="tab" class:on={p.id === current}>
      <a class="name" href={`/editor?id=${p.id}`} aria-current={p.id === current ? 'page' : undefined} title={p.title}>{p.title}</a>
      <button class="close" onclick={(e) => close(e, p.id)} aria-label={t('Fechar “{title}”', { title: p.title })}><X size={14} aria-hidden="true" /></button>
    </div>
  {/each}
  <a class="new" href="/editor?novo=1" aria-label={t('Abrir outro projeto')} data-tip={t('Abrir outro projeto')}><Plus size={16} aria-hidden="true" /></a>
</nav>

<style>
  .tabs {
    display: flex;
    align-items: stretch;
    height: 38px;
    overflow-x: auto;
    scrollbar-width: none;
    border-bottom: 1px solid var(--line);
    background: var(--bg);
  }

  .tab {
    position: relative;
    display: flex;
    flex: 0 1 220px;
    align-items: center;
    gap: var(--s2);
    min-width: 120px;
    padding: 0 6px 0 0;
    border-right: 1px solid var(--line);
    color: var(--muted);
    font-size: 13px;
  }

  .tab:hover {
    color: var(--fg);
  }

  /* A aba aberta tem o fundo da barra do editor logo abaixo, como se continuasse nela. */
  .tab.on {
    background: var(--panel);
    color: var(--fg);
  }

  .tab.on::after {
    content: '';
    position: absolute;
    right: 0;
    bottom: -1px;
    left: 0;
    height: 1px;
    background: var(--panel);
  }

  .name {
    align-self: stretch;
    display: block;
    line-height: 38px;
    padding-left: var(--s3);
    color: inherit;
    text-decoration: none;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .close {
    display: grid;
    place-items: center;
    flex: none;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: var(--r-sm);
    background: none;
    color: inherit;
    opacity: 0;
    cursor: pointer;
  }

  .tab:hover .close,
  .tab.on .close,
  .close:focus-visible {
    opacity: 1;
  }

  .close:hover {
    background: var(--card);
  }

  .new {
    display: grid;
    place-items: center;
    flex: none;
    width: 38px;
    color: var(--muted);
  }

  .new:hover {
    color: var(--fg);
  }
</style>
