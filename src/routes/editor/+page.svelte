<script lang="ts">
  import { untrack } from 'svelte';
  import { shakeOn } from '$lib/motion';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { Eye, Trash2, Plus } from '@lucide/svelte';
  import { api, message } from '$lib/api';
  import { store, reload, projectName } from '$lib/store.svelte';
  import { ago } from '$lib/format';
  import { emptyDoc, parseDoc } from '$lib/editor/doc';
  import Editor from '$lib/editor/Editor.svelte';
  import OpenTabs from '$lib/editor/OpenTabs.svelte';
  import { openTab, pruneTabs } from '$lib/editor/tabs.svelte';  import Thumb from '$lib/editor/Thumb.svelte';
  import { TEMPLATES, templateDoc, type Template } from '$lib/editor/layouts';
  import { t } from '$lib/i18n.svelte';

  let pageId = $derived(Number(page.url.searchParams.get('id')) || null);
  let current = $derived(store.pages.find((p) => p.id === pageId) ?? null);
  // A página aberta entra nas abas; abas de páginas excluídas saem.
  $effect(() => {
    const id = current?.id;
    // Só reage à troca de página: lendo a lista aqui, fechar a aba aberta a reabriria antes de navegar.
    if (id) untrack(() => openTab(id));
  });
  $effect(() => {
    if (store.loaded) pruneTabs(new Set(store.pages.map((p) => p.id)));
  });
  /** Tela de criar (modelos e lista de páginas): /editor?novo=1, ou ?projeto= vindo de uma pasta. */
  let creating = $derived(page.url.searchParams.has('novo') || page.url.searchParams.has('projeto'));
  /** O projeto em que você está trabalhando: a página editada por último (a lista vem da mais recente). */
  let latest = $derived(store.pages[0] ?? null);

  // Só "Editor", sem página: abre direto o trabalho atual.
  $effect(() => {
    if (!pageId && !creating && latest) goto(`/editor?id=${latest.id}`, { replaceState: true });
  });

  // Vindo de uma pasta (?projeto=), a página já nasce nela. O título é o nome do modelo e muda no Editor.
  let projectId = $derived(Number(page.url.searchParams.get('projeto')) || null);
  let formError = $state('');
  let busy = $state(false);
  let confirmDelete = $state<number | null>(null);
  // Gerados uma vez só para as miniaturas; ao criar, o modelo é gerado de novo (ids novos).
  const previews = TEMPLATES.map((tpl) => ({ tpl, doc: templateDoc(tpl) }));

  /** Um clique no modelo cria a página e abre no Editor. */
  async function create(template: Template) {
    if (busy) return;
    busy = true;
    formError = '';
    try {
      const tdoc = templateDoc(template);
      const doc = JSON.stringify(tdoc ?? emptyDoc());
      const p = await api.createPage(tdoc ? t(template.name) : t('Sem título'), projectId, doc);
      await reload();
      goto(`/editor?id=${p.id}${template.start === 'mobile' ? '&v=mobile' : ''}`);
    } catch (err) {
      formError = message(err);
    } finally {
      busy = false;
    }
  }

  async function remove(id: number) {
    try {
      await api.deletePage(id);
      confirmDelete = null;
      await reload();
    } catch (e) {
      store.error = `${t('A página não foi excluída.')} ${message(e)}`;
    }
  }
</script>

