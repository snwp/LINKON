<script lang="ts">
  import { onMount } from 'svelte';
  import { HardDriveDownload, RotateCcw } from '@lucide/svelte';
  import { api, message } from '$lib/api';
  import { store, reload, notify, stamp } from '$lib/store.svelte';
  import { flushAll } from '$lib/pending';
  import { friendlyAiError } from '$lib/editor/assistant';
  import ModelPicker from '$lib/ModelPicker.svelte';
  import { getAiNotify, setAiNotify } from '$lib/editor/background.svelte';
  import { slidingPill } from '$lib/motion';
  import { IMAGE_PROVIDERS, IMAGE_MODELS, getImagePrefs, setImagePrefs } from '$lib/imagegen';
  import { THEMES, theme, setTheme } from '$lib/theme.svelte';
  import { LANGS, i18n, setLang, t } from '$lib/i18n.svelte';

  // ---------- seções (menu à esquerda) ----------
  const SECTIONS = [
    { id: 'aparencia', label: 'Aparência' },
    { id: 'dados', label: 'Seus dados' },
    { id: 'sites', label: 'Sites' },
    { id: 'copia', label: 'Cópia de segurança' },
    { id: 'ia', label: 'Assistente de IA' },
    { id: 'imagens', label: 'Imagens' },
    { id: 'atalhos', label: 'Atalhos' },
  ];
  let current = $state('aparencia');
  let content: HTMLElement | undefined = $state();

  function go(e: MouseEvent, id: string) {
    e.preventDefault();
    current = id;
    document.getElementById(id)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }

  // O item do menu acompanha a seção que está no topo da área visível.
  onMount(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) if (en.isIntersecting) current = en.target.id;
      },
      { rootMargin: '0px 0px -70% 0px' },
    );
    content?.querySelectorAll('section[id]').forEach((s) => io.observe(s));
    return () => io.disconnect();
  });

  let aiNotify = $state(getAiNotify());

  // ---------- sites ----------
  let sitesDir = $state('');
  let vercel = $state<{ installed: boolean; user: string } | null>(null);

  async function checkVercel() {
    vercel = null;
    vercel = await api.vercelStatus().catch(() => ({ installed: false, user: '' }));
  }
  onMount(async () => {
    sitesDir = await api.sitesFolder().catch((e) => message(e));
    checkVercel();
  });

  async function openData() {
    try {
      await api.openDataDir();
    } catch (e) {
      store.error = message(e);
    }
  }

  async function openSites() {
    try {
      await api.openSitesFolder();
    } catch (e) {
      store.error = message(e);
    }
  }

  // ---------- imagens ----------
  let imgPrefs = $state(getImagePrefs());
  let img = $state<{ codex: string; hasKey: boolean } | null>(null);
  let keyDraft = $state('');
  let keyBusy = $state(false);
  let keyError = $state('');
  let codexOk = $derived(!!img && /chatgpt/i.test(img.codex));

  async function checkImages() {
    try {
      img = await api.imageStatus();
    } catch {
      img = { codex: '', hasKey: false };
    }
  }
  onMount(checkImages);

  function pick(p: Partial<typeof imgPrefs>) {
    setImagePrefs(p);
    imgPrefs = getImagePrefs();
  }

  async function saveKey(value: string) {
    keyBusy = true;
    keyError = '';
    try {
      await api.setImageKey(value);
      keyDraft = '';
      await checkImages();
      notify(value ? t('Chave guardada.') : t('Chave apagada.'));
    } catch (e) {
      keyError = message(e);
    } finally {
      keyBusy = false;
    }
  }

  type AiStatus = { version: string; loggedIn: boolean; authMethod: string };
  let ai = $state<AiStatus | null>(null);
  let aiError = $state('');
  let aiChecking = $state(false);
  let copiedLogin = $state(false);
  const LOGIN_CMD = 'claude auth login';

  async function checkAi() {
    aiChecking = true;
    aiError = '';
    try {
      ai = await api.aiCheck();
    } catch (e) {
      ai = null;
      aiError = friendlyAiError(message(e));
    } finally {
      aiChecking = false;
    }
  }

  async function copyLogin() {
    try {
      await navigator.clipboard.writeText(LOGIN_CMD);
      copiedLogin = true;
      setTimeout(() => (copiedLogin = false), 1500);
    } catch {
      copiedLogin = false;
    }
  }

  onMount(checkAi);

  let dir = $state('');
  let copied = $state(false);
  let busy = $state<'' | 'backup' | 'restore'>('');
  let lastBackup = $state('');
  let restoreSource = $state<string | null>(null);

  onMount(async () => {
    try {
      dir = await api.dataDir();
    } catch (e) {
      dir = `${t('Não foi possível ler a pasta.')} ${message(e)}`;
    }
  });

  async function copy() {
    try {
      await navigator.clipboard.writeText(dir);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      copied = false;
    }
  }

  async function backup() {
    try {
      const parent = await api.pickFolder(t('Onde guardar a cópia de segurança'));
      if (!parent) return;
      busy = 'backup';
      await flushAll();
      lastBackup = await api.createBackup(parent, `Linkon ${stamp()}`);
      notify(t('Cópia de segurança criada.'));
    } catch (e) {
      store.error = `${t('A cópia de segurança falhou.')} ${message(e)}`;
    } finally {
      busy = '';
    }
  }

  async function chooseRestore() {
    try {
      restoreSource = await api.pickFolder(t('Escolha a pasta de uma cópia do Linkon'));
    } catch (e) {
      store.error = message(e);
    }
  }

  async function restore() {
    if (!restoreSource) return;
    busy = 'restore';
    try {
      await flushAll();
      const safety = await api.restoreBackup(restoreSource, `antes de restaurar ${stamp()}`);
      restoreSource = null;
      await reload();
      notify(t('Dados restaurados. O estado anterior foi guardado em {path}', { path: safety }), true);
    } catch (e) {
      store.error = `${t('A restauração falhou e seus dados não foram trocados.')} ${message(e)}`;
    } finally {
      busy = '';
    }
  }
