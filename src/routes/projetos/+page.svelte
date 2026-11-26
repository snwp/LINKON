<script lang="ts">
  import { shakeOn } from '$lib/motion';
  import { tick } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { gsap } from 'gsap';
  import { Plus, FolderPlus, FolderOpen, PenTool, Upload, Pencil, Trash2 } from '@lucide/svelte';
  import { api, message, type Project } from '$lib/api';
  import { store, reload, addFiles } from '$lib/store.svelte';
  import { openMenu, view, viewItems, setView, ordered, moveInOrder, type MenuItem, type Size } from '$lib/menu.svelte';
  import { sortable } from '$lib/reorder';
  import { flip } from 'svelte/animate';
  import { FLIP } from '$lib/motion';
  import ProjectDetail from '$lib/ProjectDetail.svelte';

  // Pastas são os projetos do banco: cada uma guarda arquivos e interfaces (páginas do Editor).
  let projectId = $derived(Number(page.url.searchParams.get('id')) || null);
  let project = $derived(store.projects.find((p) => p.id === projectId) ?? null);

  let creating = $state(false);
  let newName = $state('');
  let formError = $state('');
  let busy = $state(false);
  let nameInput: HTMLInputElement | undefined = $state();

  const filesOf = (id: number) => store.files.filter((f) => f.project_ids.includes(id));
  const pagesOf = (id: number) => store.pages.filter((p) => p.project_id === id);
  const count = (id: number) => filesOf(id).length + pagesOf(id).length;
  /** Até três folhas aparecendo de dentro da pasta: imagens viram miniatura, o resto é folha em branco. */
  const sheets = (id: number) =>
    [...filesOf(id).map((f) => (f.kind === 'imagem' ? api.fileUrl(f) : '')), ...pagesOf(id).map(() => '')].slice(0, 3);

  /**
   * Pasta em leque, como o "3D Folder Card" do 21st.dev: no hover as folhas sobem e se abrem, e a frente
   * da pasta inclina para trás. GSAP parte sempre do valor atual, então dá para sair no meio do movimento.
   */
  function fan(card: HTMLElement) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const sheets = () => [...card.querySelectorAll<HTMLElement>('.sheet')];
    const front = card.querySelector<HTMLElement>('.front');
    const mid = () => (sheets().length - 1) / 2;
    const rest = () => {
      gsap.to(sheets(), { x: 0, y: 0, rotation: (i) => (i - mid()) * 5, duration: 0.45, ease: 'power3.out', overwrite: 'auto' });
      if (front) gsap.to(front, { rotationX: 0, duration: 0.45, ease: 'power3.out', overwrite: 'auto' });
    };
    const open = () => {
      gsap.to(sheets(), {
        x: (i) => (i - mid()) * 22,
        y: -30,
        rotation: (i) => (i - mid()) * 14,
        duration: 0.55,
        ease: 'back.out(1.7)',
        stagger: 0.03,
        overwrite: 'auto',
      });
      if (front) gsap.to(front, { rotationX: -22, duration: 0.5, ease: 'power3.out', overwrite: 'auto' });
    };
    gsap.set(sheets(), { rotation: (i) => (i - mid()) * 5 });
    card.addEventListener('pointerenter', open);
    card.addEventListener('pointerleave', rest);
    card.addEventListener('focus', open);
    card.addEventListener('blur', rest);
    return {
      destroy() {
        card.removeEventListener('pointerenter', open);
        card.removeEventListener('pointerleave', rest);
        card.removeEventListener('focus', open);
        card.removeEventListener('blur', rest);
        gsap.killTweensOf([...sheets(), front]);
      },
    };
  }

  // Tamanho e ordem escolhidos no botão direito (guardados neste computador).
  const SCALE: Record<Size, number> = { s: 0.7, m: 1, l: 1.4 };
  let folders = $derived(ordered(store.projects, view.folderOrder, (p) => p.name, view.folderManual));

  /** Soltar uma pasta sobre outra muda a ordem e a deixa manual (guardada neste computador). */
  function moveFolder(from: number, to: number, after: boolean) {
    setView('folderManual', moveInOrder(folders.map((p) => p.id), from, to, after));
    setView('folderOrder', 'manual');
  }

  /** Atalhos do botão direito sobre uma pasta. */
  function folderItems(p: Project): MenuItem[] {
    return [
      { label: 'Abrir', icon: FolderOpen, run: () => goto(`/projetos?id=${p.id}`) },
      { label: 'Nova interface nesta pasta', icon: PenTool, run: () => goto(`/editor?projeto=${p.id}`) },
      { label: 'Adicionar arquivos', icon: Upload, run: () => addFiles({ projectId: p.id }) },
      { label: 'Renomear', icon: Pencil, run: () => goto(`/projetos?id=${p.id}&renomear=1`) },
      { separator: true },
      {
        label: 'Excluir pasta',
        icon: Trash2,
        danger: true,
        confirm: 'Confirmar: excluir a pasta',
        run: async () => {
          try {
            await api.deleteProject(p.id);
            await reload();
          } catch (err) {
            store.error = `A pasta não foi excluída. ${message(err)}`;
          }
        },
      },
    ];
  }

  // "Nova pasta" no Início chega com ?novo=1.
  $effect(() => {
    if (page.url.searchParams.has('novo')) startCreate();
  });

  async function startCreate() {
    creating = true;
    await tick();
    nameInput?.focus();
  }

  async function create(e: SubmitEvent) {
    e.preventDefault();
    if (busy || !newName.trim()) return;
    busy = true;
    formError = '';
    try {
      const id = await api.createProject(newName);
      newName = '';
      creating = false;
      await reload();
      goto(`/projetos?id=${id}`);
    } catch (err) {
      formError = message(err);
    } finally {
      busy = false;
    }
  }
