<script lang="ts">
  import { goto } from '$app/navigation';
  import { Search as SearchIcon, FolderClosed, File, PenTool } from '@lucide/svelte';
  import { store } from '$lib/store.svelte';
  import { dropdown } from '$lib/motion';

  // Arquivo abre a pasta em que está guardado.
  type Result = { kind: 'project' | 'file' | 'page'; id: number; label: string; href: string };
  const GROUP = { project: 'Pastas', file: 'Arquivos', page: 'Páginas' };

  let q = $state('');
  let open = $state(false);
  let active = $state(0);

  const norm = (s: string) =>
    s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

  let query = $derived(q.trim());
  let projects = $derived(
    query ? store.projects.filter((p) => norm(p.name).includes(norm(query))).slice(0, 5) : [],
  );
  let files = $derived(
    query ? store.files.filter((f) => f.project_ids.length && norm(f.name).includes(norm(query))).slice(0, 5) : [],
  );
  let pages = $derived(
    query ? store.pages.filter((p) => norm(p.title).includes(norm(query))).slice(0, 5) : [],
  );
  let results = $derived<Result[]>([
    ...projects.map((p) => ({ kind: 'project' as const, id: p.id, label: p.name, href: `/projetos?id=${p.id}` })),
    ...files.map((f) => ({ kind: 'file' as const, id: f.id, label: f.name, href: `/projetos?id=${f.project_ids[0]}` })),
    ...pages.map((p) => ({ kind: 'page' as const, id: p.id, label: p.title, href: `/editor?id=${p.id}` })),
  ]);
  let showList = $derived(open && query !== '');

  function oninput() {
    open = true;
    active = 0;
  }

  function go(r: Result) {
    open = false;
    q = '';
    (document.activeElement as HTMLElement | null)?.blur();
    goto(`${r.href}&n=${Date.now()}`);
  }
  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (showList) open = false;
      else (e.currentTarget as HTMLInputElement).blur();
      return;
    }
    if (!showList || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      active = (active + 1) % results.length;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active - 1 + results.length) % results.length;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(results[active]);
    }
  }
</script>

<div class="search">
  <SearchIcon size={16} strokeWidth={1.75} aria-hidden="true" />
  <label class="visually-hidden" for="busca">Buscar pastas, arquivos e páginas</label>
  <input
    id="busca"
    type="search"
    placeholder="Buscar pastas, arquivos e páginas"
    autocomplete="off"
    spellcheck="false"
    role="combobox"
    aria-expanded={showList}
    aria-controls="busca-resultados"
    aria-activedescendant={showList && results.length ? `busca-${active}` : undefined}
    bind:value={q}
    {oninput}
    {onkeydown}
    onfocus={() => (open = true)}
    onblur={() => (open = false)}
  />
  <kbd>Ctrl K</kbd>

  {#if showList}
    <!-- mousedown não tira o foco do campo, para o clique no resultado funcionar -->
    <div
      id="busca-resultados"
      class="results"
      in:dropdown
      out:dropdown={{ closing: true }}
      role="listbox"
      tabindex="-1"
      onmousedown={(e) => e.preventDefault()}
    >
      {#each results as r, i (r.kind + r.id)}
        {#if i === 0 || results[i - 1].kind !== r.kind}
          <p class="group" role="presentation">{GROUP[r.kind]}</p>
        {/if}
        <div
          id={`busca-${i}`}
          class="option"
          class:active={i === active}
          role="option"
          aria-selected={i === active}
          tabindex="-1"
          onclick={() => go(r)}
          onkeydown={() => {}}
          onmousemove={() => (active = i)}
        >
          {#if r.kind === 'project'}
            <FolderClosed size={14} strokeWidth={1.75} aria-hidden="true" />
          {:else if r.kind === 'page'}
            <PenTool size={14} strokeWidth={1.75} aria-hidden="true" />
          {:else}
            <File size={14} strokeWidth={1.75} aria-hidden="true" />
          {/if}
          <span>{r.label}</span>
        </div>
      {:else}
        <p class="none">Nada encontrado para “{query}”.</p>
      {/each}
    </div>
  {/if}
</div>

<style>
  .search {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--s2);
    flex: 1;
    max-width: 520px;
    height: 34px;
    padding: 0 var(--s3);
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    background: var(--bg);
    color: var(--muted);
  }

  .search:focus-within {
    border-color: var(--accent);
  }

  input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    color: var(--fg);
    outline: none;
  }

  input::-webkit-search-cancel-button {
    display: none;
  }

  .results {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    right: 0;
    z-index: 20;
    max-height: 360px;
    overflow: auto;
    padding: var(--s1);
    background: var(--glass);
    backdrop-filter: var(--glass-blur);
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    box-shadow: 0 12px 28px rgb(0 0 0 / 0.5);
    transform-origin: top center;
  }

  .group {
    margin: 0;
    padding: var(--s2) var(--s2) var(--s1);
    color: var(--muted);
    font: 500 12px var(--font-ui);
  }

  .option {
    display: flex;
    align-items: center;
    gap: var(--s2);
    padding: 7px var(--s2);
    border-radius: var(--r-sm);
    color: var(--fg);
    cursor: pointer;
  }

  .option span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .option.active {
    background: var(--panel);
  }

  .option.active :global(svg) {
    color: var(--accent);
  }

  .none {
    margin: 0;
    padding: var(--s3) var(--s2);
    color: var(--muted);
  }
</style>