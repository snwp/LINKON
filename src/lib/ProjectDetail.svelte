<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { Plus, Trash2, Upload, ExternalLink, PenTool, Pencil } from '@lucide/svelte';
  import { openMenu, pageItems } from '$lib/menu.svelte';
  import { api, message, type FileItem, type Project } from '$lib/api';
  import { store, reload, addFiles } from '$lib/store.svelte';
  import { ago, bytes, KIND_LABELS } from '$lib/format';
  import KindIcon from '$lib/KindIcon.svelte';
  import Thumb from '$lib/editor/Thumb.svelte';
  import { parseDoc } from '$lib/editor/doc';
  import { flip } from 'svelte/animate';
  import { cardIn, FLIP } from '$lib/motion';

  /** Conteúdo de uma pasta: interfaces (páginas do Editor) e arquivos. */
  let { project }: { project: Project } = $props();

  // svelte-ignore state_referenced_locally
  let name = $state(project.name);
  let renameError = $state('');
  let confirming = $state(false);
  let confirmFile = $state<number | null>(null);

  let files = $derived(store.files.filter((f) => f.project_ids.includes(project.id)));
  let pages = $derived(store.pages.filter((p) => p.project_id === project.id));

  async function saveName() {
    if (name.trim() === project.name) return;
    renameError = '';
    try {
      await api.renameProject(project.id, name);
      await reload();
    } catch (e) {
      renameError = message(e);
      name = project.name;
    }
  }

  async function remove() {
    try {
      await api.deleteProject(project.id);
      await reload();
      goto('/projetos');
    } catch (e) {
      confirming = false;
      store.error = `A pasta não foi excluída. ${message(e)}`;
    }
  }

  async function removeFile(f: FileItem) {
    try {
      await api.deleteFile(f.id);
      confirmFile = null;
      await reload();
    } catch (e) {
      store.error = `O arquivo não foi excluído. ${message(e)}`;
    }
  }

  let nameInput: HTMLInputElement | undefined = $state();
  // Só interfaces que chegam depois da pasta aberta (ex.: Duplicar) entram com animação.
  let ready = $state(false);
  // "Renomear" no botão direito da pasta chega com ?renomear=1.
  onMount(() => {
    requestAnimationFrame(() => (ready = true));
    if (page.url.searchParams.has('renomear')) renameNow();
  });

  function renameNow() {
    nameInput?.focus();
    nameInput?.select();
  }

  async function openFile(f: FileItem) {
    try {
      await api.openFile(f);
    } catch (e) {
      store.error = `Não foi possível abrir o arquivo. ${message(e)}`;
    }
  }
</script>

<div
  class="folder"
  role="presentation"
  oncontextmenu={(e) =>
    openMenu(e, [
      { label: 'Nova interface', icon: PenTool, run: () => goto(`/editor?projeto=${project.id}`) },
      { label: 'Adicionar arquivos', icon: Upload, run: () => addFiles({ projectId: project.id }) },
      { label: 'Renomear pasta', icon: Pencil, run: renameNow },
    ])}