</script>

<div class="folders">
  <section class="main">
    {#if projectId}
      {#if project}
        {#key project.id}
          <ProjectDetail {project} />
        {/key}
      {:else if store.loaded}
        <div class="pad">
          <p>Esta pasta não existe mais.</p>
          <a href="/projetos">Ver pastas</a>
        </div>
      {/if}
    {:else}
      <div
        class="pad"
        role="presentation"
        oncontextmenu={(e) =>
          openMenu(e, [{ label: 'Nova pasta', icon: FolderPlus, run: startCreate }, { separator: true }, ...viewItems('folderSize', 'folderOrder', 'pastas')])}
      >
        <div class="head">
          <h1>Pastas</h1>
          {#if creating}
            <form class="create" onsubmit={create} use:shakeOn={formError}>
              <label class="visually-hidden" for="nova-pasta">Nome da nova pasta</label>
              <input
                id="nova-pasta"
                class="field"
                placeholder="Nome da pasta"
                maxlength="120"
                bind:value={newName}
                bind:this={nameInput}
                onkeydown={(e) => e.key === 'Escape' && ((creating = false), (newName = ''))}
              />
              <button class="btn primary" type="submit" disabled={busy || !newName.trim()}>Criar</button>
              <button class="btn" type="button" onclick={() => ((creating = false), (newName = ''))}>Cancelar</button>
            </form>
          {:else if store.projects.length}
            <button class="btn" onclick={startCreate}><Plus size={16} aria-hidden="true" />Nova pasta</button>
          {/if}
        </div>
        {#if formError}<p class="error-text">{formError}</p>{/if}
        {#if store.loaded && store.projects.length === 0}
          {#if !creating}<div class="empty-state">
            <button class="btn primary" onclick={startCreate}><Plus size={16} aria-hidden="true" />Criar a primeira pasta</button>
          </div>{/if}
        {:else}
          <ul class="grid" style={`--k:${SCALE[view.folderSize]}`}>
            {#each folders as p (p.id)}
              {@const n = count(p.id)}
              <li animate:flip={FLIP} use:sortable={{ key: p.id, onDrop: moveFolder }}>
                <a class="card" href={`/projetos?id=${p.id}`} use:fan oncontextmenu={(e) => openMenu(e, folderItems(p))}>
                  <span class="art" aria-hidden="true">
                    <span class="back"></span>
                    {#each sheets(p.id) as src, i (i)}
                      <span class="sheet" style={`--i:${i}`}>{#if src}<img {src} alt="" loading="lazy" />{/if}</span>
                    {/each}
                    <span class="front"></span>
                  </span>
                  <span class="card-name">{p.name}</span>
                  <span class="muted small">{n === 1 ? '1 item' : `${n} itens`}</span>
                </a>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}
  </section>
</div>

<style>
  .folders {
    height: 100%;
  }

  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    /* Botão e formulário ficam colados ao título: criar acontece todo do mesmo lado. */
    gap: var(--s3) var(--s5);
    /* O botão é 8px mais alto que o título: assim o título fica na mesma altura das outras telas. */
    margin-block: calc(var(--s1) * -1);
  }

  .create {
    display: flex;
    gap: var(--s2);
  }

  .create .field {
    width: 240px;
  }

  .main {
    min-width: 0;
    overflow: auto;
  }

  .pad {
    display: flex;
    flex-direction: column;
    gap: var(--s5);
    padding: var(--s6) var(--s7) calc(var(--s6) + var(--dock-space, 0px));
  }

  .small {
    font-size: 12px;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--s3);
    max-width: 460px;
    color: var(--muted);
  }

  .grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(calc(200px * var(--k, 1)), 1fr));
    gap: var(--s3);
  }

  /* Arrastar para reordenar: a pasta em mão fica apagada e uma linha mostra onde ela cai. */
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
    top: 8px;
    bottom: 8px;
    width: 2px;
    border-radius: 1px;
    background: var(--fg);
  }

  .grid :global(li.drop-before)::before {
    left: -7px;
  }

  .grid :global(li.drop-after)::after {
    right: -7px;
  }

  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: var(--s4) var(--s3) var(--s3);
    border-radius: var(--r-md);
    text-decoration: none;
  }

  .card:hover {
    background: var(--card);
  }

  .card-name {
    margin-top: var(--s2);
    font: 500 14px var(--font-ui);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Pasta desenhada em CSS: fundo com aba, folhas saindo e a frente por cima. */
  /* zoom escala a pasta inteira (fundo, folhas e frente) pelo tamanho escolhido no botão direito. */
  .art {
    position: relative;
    perspective: 600px;
    width: 160px;
    height: 120px;
    zoom: var(--k, 1);
  }

  .back {
    position: absolute;
    inset: 12px 0 0;
    border-radius: 6px 10px 10px 10px;
    background: #2a2a2a;
  }

  .back::before {
    content: '';
    position: absolute;
    top: -12px;
    left: 0;
    width: 64px;
    height: 16px;
    border-radius: 6px 6px 0 0;
    background: #2a2a2a;
  }

  .sheet {
    position: absolute;
    top: calc(20px + var(--i) * 6px);
    left: calc(22px + var(--i) * 30px);
    width: 62px;
    height: 76px;
    overflow: hidden;
    border-radius: 4px;
    background: #e6e6e6;
  }

  .sheet img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .front {
    position: absolute;
    inset: 46px 0 0;
    border-radius: 8px 8px 10px 10px;
    background: #3a3a3a;
    box-shadow: 0 -1px 0 #4a4a4a;
    transform-origin: 50% 100%;
  }

</style>