</script>

<div class="page">
  <h1>{t('Configurações')}</h1>

  <div class="layout">
    <nav class="toc" aria-label={t('Seções')}>
      {#each SECTIONS as sec (sec.id)}
        <a href={`#${sec.id}`} aria-current={current === sec.id ? 'true' : undefined} onclick={(e) => go(e, sec.id)}>{t(sec.label)}</a>
      {/each}
    </nav>

    <div class="content" bind:this={content}>
      <section id="aparencia" aria-labelledby="h-aparencia">
        <h2 id="h-aparencia">{t('Aparência')}</h2>
        <div class="line">
          <span class="label" id="l-tema">{t('Tema')}</span>
          <div class="themes" role="radiogroup" aria-labelledby="l-tema">
            {#each THEMES as th (th.id)}
              <button
                class="theme"
                role="radio"
                aria-checked={theme.id === th.id}
                onclick={() => setTheme(th.id)}
                style={`--tb:${th.bg};--tf:${th.fg};--ta:${th.accent}`}
              >
                <span class="swatch" aria-hidden="true">
                  <span class="bar"></span>
                  <span class="bar short"></span>
                  <span class="pill"></span>
                </span>
                <span>{t(th.name)}</span>
              </button>
            {/each}
          </div>
        </div>
        <div class="line">
          <span class="label" id="l-idioma">{t('Idioma')}</span>
          <div class="seg" use:slidingPill role="group" aria-labelledby="l-idioma">
            {#each LANGS as l (l.id)}
              <button aria-pressed={i18n.lang === l.id} onclick={() => setLang(l.id)} lang={l.id}>{l.name}</button>
            {/each}
          </div>
        </div>
      </section>

      <section id="dados" aria-labelledby="h-dados">
        <h2 id="h-dados">{t('Seus dados')}</h2>
        <div class="path">
          <code class="mono">{dir || '…'}</code>
          <button class="btn" onclick={copy} disabled={!dir}>{copied ? t('Copiado') : t('Copiar caminho')}</button>
          <button class="btn" onclick={openData} disabled={!dir}>{t('Abrir pasta')}</button>
        </div>
      </section>

      <section id="sites" aria-labelledby="h-sites">
        <h2 id="h-sites">{t('Sites')}</h2>
        <div class="path">
          <code class="mono">{sitesDir || '…'}</code>
          <button class="btn" onclick={openSites} disabled={!sitesDir}>{t('Abrir pasta')}</button>
        </div>
        <div class="ai-status" role="status">
          <span class="dot" class:ok={!!vercel?.user}></span>
          <span>
            {#if !vercel}{t('Verificando a Vercel…')}{:else if vercel.user}{t('Vercel conectada')} · {vercel.user}{:else if vercel.installed}{t('CLI da Vercel sem conta conectada')}{:else}{t('CLI da Vercel não instalada')}{/if}
          </span>
          <button class="btn" onclick={checkVercel}>{t('Verificar de novo')}</button>
        </div>
        {#if vercel && !vercel.user}
          <p class="small">
            {#if !vercel.installed}{t('Instale com')} <code class="mono">npm i -g vercel</code> {t('e entre com')}{:else}{t('Entre com')}{/if}
            <code class="mono">vercel login</code> {t('num terminal.')}
          </p>
        {/if}
      </section>

      <section id="copia" aria-labelledby="h-copia">
        <h2 id="h-copia">{t('Cópia de segurança')}</h2>
        <div class="line">
          <span class="label">{t('Criar')}</span>
          <button class="btn" onclick={backup} disabled={busy !== ''}>
            <HardDriveDownload size={15} aria-hidden="true" />
            {busy === 'backup' ? t('Copiando…') : t('Criar cópia de segurança')}
          </button>
        </div>
        {#if lastBackup}
          <p class="small">{t('Última cópia:')} <code class="mono">{lastBackup}</code></p>
        {/if}

        <div class="line">
          <span class="label">{t('Restaurar')}</span>
          {#if !restoreSource}
            <button class="btn" onclick={chooseRestore} disabled={busy !== ''}>
              <RotateCcw size={15} aria-hidden="true" />
              {t('Restaurar de uma cópia…')}
            </button>
          {/if}
        </div>
        {#if restoreSource}
          <div class="confirm" role="alert">
            <p>
              {t('Restaurar de {pasta}? Todas as pastas, interfaces e arquivos atuais serão trocados pelos da cópia. Antes disso, o Linkon guarda o estado atual na pasta backups dos seus dados.', { pasta: restoreSource })}
            </p>
            <div class="row">
              <button class="btn danger" onclick={restore} disabled={busy !== ''}>
                {busy === 'restore' ? t('Restaurando…') : t('Restaurar esta cópia')}
              </button>
              <button class="btn" onclick={() => (restoreSource = null)} disabled={busy !== ''}>{t('Cancelar')}</button>
            </div>
          </div>
        {/if}
      </section>

      <section id="ia" aria-labelledby="h-ia">
        <h2 id="h-ia">{t('Assistente de IA')}</h2>

        <div class="ai-status" role="status">
          {#if aiChecking}
            <span class="muted">{t('Verificando…')}</span>
          {:else if ai}
            <span class="dot" class:ok={ai.loggedIn}></span>
            <span>
              {ai.loggedIn ? t('Conectado') : t('Claude Code encontrado, mas sem conta conectada')}
              <span class="mono muted">· {ai.version}</span>
            </span>
          {:else}
            <span class="dot"></span>
            <span>{aiError || t('Não verificado.')}</span>
          {/if}
          <button class="btn" onclick={checkAi} disabled={aiChecking}>{t('Verificar de novo')}</button>
        </div>

        {#if ai && !ai.loggedIn}
          <p class="small">
            {t('Para conectar, abra um terminal, rode o comando abaixo e entre com sua conta do Claude no navegador. Depois, clique em Verificar de novo.')}
          </p>
          <div class="path">
            <code class="mono">{LOGIN_CMD}</code>
            <button class="btn" onclick={copyLogin}>{copiedLogin ? t('Copiado') : t('Copiar comando')}</button>
          </div>
        {/if}

        <label class="line">
          <span class="label">{t('Modelo')}</span>
          <ModelPicker id="config-modelo" />
        </label>

        <label class="line">
          <span class="label">{t('Avisos')}</span>
          <span class="toggle">
            <input type="checkbox" bind:checked={aiNotify} onchange={() => setAiNotify(aiNotify)} />
            <span>{t('Avisar quando Linke terminar e eu estiver fora do editor')}</span>
          </span>
        </label>
      </section>

      <section id="imagens" aria-labelledby="h-img">
        <h2 id="h-img">{t('Imagens')}</h2>
        <div class="line">
          <span class="label" id="l-gerador">{t('Gerador')}</span>
          <div class="seg" use:slidingPill role="group" aria-labelledby="l-gerador">
            {#each IMAGE_PROVIDERS as p (p.id)}
              <button aria-pressed={imgPrefs.provider === p.id} onclick={() => pick({ provider: p.id })}>{t(p.name)}</button>
            {/each}
          </div>
        </div>

        {#if imgPrefs.provider === 'codex'}
          <div class="ai-status" role="status">
            <span class="dot" class:ok={codexOk}></span>
            <span>
              {#if !img}{t('Verificando…')}{:else if codexOk}{t('Codex conectado ao ChatGPT')}{:else if img.codex}{t('Codex encontrado, sem conta do ChatGPT conectada')}{:else}{t('Codex não encontrado neste computador')}{/if}
            </span>
            <button class="btn" onclick={checkImages}>{t('Verificar de novo')}</button>
          </div>
          {#if img && !codexOk}
            <p class="small">
              {t('Instale com')} <code class="mono">npm i -g @openai/codex</code> {t('e entre com')} <code class="mono">codex login</code>{t(', usando a conta do ChatGPT.')}
            </p>
          {/if}
        {:else}
          <div class="line">
            <span class="label" id="l-modelo-img">{t('Modelo')}</span>
            <div class="seg" use:slidingPill role="group" aria-labelledby="l-modelo-img">
              {#each IMAGE_MODELS as m (m.id)}
                <button aria-pressed={imgPrefs.model === m.id} onclick={() => pick({ model: m.id })} data-tip={t(m.note)}>{m.name}</button>
              {/each}
            </div>
          </div>
          {#if img?.hasKey}
            <div class="ai-status">
              <span class="dot ok"></span>
              <span>{t('Chave guardada no cofre do Windows')}</span>
              <button class="btn" onclick={() => saveKey('')} disabled={keyBusy}>{t('Apagar chave')}</button>
            </div>
          {:else}
            <form class="key-row" onsubmit={(e) => (e.preventDefault(), saveKey(keyDraft.trim()))}>
              <label class="visually-hidden" for="chave-openai">{t('Chave da OpenAI')}</label>
              <input id="chave-openai" class="field" type="password" autocomplete="off" spellcheck="false" placeholder="sk-…" bind:value={keyDraft} />
              <button class="btn primary" disabled={keyBusy || !keyDraft.trim()}>{t('Guardar chave')}</button>
            </form>
          {/if}
          {#if keyError}<p class="error-text">{keyError}</p>{/if}
        {/if}
      </section>

      <section id="atalhos" aria-labelledby="h-atalhos">
        <h2 id="h-atalhos">{t('Atalhos')}</h2>
        <dl class="keys">
          <dt><kbd>Ctrl N</kbd></dt>
          <dd>{t('Nova página')}</dd>
          <dt><kbd>Ctrl K</kbd></dt>
          <dd>{t('Buscar pastas e páginas')}</dd>
          <dt><kbd>Ctrl Z</kbd> <kbd>Ctrl Y</kbd></dt>
          <dd>{t('Desfazer e refazer no Editor')}</dd>
          <dt><kbd>Ctrl D</kbd></dt>
          <dd>{t('Duplicar o elemento selecionado no Editor')}</dd>
          <dt><kbd>Delete</kbd></dt>
          <dd>{t('Excluir o elemento selecionado no Editor')}</dd>
          <dt><kbd>{t('Setas')}</kbd></dt>
          <dd>{t('Mover o elemento 1 px (com Shift, 10 px)')}</dd>
          <dt><kbd>Esc</kbd></dt>
          <dd>{t('Fechar a busca ou tirar a seleção')}</dd>
        </dl>
      </section>
    </div>
  </div>
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: var(--s6);
    padding: var(--s6) var(--s7) calc(var(--s6) + var(--dock-space, 0px));
    max-width: 960px;
    margin-inline: auto;
  }

  /* Menu de seções fixo à esquerda, conteúdo à direita, como nas telas de referência. */
  .layout {
    display: grid;
    grid-template-columns: 176px minmax(0, 1fr);
    gap: var(--s7);
    align-items: start;
  }

  .toc {
    position: sticky;
    top: var(--s5);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .toc a {
    padding: 6px var(--s3);
    border-radius: var(--r-sm);
    color: var(--muted);
    text-decoration: none;
    font: 500 13px var(--font-ui);
    transition:
      background-color 150ms,
      color 150ms;
  }

  .toc a:hover {
    color: var(--fg);
  }

  .toc a[aria-current='true'] {
    color: var(--fg);
    background: var(--card);
  }

  .content {
    display: flex;
    flex-direction: column;
    gap: var(--s7);
    min-width: 0;
  }

  section {
    display: flex;
    flex-direction: column;
    gap: var(--s3);
    /* O título da seção para abaixo do topo ao pular pelo menu. */
    scroll-margin-top: var(--s5);
  }

  h2 {
    margin: 0 0 var(--s1);
    font: 600 16px var(--font-ui);
    color: var(--fg);
  }

  /* Linha de ajuste: rótulo à esquerda, controle à direita, separadas por um fio. */
  .line {
    display: grid;
    grid-template-columns: 120px minmax(0, 1fr);
    align-items: center;
    gap: var(--s4);
    padding-block: var(--s3);
    border-top: 1px solid var(--line);
  }

  /* Com o seletor de temas (duas fileiras), o rótulo fica no alto, junto da primeira. */
  .line:has(.themes) {
    align-items: start;
  }

  .line:has(.themes) .label {
    padding-top: var(--s2);
  }

  .line > :last-child {
    justify-self: start;
  }

  .label {
    color: var(--muted);
    font-size: 13px;
  }

  .line > .themes {
    justify-self: stretch;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--s2);
  }

  .theme {
    display: flex;
    flex-direction: column;
    gap: var(--s2);
    padding: var(--s2);
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    background: none;
    cursor: pointer;
    font-size: 13px;
    text-align: left;
    transition: border-color 150ms;
  }

  .theme:hover {
    border-color: var(--muted);
  }

  /* Escolhido: borda cheia na cor do texto. A forma marca o estado, não um brilho. */
  .theme[aria-checked='true'] {
    border-color: var(--fg);
    box-shadow: inset 0 0 0 1px var(--fg);
  }

  .swatch {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 5px;
    height: 52px;
    padding: 10px;
    border-radius: var(--r-sm);
    background: var(--tb);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--fg) 12%, transparent);
  }

  .swatch .bar {
    height: 4px;
    width: 70%;
    border-radius: 2px;
    background: var(--tf);
  }

  .swatch .bar.short {
    width: 45%;
    opacity: 0.55;
  }

  .swatch .pill {
    position: absolute;
    right: 8px;
    bottom: 8px;
    width: 18px;
    height: 8px;
    border-radius: 4px;
    background: var(--ta);
  }

  p {
    margin: 0;
    max-width: 65ch;
  }

  .small {
    font-size: 13px;
    overflow-wrap: anywhere;
  }

  .row {
    display: flex;
    gap: var(--s2);
  }

  .path {
    display: flex;
    align-items: center;
    gap: var(--s3);
    padding: var(--s2) var(--s2) var(--s2) var(--s3);
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: var(--r-md);
  }

  .path code {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .confirm {
    display: flex;
    flex-direction: column;
    gap: var(--s3);
    padding: var(--s3);
    border: 2px solid var(--fg);
    border-radius: var(--r-md);
    overflow-wrap: anywhere;
  }

  .ai-status {
    display: flex;
    align-items: center;
    gap: var(--s3);
  }

  .ai-status .btn {
    margin-left: auto;
  }

  /* Desconectado: anel vazado. Conectado: ponto cheio. A forma diz o estado, não a cor. */
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 1.5px solid var(--muted);
    background: transparent;
    flex: none;
  }

  .dot.ok {
    border-color: var(--fg);
    background: var(--fg);
  }

  .key-row {
    display: flex;
    gap: var(--s2);
  }

  .key-row .field {
    flex: 1;
    min-width: 0;
  }

  .toggle {
    display: flex;
    align-items: center;
    gap: var(--s3);
  }

  .toggle input {
    width: 16px;
    height: 16px;
    margin: 0;
    accent-color: var(--fg);
  }

  .keys {
    display: grid;
    grid-template-columns: 150px 1fr;
    gap: var(--s2) var(--s4);
    margin: 0;
  }

  .keys dd {
    margin: 0;
  }

  /* Janela estreita: o menu vira uma faixa que rola de lado, acima do conteúdo. */
  @media (max-width: 860px) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--s5);
    }

    .toc {
      position: static;
      flex-direction: row;
      overflow-x: auto;
    }

    .toc a {
      white-space: nowrap;
    }
  }

  @media (max-width: 560px) {
    .line {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--s2);
    }
  }
</style>
