<script lang="ts">
  import { slidingPill, frameIn } from '$lib/motion';
  import { page } from '$app/state';
  import { PenLine, Globe, Rocket, Monitor, Smartphone, ExternalLink, TriangleAlert, CircleX } from '@lucide/svelte';
  import { api, message, type PublishCheck } from '$lib/api';
  import { siteHtml } from '$lib/site';
  import { store, notify } from '$lib/store.svelte';
  import { parseDoc } from '$lib/editor/doc';
  import { renderHtml } from '$lib/editor/render';
  import { refInfo } from '$lib/editor/refs';
  import { fontCss } from '$lib/editor/fonts';
  import { t } from '$lib/i18n.svelte';

  let pageId = $derived(Number(page.url.searchParams.get('id')) || null);
  let current = $derived(store.pages.find((p) => p.id === pageId) ?? null);
  let doc = $derived(current ? parseDoc(current.doc) : null);
  let view = $state<'desktop' | 'mobile'>(page.url.searchParams.get('v') === 'mobile' ? 'mobile' : 'desktop');
  /** Versão mostrada aqui. A exportação leva as duas. */
  let frame = $derived(doc && view === 'mobile' && doc.mobile ? doc.mobile : doc ? { ...doc, mobile: undefined } : null);

  let mode = $state<'ajustar' | 'real'>('ajustar');
  let backdrop = $state<'escuro' | 'claro'>('escuro');
  let viewport: HTMLDivElement | undefined = $state();
  let viewW = $state(1200);
  let busy = $state<'' | 'browser' | 'review' | 'publish'>('');
  let fonts = $state('');

  // As fontes chegam depois (leitura assíncrona); até lá a página aparece com a fonte do sistema.
  $effect(() => {
    if (doc) fontCss(doc).then((css) => (fonts = css));
  });

  // A visualização usa o mesmo HTML da exportação; só as imagens apontam para a Biblioteca do app.
  let html = $derived(
    current && frame
      ? renderHtml(frame, {
          title: current.title,
          src: (id) => {
            const f = store.files.find((x) => x.id === id);
            return f ? api.fileUrl(f) : '';
          },
          ref: refInfo,
          fitScript: false,
          fontCss: fonts,
        })
      : '',
  );

  let scale = $derived(frame && mode === 'ajustar' ? Math.min(1, (viewW - 64) / frame.width) : 1);

  $effect(() => {
    if (!viewport) return;
    const ro = new ResizeObserver(([e]) => (viewW = e.contentRect.width));
    ro.observe(viewport);
    return () => ro.disconnect();
  });

  async function openBrowser() {
    if (!current || !doc || busy) return;
    busy = 'browser';
    try {
      await api.openInBrowser(current.id, await siteHtml(current.title, doc));
    } catch (e) {
      store.error = `${t('Não foi possível abrir no navegador.')} ${message(e)}`;
    } finally {
      busy = '';
    }
  }

  // Publicar: revisão primeiro, depois a confirmação (sempre), só então a Vercel.
  let check = $state<PublishCheck | null>(null);
  let published = $state('');
  let errors = $derived(check?.findings.filter((f) => f.level === 'erro') ?? []);
  let canPublish = $derived(!!check && errors.length === 0 && check.vercel.installed && !!check.vercel.user);

  async function review() {
    if (!current || !doc || busy) return;
    busy = 'review';
    published = '';
    try {
      check = await api.preparePublish(current.id, await siteHtml(current.title, doc));
    } catch (e) {
      store.error = `${t('A revisão antes de publicar falhou.')} ${message(e)}`;
    } finally {
      busy = '';
    }
  }

  async function publish() {
    if (!current || !canPublish || busy) return;
    busy = 'publish';
    try {
      published = await api.publishSite(current.id);
      check = null;
      notify(t('Site publicado.'));
    } catch (e) {
      store.error = message(e);
    } finally {
      busy = '';
    }
  }
</script>

