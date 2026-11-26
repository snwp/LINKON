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
      notify(value ? 'Chave guardada.' : 'Chave apagada.');
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
      dir = `Não foi possível ler a pasta. ${message(e)}`;
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
      const parent = await api.pickFolder('Onde guardar a cópia de segurança');
      if (!parent) return;
      busy = 'backup';
      await flushAll();
      lastBackup = await api.createBackup(parent, `Linkon ${stamp()}`);
      notify('Cópia de segurança criada.');
    } catch (e) {
      store.error = `A cópia de segurança falhou. ${message(e)}`;
    } finally {
      busy = '';
    }
  }

  async function chooseRestore() {
    try {
      restoreSource = await api.pickFolder('Escolha a pasta de uma cópia do Linkon');
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
      notify(`Dados restaurados. O estado anterior foi guardado em ${safety}`, true);
    } catch (e) {
      store.error = `A restauração falhou e seus dados não foram trocados. ${message(e)}`;
    } finally {
      busy = '';
    }
  }
</script>

<div class="page">
  <h1>Configurações</h1>

  <section aria-labelledby="h-dados">
    <h2 id="h-dados">Seus dados</h2>
    <div class="path">
      <code class="mono">{dir || '…'}</code>
      <button class="btn" onclick={copy} disabled={!dir}>{copied ? 'Copiado' : 'Copiar caminho'}</button>
    </div>
  </section>

  <section aria-labelledby="h-sites">
    <h2 id="h-sites">Sites</h2>
    <div class="path">
      <code class="mono">{sitesDir || '…'}</code>
      <button class="btn" onclick={openSites} disabled={!sitesDir}>Abrir pasta</button>
    </div>
    <div class="ai-status" role="status">
      <span class="dot" class:ok={!!vercel?.user}></span>
      <span>
        {#if !vercel}Verificando a Vercel…{:else if vercel.user}Vercel conectada · {vercel.user}{:else if vercel.installed}CLI da Vercel sem conta conectada{:else}CLI da Vercel não instalada{/if}
      </span>
      <button class="btn" onclick={checkVercel}>Verificar de novo</button>
    </div>
    {#if vercel && !vercel.user}
      <p class="small">
        {#if !vercel.installed}Instale com <code class="mono">npm i -g vercel</code> e entre{:else}Entre{/if} com <code class="mono">vercel login</code> num terminal.
      </p>
    {/if}
  </section>

  <section aria-labelledby="h-copia">
    <h2 id="h-copia">Cópia de segurança</h2>
    <div class="row">
      <button class="btn" onclick={backup} disabled={busy !== ''}>
        <HardDriveDownload size={15} aria-hidden="true" />
        {busy === 'backup' ? 'Copiando…' : 'Criar cópia de segurança'}
      </button>
    </div>
    {#if lastBackup}
      <p class="small">Última cópia: <code class="mono">{lastBackup}</code></p>
    {/if}

    <h3>Restaurar</h3>
    {#if restoreSource}
      <div class="confirm" role="alert">
        <p>
          Restaurar de <code class="mono">{restoreSource}</code>? Todas as pastas, interfaces e arquivos atuais serão
          trocados pelos da cópia. Antes disso, o Linkon guarda o estado atual na pasta <span class="mono">backups</span> dos
          seus dados.
        </p>
        <div class="row">
          <button class="btn danger" onclick={restore} disabled={busy !== ''}>
            {busy === 'restore' ? 'Restaurando…' : 'Restaurar esta cópia'}
          </button>
          <button class="btn" onclick={() => (restoreSource = null)} disabled={busy !== ''}>Cancelar</button>
        </div>
      </div>
    {:else}
      <div class="row">
        <button class="btn" onclick={chooseRestore} disabled={busy !== ''}>
          <RotateCcw size={15} aria-hidden="true" />
          Restaurar de uma cópia…
        </button>
      </div>
    {/if}
  </section>

  <section aria-labelledby="h-ia">
    <h2 id="h-ia">Assistente de IA</h2>

    <div class="ai-status" role="status">
      {#if aiChecking}
        <span class="muted">Verificando…</span>
      {:else if ai}
        <span class="dot" class:ok={ai.loggedIn}></span>
        <span>
          {ai.loggedIn ? 'Conectado' : 'Claude Code encontrado, mas sem conta conectada'}
          <span class="mono muted">· {ai.version}</span>
        </span>
      {:else}
        <span class="dot"></span>
        <span>{aiError || 'Não verificado.'}</span>
      {/if}
      <button class="btn" onclick={checkAi} disabled={aiChecking}>Verificar de novo</button>
    </div>

    {#if ai && !ai.loggedIn}
      <p class="small">
        Para conectar, abra um terminal, rode o comando abaixo e entre com sua conta do Claude no navegador. Depois, clique
        em Verificar de novo.
      </p>
      <div class="path">
        <code class="mono">{LOGIN_CMD}</code>
        <button class="btn" onclick={copyLogin}>{copiedLogin ? 'Copiado' : 'Copiar comando'}</button>
      </div>
    {/if}

    <label class="model">
      <span>Modelo</span>
      <ModelPicker id="config-modelo" />
    </label>

    <label class="toggle">
      <input type="checkbox" bind:checked={aiNotify} onchange={() => setAiNotify(aiNotify)} />
      <span>Avisar quando o Claude terminar e eu estiver fora do editor</span>
    </label>
  </section>

  <section aria-labelledby="h-img">
    <h2 id="h-img">Imagens</h2>
    <div class="seg" use:slidingPill role="group" aria-label="Gerador de imagens">
      {#each IMAGE_PROVIDERS as p (p.id)}
        <button aria-pressed={imgPrefs.provider === p.id} onclick={() => pick({ provider: p.id })}>{p.name}</button>
      {/each}
    </div>

    {#if imgPrefs.provider === 'codex'}
      <div class="ai-status" role="status">
        <span class="dot" class:ok={codexOk}></span>
        <span>
          {#if !img}Verificando…{:else if codexOk}Codex conectado ao ChatGPT{:else if img.codex}Codex encontrado, sem conta do ChatGPT conectada{:else}Codex não encontrado neste computador{/if}
        </span>
        <button class="btn" onclick={checkImages}>Verificar de novo</button>
      </div>
      {#if img && !codexOk}
        <p class="small">Instale com <code class="mono">npm i -g @openai/codex</code> e entre com <code class="mono">codex login</code>, usando a conta do ChatGPT.</p>
      {/if}
    {:else}
      <div class="seg" use:slidingPill role="group" aria-label="Modelo de imagem">
        {#each IMAGE_MODELS as m (m.id)}
          <button aria-pressed={imgPrefs.model === m.id} onclick={() => pick({ model: m.id })} data-tip={m.note}>{m.name}</button>
        {/each}
      </div>
      {#if img?.hasKey}
        <div class="ai-status">
          <span class="dot ok"></span>
          <span>Chave guardada no cofre do Windows</span>
          <button class="btn" onclick={() => saveKey('')} disabled={keyBusy}>Apagar chave</button>
        </div>
      {:else}
        <form class="key-row" onsubmit={(e) => (e.preventDefault(), saveKey(keyDraft.trim()))}>
          <label class="visually-hidden" for="chave-openai">Chave da OpenAI</label>
          <input id="chave-openai" class="field" type="password" autocomplete="off" spellcheck="false" placeholder="sk-…" bind:value={keyDraft} />
          <button class="btn primary" disabled={keyBusy || !keyDraft.trim()}>Guardar chave</button>
        </form>
      {/if}
      {#if keyError}<p class="error-text">{keyError}</p>{/if}
    {/if}
  </section>

  <section aria-labelledby="h-atalhos">
    <h2 id="h-atalhos">Atalhos</h2>
    <dl class="keys">
      <dt><kbd>Ctrl N</kbd></dt>
      <dd>Nova página</dd>
      <dt><kbd>Ctrl K</kbd></dt>
      <dd>Buscar pastas e páginas</dd>
      <dt><kbd>Ctrl Z</kbd> <kbd>Ctrl Y</kbd></dt>
      <dd>Desfazer e refazer no Editor</dd>
      <dt><kbd>Ctrl D</kbd></dt>
      <dd>Duplicar o elemento selecionado no Editor</dd>
      <dt><kbd>Delete</kbd></dt>
      <dd>Excluir o elemento selecionado no Editor</dd>
      <dt><kbd>Setas</kbd></dt>
      <dd>Mover o elemento 1 px (com Shift, 10 px)</dd>
      <dt><kbd>Esc</kbd></dt>
      <dd>Fechar a busca ou tirar a seleção</dd>
    </dl>
  </section>
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: var(--s6);
    padding: var(--s6) var(--s7) calc(var(--s6) + var(--dock-space, 0px));
    max-width: 760px;
  }

  section {
    display: flex;
    flex-direction: column;
    gap: var(--s3);
    padding-top: var(--s4);
    border-top: 1px solid var(--line);
  }

  h3 {
    margin: var(--s3) 0 0;
    font: 600 14px var(--font-ui);
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

  .seg {
    align-self: flex-start;
  }

  .key-row {
    display: flex;
    gap: var(--s2);
  }

  .key-row .field {
    flex: 1;
    min-width: 0;
  }

  .model,
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
</style>