>
  <div class="top">
  <div class="title">
  <nav class="crumbs" aria-label="Caminho"><a href="/projetos">Pastas</a> <span aria-hidden="true">/</span></nav>
  <label class="visually-hidden" for="nome-pasta">Nome da pasta</label>
  <input
    id="nome-pasta"
    class="name"
    bind:this={nameInput}
    maxlength="120"
    bind:value={name}
    onblur={saveName}
    onkeydown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
  />
  {#if renameError}<p class="error-text">{renameError}</p>{/if}
  </div>

  <div class="bar">
    {#if confirming}
      <span class="small">Excluir “{project.name}”? As interfaces continuam no Editor, sem pasta.</span>
      <button class="btn danger" onclick={remove}>Excluir pasta</button>
      <button class="btn" onclick={() => (confirming = false)}>Cancelar</button>
    {:else}
      <button class="btn icon-btn" onclick={() => (confirming = true)} aria-label="Excluir pasta" data-tip="Excluir pasta">
        <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <button class="btn" onclick={() => addFiles({ projectId: project.id })}>
        <Upload size={14} strokeWidth={1.75} aria-hidden="true" />
        Adicionar arquivos
      </button>
      <a class="btn primary" href={`/editor?projeto=${project.id}`}>
        <Plus size={16} strokeWidth={2} aria-hidden="true" />
        Nova interface
      </a>
    {/if}
  </div>
  </div>

  <section class="group">
  <h2>Interfaces</h2>
  {#if pages.length === 0}
    <p class="empty">Nenhuma interface ainda.</p>
  {:else}
    <ul class="pages">
      {#each pages as p (p.id)}
        {@const doc = parseDoc(p.doc)}
        <li in:cardIn|global={{ skip: !ready }} animate:flip={FLIP}>
          <a class="page-card" href={`/editor?id=${p.id}`} oncontextmenu={(e) => openMenu(e, pageItems(p))}>
            <span class="shot"><Thumb {doc} width={236} maxHeight={148} /></span>
            <span class="page-title">{p.title}</span>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
  </section>

  <section class="group">
  <h2>Arquivos</h2>
  {#if files.length === 0}
    <p class="empty">Nenhum arquivo ainda.</p>
  {:else}
    <table class="files">
      <thead>
        <tr><th>Nome</th><th>Tipo</th><th>Tamanho</th><th>Adicionado</th><th><span class="visually-hidden">Ações</span></th></tr>
      </thead>
      <tbody>
        {#each files as f (f.id)}
          <tr
            oncontextmenu={(e) =>
              openMenu(e, [
                { label: 'Abrir', icon: ExternalLink, run: () => openFile(f) },
                { separator: true },
                { label: 'Excluir arquivo', icon: Trash2, danger: true, confirm: 'Confirmar: excluir de vez', run: () => removeFile(f) },
              ])}
          >
            <td>
              <div class="file-name">
                {#if f.kind === 'imagem'}
                  <img class="mini" src={api.fileUrl(f)} alt="" loading="lazy" />
                {:else}
                  <span class="mini icon"><KindIcon kind={f.kind} size={14} /></span>
                {/if}
                <span title={f.name}>{f.name}</span>
              </div>
            </td>
            <td class="muted">{KIND_LABELS[f.kind].one}</td>
            <td class="muted mono">{bytes(f.size)}</td>
            <td class="muted">{ago(f.imported_at)}</td>
            <td class="actions">
              {#if confirmFile === f.id}
                <span class="small">Excluir? Interfaces que usam este arquivo ficam sem ele.</span>
                <button class="btn danger" onclick={() => removeFile(f)}>Excluir</button>
                <button class="btn" onclick={() => (confirmFile = null)}>Cancelar</button>
              {:else}
                <button class="btn icon-btn" onclick={() => openFile(f)} aria-label={`Abrir ${f.name}`} data-tip="Abrir"><ExternalLink size={14} aria-hidden="true" /></button>
                <button class="btn icon-btn" onclick={() => (confirmFile = f.id)} aria-label={`Excluir ${f.name}`} data-tip="Excluir"><Trash2 size={14} aria-hidden="true" /></button>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
  </section>
</div>

<style>
  .folder {
    display: flex;
    flex-direction: column;
    gap: var(--s6);
    padding: var(--s6) var(--s7) calc(var(--s6) + var(--dock-space, 0px));
  }

  /* Título e ações na mesma linha; a linha embaixo fecha o cabeçalho. */
  .top {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--s3) var(--s5);
    padding-bottom: var(--s4);
    border-bottom: 1px solid var(--line);
  }

  .title {
    display: flex;
    flex-direction: column;
    gap: var(--s1);
    flex: 1 1 280px;
    min-width: 0;
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: var(--s3);
  }

  .crumbs {
    font-size: 13px;
    color: var(--muted);
  }

  .crumbs a {
    color: var(--muted);
    text-decoration: none;
  }

  .crumbs a:hover {
    color: var(--fg);
  }

  .name {
    border: 0;
    border-bottom: 1px solid transparent;
    background: transparent;
    font: 600 28px/1.2 var(--font-ui);
    letter-spacing: -0.015em;
    padding: 0 0 var(--s1);
    outline: none;
  }

  .name:hover {
    border-bottom-color: var(--line);
  }

  .name:focus {
    border-bottom-color: var(--accent);
  }

  .bar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--s2);
  }

  .icon-btn {
    width: 32px;
    padding: 0;
    justify-content: center;
  }

  .small {
    font-size: 12px;
  }

  h2 {
    font-size: 16px;
  }

  .pages {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: var(--s3);
  }

  .page-card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: var(--s3);
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    background: var(--panel);
    text-decoration: none;
  }

  .page-card:hover {
    border-color: var(--muted);
  }

  .shot {
    display: flex;
    justify-content: center;
    height: 148px;
    margin-bottom: var(--s2);
    overflow: hidden;
    border-radius: var(--r-sm);
    background: var(--sheet);
  }

  .page-title {
    font: 500 14px var(--font-ui);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .files {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }

  .files th {
    padding: var(--s2);
    border-bottom: 1px solid var(--line);
    color: var(--muted);
    font: 500 12px var(--font-ui);
    text-align: left;
  }

  .files td {
    padding: var(--s2);
    border-bottom: 1px solid var(--line);
    vertical-align: middle;
  }

  .files tbody tr:hover {
    background: var(--panel);
  }

  .file-name {
    display: flex;
    align-items: center;
    gap: var(--s2);
    max-width: 420px;
  }

  .file-name span:last-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mini {
    flex: none;
    width: 28px;
    height: 28px;
    border-radius: var(--r-sm);
    object-fit: cover;
    background: var(--card);
  }

  .mini.icon {
    display: grid;
    place-items: center;
    color: var(--muted);
  }

  .actions {
    text-align: right;
    white-space: nowrap;
  }

  .actions .btn {
    margin-left: 4px;
  }
</style>
