<script lang="ts">
  import '@fontsource-variable/geist';
  import '@fontsource-variable/geist-mono';
  import '@fontsource-variable/inter';
  import '../app.css';
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { getCurrentWebview } from '@tauri-apps/api/webview';
  import { afterNavigate } from '$app/navigation';
  import { gsap } from 'gsap';
  import { House, FolderClosed, PenTool, ChartColumn, Settings, Plus, Upload, X } from '@lucide/svelte';
  import Search from '$lib/Search.svelte';
  import AgentBar from '$lib/AgentBar.svelte';
  import Tooltip from '$lib/Tooltip.svelte';
  import ContextMenu from '$lib/ContextMenu.svelte';
  import { openMenu } from '$lib/menu.svelte';
  import { Search as SearchIcon, FolderPlus } from '@lucide/svelte';
  import { toast } from '$lib/motion';
  import { isTauri } from '$lib/api';
  import { store, reload, addFiles, projectName } from '$lib/store.svelte';
  import { flushAll } from '$lib/pending';
  import { t } from '$lib/i18n.svelte';

  let { children } = $props();

  const nav = [
    { href: '/', label: 'Início', icon: House },
    { href: '/projetos', label: 'Pastas', icon: FolderClosed },
    { href: '/editor', label: 'Editor', icon: PenTool },
    { href: '/uso', label: 'Uso', icon: ChartColumn },
  ];

  let editorOpen = $derived(page.url.pathname.startsWith('/editor') && !!page.url.searchParams.get('id'));
  // Caixa do agente em todas as telas, menos na visualização e no Editor aberto (lá o Claude tem a coluna dele).
  let showDock = $derived(!page.url.pathname.startsWith('/visualizar') && !editorOpen);

  let main: HTMLElement | undefined = $state();

  // Cada tela entra subindo 8 px e saindo do desfoque (GSAP). Com movimento reduzido, aparece direto.
  afterNavigate(({ from, to }) => {
    // Na primeira carga não há tela anterior (from.url vem nulo).
    if (!main || !from?.url || from.url.pathname === to?.url?.pathname) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    gsap.fromTo(
      main,
      { autoAlpha: 0, y: 8, filter: 'blur(2px)' },
      { autoAlpha: 1, y: 0, filter: 'blur(0px)', duration: 0.35, ease: 'expo.out', clearProps: 'all' },
    );
  });

  let dragging = $state(false);
  // Soltar arquivos com uma pasta aberta já associa a ele.
  let dropProject = $derived(
    page.url.pathname.startsWith('/projetos') ? Number(page.url.searchParams.get('id')) || null : null,
  );

  function isActive(href: string) {
    if (href === '/') return page.url.pathname === '/';
    // A visualização faz parte do Editor.
    if (href === '/editor' && page.url.pathname.startsWith('/visualizar')) return true;
    return page.url.pathname.startsWith(href);
  }

  function newPage() {
    goto('/editor?novo=1');
  }

  /**
   * Menu geral do botão direito, onde nenhuma tela montou um menu próprio.
   * Em campos de texto fica o menu do sistema (copiar, colar).
   */
  function oncontextmenu(e: MouseEvent) {
    if (e.defaultPrevented) return;
    const el = e.target as HTMLElement;
    if (el.closest('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]')) return;
    openMenu(e, [
      { label: t('Nova página'), icon: Plus, kbd: 'Ctrl N', run: newPage },
      { label: t('Nova pasta'), icon: FolderPlus, run: () => goto('/projetos?novo=1') },
      { separator: true },
      { label: t('Buscar'), icon: SearchIcon, kbd: 'Ctrl K', run: () => document.getElementById('busca')?.focus() },
    ]);
  }

  function onkeydown(e: KeyboardEvent) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'k') {
      e.preventDefault();
      document.getElementById('busca')?.focus();
    } else if (k === 'n') {
      e.preventDefault();
      newPage();
    }
  }

  onMount(() => {
    reload();
    if (!isTauri) return;
    // Antes de fechar, grava o que estiver pendente. Se falhar, avisa uma vez e só fecha na segunda tentativa.
    let warned = false;
    const unlisteners: Promise<() => void>[] = [
      getCurrentWindow().onCloseRequested(async (e) => {
        const ok = await flushAll();
        if (!ok && !warned) {
          e.preventDefault();
          warned = true;
          store.error = t('Algumas alterações não foram salvas. Feche de novo para sair mesmo assim.');
        }
      }),
      // Arrastar arquivos do sistema para qualquer tela importa (as imagens ficam disponíveis no Editor).
      getCurrentWebview().onDragDropEvent((e) => {
        const p = e.payload;
        if (p.type === 'enter') dragging = p.paths.length > 0;
        else if (p.type === 'leave') dragging = false;
        else if (p.type === 'drop') {
          dragging = false;
          if (p.paths.length) addFiles({ projectId: dropProject }, p.paths);
        }
      }),
    ];
    return () => unlisteners.forEach((u) => u.then((f) => f()));
  });