<div class="tabbed">
<OpenTabs current={current ? current.id : null} />
<div class="tab-body">
{#if pageId}
  {#if current}
    {#key current.id}
      <Editor page={current} />
    {/key}
  {:else if store.loaded}
    <div class="list-page">
      <p>{t('Esta página não existe mais.')}</p>
      <a href="/editor">{t('Abrir o projeto mais recente')}</a>
    </div>
  {/if}
{:else if !creating}
  {#if store.loaded && !latest}
    <div class="start">
      <a class="btn primary big" href="/editor?novo=1"><Plus size={18} aria-hidden="true" />{t('Começar projeto')}</a>
    </div>
  {/if}
{:else}
  <div class="list-page">
    <h1>{#if projectId && projectName(projectId)}{t('Escolha um modelo para “{name}”', { name: projectName(projectId) ?? '' })}{:else}{t('Escolha um modelo')}{/if}</h1>

    <div class="create" use:shakeOn={formError}>
      <fieldset class="models" disabled={busy}>
        {#each previews as { tpl, doc } (tpl.id)}
          <button type="button" class="model" onclick={() => create(tpl)}>
            <span class="shots">
              {#if doc && doc.mobile}
                <Thumb {doc} width={364} maxHeight={280} />
                <span class="phone"><Thumb doc={doc.mobile} width={68} maxHeight={140} /></span>
              {:else}
                <span class="blank">1440 × 1600</span>
              {/if}
            </span>
            <span class="model-name">{t(tpl.name)}</span>
          </button>
        {/each}
      </fieldset>
    </div>
    {#if formError}<p class="error-text">{formError}</p>{/if}

    {#if store.loaded && store.pages.length === 0}
      <p class="empty">{t('Nenhuma página ainda.')}</p>
    {:else}
      <ul class="pages">
        {#each store.pages as p (p.id)}
          {@const count = parseDoc(p.doc).elements.length}
          <li class="row">
            <a class="main" href={`/editor?id=${p.id}`}>
              <span class="name">{p.title}</span>
              <span class="muted small">
                {projectName(p.project_id) ? `${projectName(p.project_id)} · ` : ''}{ago(p.updated_at)}
              </span>
            </a>
            {#if confirmDelete === p.id}
              <span class="small">{t('Excluir “{title}”? Não dá para desfazer.', { title: p.title })}</span>
              <button class="btn danger" onclick={() => remove(p.id)}>{t('Excluir')}</button>
              <button class="btn" onclick={() => (confirmDelete = null)}>{t('Cancelar')}</button>
            {:else}
              <a class="btn" href={`/visualizar?id=${p.id}`}><Eye size={14} aria-hidden="true" />{t('Visualizar')}</a>
              <button class="btn" aria-label={t('Excluir {title}', { title: p.title })} onclick={() => (confirmDelete = p.id)}><Trash2 size={14} aria-hidden="true" /></button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}
</div>
</div>

<style>
  .tabbed {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    height: 100%;
  }

  .tab-body {
    min-height: 0;
    overflow: auto;
  }

  /* Sem nenhum projeto ainda: só o botão, no centro da área (acima da caixa do agente). */
  .start {
    display: grid;
    place-items: center;
    height: 100%;
    padding-bottom: var(--dock-space, 0px);
  }

  .big {
    height: 44px;
    padding: 0 22px;
    font-size: 15px;
    /* Tela vista uma vez (antes do primeiro projeto): o botão sobe 8 px e aparece, sem repetir. */
    animation: start-in 400ms cubic-bezier(0.22, 1, 0.36, 1) 80ms both;
  }

  @keyframes start-in {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }

  .list-page {
    display: flex;
    flex-direction: column;
    gap: var(--s4);
    padding: var(--s6) var(--s7) calc(var(--s6) + var(--dock-space, 0px));
    max-width: 960px;
  }

  .create {
    display: flex;
    align-items: flex-end;
    flex-wrap: wrap;
    gap: var(--s3);
    padding: var(--s4);
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    background: var(--card);
  }

  .models {
    flex-basis: 100%;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(384px, 1fr));
    gap: var(--s3);
    margin: var(--s2) 0 0;
    padding: 0;
    border: 0;
  }


  .model {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
    padding: var(--s3);
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    background: var(--panel);
    color: var(--fg);
    font: 500 13px var(--font-ui);
    text-align: left;
    cursor: pointer;
  }

  /* Um clique já cria: o hover mostra a borda branca dupla que antes marcava o escolhido. */
  .model:hover,
  .model:focus-visible {
    border-color: var(--fg);
    box-shadow: inset 0 0 0 1px var(--fg);
  }

  .shots {
    position: relative;
    display: block;
    height: 280px;
  }

  .phone {
    position: absolute;
    right: 0;
    bottom: 0;
    padding: 3px;
    border-radius: 7px;
    background: var(--bg);
    box-shadow: 0 0 0 1px var(--line);
  }

  .blank {
    display: grid;
    place-items: center;
    width: 364px;
    height: 280px;
    border: 1px dashed var(--line);
    border-radius: var(--r-sm);
    color: var(--muted);
    font: 12px var(--font-mono);
  }


  .pages {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--line);
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--s2);
    padding: var(--s2) 0;
    border-bottom: 1px solid var(--line);
  }

  .main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--s2);
    border-radius: var(--r-md);
    text-decoration: none;
  }

  .main:hover {
    background: var(--card);
  }

  .name {
    font-weight: 500;
  }

  .small {
    font-size: 12px;
  }
</style>