{#if current && doc && frame}
  <div class="preview">
    <header class="bar">
      <a class="btn" href={`/editor?id=${current.id}${view === 'mobile' ? '&v=mobile' : ''}`}><PenLine size={14} aria-hidden="true" />{t('Voltar ao editor')}</a>
      <h1>{current.title}</h1>
      <div class="spacer"></div>
      {#if doc.mobile}
        <div class="seg" use:slidingPill role="group" aria-label={t('Versão da página')}>
          <button aria-pressed={view === 'desktop'} onclick={() => (view = 'desktop')}><Monitor size={14} aria-hidden="true" />Desktop</button>
          <button aria-pressed={view === 'mobile'} onclick={() => (view = 'mobile')}><Smartphone size={14} aria-hidden="true" />Mobile</button>
        </div>
      {/if}
      <div class="seg" use:slidingPill role="group" aria-label={t('Tamanho da visualização')}>
        <button aria-pressed={mode === 'ajustar'} onclick={() => (mode = 'ajustar')}>{t('Ajustar à janela')}</button>
        <button aria-pressed={mode === 'real'} onclick={() => (mode = 'real')}>{t('Tamanho real')}</button>
      </div>
      <div class="seg" use:slidingPill role="group" aria-label={t('Fundo ao redor da página')}>
        <button aria-pressed={backdrop === 'escuro'} onclick={() => (backdrop = 'escuro')}>{t('Fundo escuro')}</button>
        <button aria-pressed={backdrop === 'claro'} onclick={() => (backdrop = 'claro')}>{t('Fundo claro')}</button>
      </div>
      <div class="actions">
        <button class="btn" onclick={openBrowser} disabled={!!busy}>
          <Globe size={14} aria-hidden="true" />{busy === 'browser' ? t('Abrindo…') : t('Ver no navegador')}
        </button>
        <button class="btn primary" onclick={review} disabled={!!busy}>
          <Rocket size={14} aria-hidden="true" />{busy === 'review' ? t('Revisando…') : t('Publicar')}
        </button>
      </div>
    </header>

    {#if check}
      <div class="publish" role="alertdialog" aria-labelledby="pub-title">
        <h2 id="pub-title">{t('Publicar na Vercel como')} <span class="mono">{check.name}</span>?</h2>
        <p>{t('O site fica no ar para qualquer pessoa com o endereço. Publicar de novo troca a versão publicada.')}</p>
        {#if check.findings.length}
          <ul class="findings">
            {#each check.findings as f (f.text)}
              <li class:erro={f.level === 'erro'}>
                {#if f.level === 'erro'}<CircleX size={14} aria-hidden="true" />{:else}<TriangleAlert size={14} aria-hidden="true" />{/if}
                {f.text}
              </li>
            {/each}
          </ul>
        {:else}
          <p class="muted">{t('A revisão de segurança não achou problemas.')}</p>
        {/if}
        {#if !check.vercel.installed}
          <p>{t('A CLI da Vercel não está instalada. Rode')} <code class="mono">npm i -g vercel</code> {t('e depois')} <code class="mono">vercel login</code>.</p>
        {:else if !check.vercel.user}
          <p>{t('A CLI da Vercel está sem conta. Rode')} <code class="mono">vercel login</code> {t('num terminal.')}</p>
        {:else}
          <p class="muted">{t('Conta da Vercel:')} {check.vercel.user}</p>
        {/if}
        <div class="row">
          <button class="btn primary" onclick={publish} disabled={!canPublish || !!busy}>{busy === 'publish' ? t('Publicando…') : t('Publicar agora')}</button>
          <button class="btn" onclick={() => (check = null)} disabled={busy === 'publish'}>{t('Cancelar')}</button>
        </div>
      </div>
    {/if}
    {#if published}
      <div class="publish done" role="status">
        <span>{t('Publicado em')} <span class="mono">{published}</span></span>
        <button class="btn" onclick={() => api.openPublished(published)}><ExternalLink size={14} aria-hidden="true" />{t('Abrir site')}</button>
        <button class="btn" onclick={() => (published = '')}>{t('Fechar')}</button>
      </div>
    {/if}

    <!-- Sem allow-scripts: nada da página roda como código. A mesma origem só serve para fontes e imagens carregarem. -->
    <div class="viewport" class:light={backdrop === 'claro'} bind:this={viewport}>
      {#key view}
        <div class="frame-box" in:frameIn style={`width:${frame.width * scale}px;height:${frame.height * scale}px`}>
          <iframe
            title={t('Visualização de {title}', { title: current.title })}
            srcdoc={html}
            sandbox="allow-same-origin allow-popups"
            style={`width:${frame.width}px;height:${frame.height}px;transform:scale(${scale})`}
          ></iframe>
        </div>
      {/key}
    </div>
  </div>
{:else if store.loaded}
  <div class="missing">
    <p>{t('Página não encontrada.')}</p>
    <a href="/">{t('Voltar ao Início')}</a>
  </div>
{/if}

<style>
  .preview {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .preview > .viewport {
    flex: 1;
    min-height: 0;
  }

  .publish {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
    padding: var(--s4);
    border-bottom: 1px solid var(--line);
    background: var(--panel);
    font-size: 13px;
  }

  .publish h2 {
    font-size: 15px;
  }

  .publish p {
    margin: 0;
  }

  .publish.done {
    flex-direction: row;
    align-items: center;
    gap: var(--s3);
  }

  .publish.done > span {
    flex: 1;
    overflow-wrap: anywhere;
  }

  .findings {
    display: flex;
    flex-direction: column;
    gap: var(--s1);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .findings li {
    display: flex;
    align-items: center;
    gap: var(--s2);
    color: var(--muted);
  }

  .findings li.erro {
    color: var(--fg);
    font-weight: 600;
  }

  .row {
    display: flex;
    gap: var(--s2);
    margin-top: var(--s1);
  }

  .bar {
    display: flex;
    align-items: center;
    gap: var(--s3);
    padding: var(--s2) var(--s4);
    border-bottom: 1px solid var(--line);
    background: var(--panel);
  }

  .bar {
    flex-wrap: wrap;
  }

  .bar :global(button),
  .bar a {
    white-space: nowrap;
  }

  .actions {
    display: flex;
    gap: var(--s2);
    margin-left: auto;
  }

  .bar h1 {
    min-width: 120px;
    flex: 0 1 auto;
    font-size: 15px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .spacer {
    flex: 1;
  }

  .viewport {
    overflow: auto;
    padding: var(--s6) var(--s5);
    background: var(--bg);
  }

  .viewport.light {
    background: var(--sheet);
  }

  .frame-box {
    position: relative;
    margin: 0 auto;
    box-shadow: 0 8px 40px rgb(0 0 0 / 0.35);
  }

  iframe {
    position: absolute;
    top: 0;
    left: 0;
    border: 0;
    transform-origin: top left;
    background: #fff;
  }

  .missing {
    padding: var(--s6) var(--s7);
  }
</style>