</script>

<svelte:window {onkeydown} />
<svelte:document {oncontextmenu} />

<div class="app">
  <aside class="sidebar">
    <a class="brand" href="/" aria-label={t('Linkon, início')}>linkon</a>
    <nav aria-label={t('Principal')}>
      {#each nav as item (item.href)}
        <a class="nav-link" href={item.href} aria-current={isActive(item.href) ? 'page' : undefined}>
          <item.icon size={16} strokeWidth={1.75} aria-hidden="true" />
          {t(item.label)}
        </a>
      {/each}
    </nav>
    <a
      class="nav-link settings"
      href="/configuracoes"
      aria-current={isActive('/configuracoes') ? 'page' : undefined}
    >
      <Settings size={16} strokeWidth={1.75} aria-hidden="true" />
      {t('Configurações')}
    </a>
  </aside>

  <div class="column">
    <header class="topbar">
      <Search />
      <button class="btn primary" onclick={newPage}>
        <Plus size={16} strokeWidth={2} aria-hidden="true" />
        {t('Nova página')}
      </button>
    </header>

    {#if !isTauri}
      <p class="preview-note">{t('Prévia no navegador. Os dados ficam só nesta aba e somem ao recarregar.')}</p>
    {/if}

    <!-- Avisos no canto (Transitions.dev — Toast open/close); o erro vem invertido, em branco. -->
    <div class="toasts">
      {#if store.error}
        <div class="toast alert" role="alert" in:toast out:toast={{ closing: true }}>
          <span>{store.error}</span>
          <button class="x" aria-label={t('Fechar aviso')} onclick={() => (store.error = '')}><X size={14} aria-hidden="true" /></button>
        </div>
      {/if}
      {#if store.notice}
        <div class="toast" role="status" in:toast out:toast={{ closing: true }}>
          {#if !store.notice.endsWith('…')}
            <!-- Transitions.dev — Success check: o traço se desenha enquanto o ícone gira e assenta. -->
            <span class="check" aria-hidden="true"><svg viewBox="0 0 16 16" width="16" height="16" fill="none"><path d="M3.5 8.5l3 3 6-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg></span>
          {/if}
          <span>{store.notice}</span>
          {#if store.noticeHref}
            <a class="btn" href={store.noticeHref} onclick={() => (store.notice = '')}>{t('Abrir')}</a>
            <button class="x" aria-label={t('Fechar aviso')} onclick={() => (store.notice = '')}><X size={14} aria-hidden="true" /></button>
          {/if}
        </div>
      {/if}
    </div>

    <main class="content" bind:this={main} class:docked={showDock}>
      {@render children()}
    </main>

    {#if showDock}
      <!-- Caixa do agente sempre à mão, embaixo no centro. -->
      <div class="dock"><AgentBar /></div>
    {/if}
  </div>
</div>

<Tooltip />
<ContextMenu />

{#if dragging}
  <div class="drop" aria-hidden="true">
    <p>
      <Upload size={22} strokeWidth={1.5} />
      {#if dropProject && projectName(dropProject)}{t('Solte para importar as imagens na pasta “{name}”.', { name: projectName(dropProject) ?? '' })}{:else}{t('Solte para importar as imagens.')}{/if}
    </p>
  </div>
{/if}

<style>
  .app {
    display: grid;
    grid-template-columns: 216px minmax(0, 1fr);
    height: 100vh;
  }

  .sidebar {
    display: flex;
    flex-direction: column;
    gap: var(--s5);
    /* Topo igual ao da barra de cima (8 px), para o logotipo ficar na mesma linha da busca. */
    padding: var(--s2) var(--s3) var(--s4);
    background: var(--panel);
    border-right: 1px solid var(--line);
  }

  /*
   * Logotipo: só a palavra, na Science Gothic Light 300, em maiúsculas e com as letras espaçadas.
   * Centralizado na largura do menu e na altura da busca (34 px). O espaçamento também entra depois do
   * último N; o mesmo meio em à esquerda equilibra, senão a palavra parece deslocada para a esquerda.
   */
  .brand {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 34px;
    padding-left: 0.5em;
    font: 300 19px var(--font-logo);
    letter-spacing: 0.5em;
    text-transform: uppercase;
    text-decoration: none;
  }

  nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  /* Itens do menu no desenho do BoardUI: raio 10, e o ativo ganha anel fino e luz por cima. */
  .nav-link {
    display: flex;
    align-items: center;
    gap: var(--s3);
    height: 36px;
    padding: 0 10px;
    border-radius: 10px;
    color: var(--muted);
    text-decoration: none;
    font: 500 13px var(--font-ui);
    transition:
      background-color 300ms cubic-bezier(0.4, 0, 0.2, 1),
      color 150ms,
      transform 100ms ease-out;
  }

  .nav-link:hover {
    color: var(--fg);
    background: color-mix(in srgb, var(--fg) 8.6%, var(--bg));
  }

  .nav-link[aria-current='page'] {
    color: var(--fg);
    background: color-mix(in srgb, var(--fg) 11%, var(--bg));
    box-shadow:
      0 0 0 1px var(--line),
      inset 0 1px 0 color-mix(in srgb, var(--fg) 6%, transparent);
  }

  .settings {
    margin-top: auto;
  }

  .column {
    position: relative;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  .dock {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 16px;
    z-index: 30;
    display: flex;
    justify-content: center;
    pointer-events: none;
  }

  .dock > :global(*) {
    pointer-events: auto;
  }


  /* Espaço da caixa do agente: cada tela que rola reserva por dentro (--dock-space), assim as que
     ocupam a altura inteira (Pastas) não ficam com bordas cortadas acima da caixa. */
  .content.docked {
    --dock-space: 136px;
  }

  /* Busca no centro da barra; "Nova página" na ponta direita. */
  .topbar {
    display: grid;
    grid-template-columns: 1fr minmax(0, 560px) 1fr;
    align-items: center;
    gap: var(--s3);
    padding: var(--s2) var(--s4);
    /* Sem faixa: a busca e o botão flutuam sobre o fundo do app. */
    background: transparent;
  }

  .topbar > :global(.search) {
    grid-column: 2;
    max-width: none;
  }

  .topbar > .btn {
    grid-column: 3;
    justify-self: end;
  }

  .preview-note {
    margin: 0;
    padding: var(--s1) var(--s4);
    border-bottom: 1px solid var(--line);
    color: var(--muted);
    font: 400 12px var(--font-mono);
  }

  .toasts {
    position: absolute;
    top: 60px;
    right: 16px;
    z-index: 40;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--s2);
    pointer-events: none;
  }

  .toast {
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: 420px;
    padding: 10px 14px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: color-mix(in srgb, var(--fg) 7.8%, var(--bg));
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--fg) 4%, transparent),
      0 12px 32px rgb(0 0 0 / 0.55);
    font-size: 13px;
    pointer-events: auto;
  }

  /* Erro invertido: o único cartão branco do app chama atenção sem precisar de cor. */
  .toast.alert {
    background: var(--fg);
    color: var(--bg);
    border-color: var(--fg);
    font-weight: 500;
  }

  .x {
    display: grid;
    place-items: center;
    flex: none;
    width: 24px;
    height: 24px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .x:hover {
    background: rgb(0 0 0 / 0.1);
  }

  /* Transitions.dev — Success check (entrada: gira 80°, sai do desfoque e o traço se desenha). */
  .check {
    display: inline-flex;
    flex: none;
    animation:
      check-in 500ms cubic-bezier(0.22, 1, 0.36, 1) both,
      check-bob 500ms cubic-bezier(0.34, 1.35, 0.64, 1) both;
  }

  .check path {
    stroke-dasharray: 20;
    stroke-dashoffset: 20;
    animation: check-draw 500ms cubic-bezier(0.22, 1, 0.36, 1) 80ms forwards;
  }

  @keyframes check-in {
    from {
      opacity: 0;
      transform: rotate(80deg);
      filter: blur(10px);
    }
  }

  @keyframes check-bob {
    from {
      translate: 0 12px;
    }
  }

  @keyframes check-draw {
    to {
      stroke-dashoffset: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .check path {
      stroke-dashoffset: 0;
    }
  }

  .content {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }

  .drop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--bg) 86%, transparent);
    pointer-events: none;
  }

  /* Área de soltar no desenho do dropzone do BoardUI: tracejado largo, ícone e uma frase. */
  .drop p {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s3);
    margin: 0;
    padding: var(--s7) 64px;
    border: 1.5px dashed color-mix(in srgb, var(--fg) 42%, var(--bg));
    border-radius: 16px;
    background: var(--glass);
    backdrop-filter: var(--glass-blur);
    font: 500 15px var(--font-ui);
    animation: surface-in 200ms cubic-bezier(0.22, 1, 0.36, 1);
  }
</style>
